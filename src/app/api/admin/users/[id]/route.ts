import { z } from "zod";

import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { jsonFail, jsonOk, readJson } from "@/server/http/json";
import { updateUser } from "@/server/modules/auth/admin";
import { getAuthContext } from "@/server/modules/auth/session";

/** 只允许改角色与启用状态 —— 邮箱、密码、用户名不在这里改。 */
const PatchSchema = z.object({
  role    : z.enum(["ADMIN", "VIEWER"]).optional(),
  isActive: z.boolean().optional()
});

/** 拒绝原因 → 用户可读文案。 */
const REASON_MESSAGES: Record<string, string> = {
  not_found   : "用户不存在",
  self_modify : "不能修改自己的角色或状态（会导致失去后台入口）",
  last_admin  : "这是最后一个管理员，降级或停用会让后台永久失联",
  invalid_input: "请求体不合法"
};

/**
 * PATCH /api/admin/users/[id] —— 改角色 / 停用启用（ADMIN）。
 *
 * 护栏在服务端（`updateUser`），UI 上禁用只是提示：
 * 直接打接口同样会被拒。
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await getAuthContext();
  if (auth === null || auth.role !== AUTH_ADMIN_ROLE) {
    return jsonFail("forbidden", "需要管理员权限", 403);
  }

  const { id } = await context.params;
  const parsed = PatchSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return jsonFail("invalid_request", parsed.error.issues[0]?.message ?? "请求体不合法", 400);
  }

  const result = await updateUser(auth.id, id, parsed.data);
  if (!result.ok) {
    return jsonFail(result.reason, REASON_MESSAGES[result.reason] ?? "更新失败", 400);
  }
  return jsonOk({ saved: true });
}
