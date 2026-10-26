import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { jsonFail, jsonOk } from "@/server/http/json";
import { listUsers } from "@/server/modules/auth/admin";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * GET /api/admin/users —— 用户列表（ADMIN）。
 *
 * 只读接口。改角色/停用走 `PATCH /api/admin/users/[id]`，
 * 两条护栏（不能动自己、不能没有管理员）都在服务端。
 */
export async function GET(): Promise<Response> {
  const auth = await getAuthContext();
  if (auth === null || auth.role !== AUTH_ADMIN_ROLE) {
    return jsonFail("forbidden", "需要管理员权限", 403);
  }

  const rows = await listUsers();
  return jsonOk({ users: rows, currentUserId: auth.id });
}
