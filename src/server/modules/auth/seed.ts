import "server-only";

import { eq } from "drizzle-orm";

import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";

import { hashPassword } from "./password";

/**
 * 管理员账号种子（幂等）。
 *
 * 语义：按邮箱 upsert —— 已存在则**重置密码并提升为 ADMIN、重新启用**。
 * 这正是生产环境「忘了管理员密码」的恢复路径，因此可以安全地重复执行。
 *
 * 注意：本函数不负责校验密码强度（由 `@/server/modules/seed/plan` 统一前置校验），
 * 这样 CLI 与编排脚本共用同一份规则，不会出现「一个入口严、一个入口松」。
 */

/** 入参。 */
export interface SeedAdminInput {
  email   : string;
  password: string;
  name    : string;
  username: string;
}

/** 结果。 */
export interface SeedAdminOutcome {
  action: "created" | "updated";
  email : string;
}

/**
 * 创建或更新管理员。
 *
 * @param input 管理员配置
 * @returns 动作类型
 */
export async function seedAdminAccount(input: SeedAdminInput): Promise<SeedAdminOutcome> {
  const db = getDatabase();
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

  if (existing.length > 0) {
    const id = existing[0]?.id;
    if (id === undefined) return { action: "updated", email };
    await db
      .update(users)
      .set({
        passwordHash,
        name     : input.name,
        role     : AUTH_ADMIN_ROLE,
        isActive : true,
        updatedAt: new Date()
      })
      .where(eq(users.id, id));
    return { action: "updated", email };
  }

  await db.insert(users).values({
    email,
    username: input.username,
    name    : input.name,
    passwordHash,
    role    : AUTH_ADMIN_ROLE,
    isActive: true
  });
  return { action: "created", email };
}
