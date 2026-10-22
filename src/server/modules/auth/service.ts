import "server-only";

import { and, eq, ne } from "drizzle-orm";

import {
  AUTH_VIEWER_ROLE,
  type AuthRole,
  isAcceptablePassword,
  isValidEmail,
  isValidUsername,
  normalizeEmail,
  normalizeUsername
} from "@/lib/auth";
import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";

import { hashPassword, verifyPassword } from "./password";

/**
 * 账号服务（认证 / 注册）。
 *
 * 约定：
 * - 一律返回**结果对象**而非抛错，让路由层能稳定映射到 HTTP 状态码；
 * - 认证失败的原因对外**只有一种文案**（账号或密码错误），本文件的 `reason`
 *   仅供日志与测试使用，不得直接透传给客户端。
 */

/** 失败原因（内部语义，不外泄）。 */
export type AuthFailureReason =
  | "invalid_credentials"
  | "inactive"
  | "invalid_input"
  | "email_taken"
  | "username_taken"
  | "weak_password";

/** 结果类型。 */
export type AuthResult<T> = { ok: true; value: T } | { ok: false; reason: AuthFailureReason };

/** 已认证用户（可安全下发的最小集合，**不含密码哈希**）。 */
export interface AuthenticatedUser {
  id   : string;
  email: string;
  name : string;
  role : AuthRole;
}

/**
 * 账号密码认证。
 *
 * @param email 登录邮箱（大小写不敏感）
 * @param password 明文密码
 * @returns 认证结果
 */
export async function authenticate(
  email: string,
  password: string
): Promise<AuthResult<AuthenticatedUser>> {
  const normalized = normalizeEmail(email);
  if (normalized.length === 0 || password.length === 0) {
    return { ok: false, reason: "invalid_input" };
  }

  const db = getDatabase();
  const rows = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  const row = rows[0];
  if (row === undefined) return { ok: false, reason: "invalid_credentials" };

  const matched = await verifyPassword(password, row.passwordHash);
  if (!matched) return { ok: false, reason: "invalid_credentials" };
  if (!row.isActive) return { ok: false, reason: "inactive" };

  await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, row.id));

  return {
    ok   : true,
    value: { id: row.id, email: row.email, name: row.name, role: row.role }
  };
}

/** 注册入参。 */
export interface RegisterInput {
  email   : string;
  username: string;
  name?   : string;
  password: string;
}

/**
 * 注册新账号。
 *
 * **角色恒为 `VIEWER`**：自助注册不得获得写权限；首个 ADMIN 由 `scripts/seed-admin.ts` 创建。
 *
 * @param input 注册信息
 * @returns 新建用户（不含密码）
 */
export async function registerUser(
  input: RegisterInput
): Promise<AuthResult<AuthenticatedUser>> {
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);

  if (!isValidEmail(email) || !isValidUsername(username)) {
    return { ok: false, reason: "invalid_input" };
  }
  if (!isAcceptablePassword(input.password)) {
    return { ok: false, reason: "weak_password" };
  }

  const db = getDatabase();
  const byEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (byEmail.length > 0) return { ok: false, reason: "email_taken" };

  const byUsername = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (byUsername.length > 0) return { ok: false, reason: "username_taken" };

  const passwordHash = await hashPassword(input.password);
  const displayName = input.name?.trim() ?? "";
  const inserted = await db
    .insert(users)
    .values({
      email,
      username,
      name    : displayName.length > 0 ? displayName : username,
      passwordHash,
      // 自助注册一律只读角色（防越权提权）。
      role    : AUTH_VIEWER_ROLE,
      isActive: true
    })
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role });

  const created = inserted[0];
  if (created === undefined) return { ok: false, reason: "invalid_input" };

  return { ok: true, value: created };
}

/**
 * 判断某邮箱是否已被占用（供 seed 脚本做幂等更新）。
 *
 * @param email 邮箱
 * @param excludeUserId 排除的用户 id（更新自身时用）
 * @returns 是否占用
 */
export async function isEmailTakenByOther(
  email: string,
  excludeUserId: string
): Promise<boolean> {
  const db = getDatabase();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, normalizeEmail(email)), ne(users.id, excludeUserId)))
    .limit(1);
  return rows.length > 0;
}
