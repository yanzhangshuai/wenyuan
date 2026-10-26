import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";
import type { AuthRole } from "@/lib/auth";

/**
 * 用户管理的服务端逻辑（ADMIN 专用）。
 *
 * ## 两条不可绕过的护栏
 *
 * 1. **不能动自己**：管理员把自己的角色降成 VIEWER，就再也进不来后台；
 *    把自己的账号停用，同理。这类操作在 UI 上禁掉不够（接口可以被直接调用），
 *    必须在服务端拒绝。
 * 2. **不能没有管理员**：降级或停用最后一个 ADMIN，会让整个后台永久失联，
 *    只能靠 `pnpm db:seed` 或直连数据库救回来。所以在改之前先数一遍。
 */

/** 列表行。 */
export interface AdminUserRow {
  id         : string;
  email      : string;
  username   : string;
  name       : string;
  role       : AuthRole;
  isActive   : boolean;
  lastLoginAt: string | null;
  createdAt  : string;
}

/** 更新结果。 */
export type UpdateUserResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "self_modify" | "last_admin" | "invalid_input" };

/**
 * 列出全部用户（含停用的）。
 *
 * @returns 按创建时间升序 —— 第一个通常是最早的 ADMIN，便于识别
 */
export async function listUsers(): Promise<AdminUserRow[]> {
  const db = getDatabase();
  const rows = await db.select().from(users).orderBy(users.createdAt);
  return rows.map((row) => ({
    id         : row.id,
    email      : row.email,
    username   : row.username,
    name       : row.name,
    role       : row.role,
    isActive   : row.isActive,
    lastLoginAt: row.lastLoginAt === null ? null : row.lastLoginAt.toISOString(),
    createdAt  : row.createdAt.toISOString()
  }));
}

/**
 * 修改用户的角色或启用状态。
 *
 * @param actorId 操作者 id（来自会话，不可由客户端指定）
 * @param targetId 被修改的用户
 * @param patch 只允许改 `role` / `isActive`
 * @returns 成功或拒绝原因
 */
export async function updateUser(
  actorId: string,
  targetId: string,
  patch: { role?: AuthRole; isActive?: boolean }
): Promise<UpdateUserResult> {
  if (patch.role === undefined && patch.isActive === undefined) {
    return { ok: false, reason: "invalid_input" };
  }
  // 护栏 1：不能动自己。改自己的角色或停用自己都会导致永久失去后台入口。
  if (actorId === targetId) {
    return { ok: false, reason: "self_modify" };
  }

  const db = getDatabase();
  const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (target === undefined) {
    return { ok: false, reason: "not_found" };
  }

  /**
   * 护栏 2：不能把最后一个管理员降级或停用。
   *
   * 只在「目标当前是 ADMIN 且将被降级/停用」时才数 —— 其它情况不必付这次查询。
   */
  const willLoseAdmin =
    target.role === "ADMIN" && (patch.role === "VIEWER" || patch.isActive === false);
  if (willLoseAdmin) {
    const others = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "ADMIN"), eq(users.isActive, true), ne(users.id, targetId)));
    if (others.length === 0) {
      return { ok: false, reason: "last_admin" };
    }
  }

  await db
    .update(users)
    .set({
      ...(patch.role === undefined ? {} : { role: patch.role }),
      ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
      updatedAt: new Date()
    })
    .where(eq(users.id, targetId));

  return { ok: true };
}
