import { z } from "zod";

import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { jsonFail, jsonOk, readJson } from "@/server/http/json";
import { resolveFeedback } from "@/server/modules/feedback/service";
import { getAuthContext } from "@/server/modules/auth/session";

const ResolveSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  note  : z.string().trim().max(500).default("")
});

/**
 * PATCH /api/admin/feedback/[id] —— 接受 / 拒绝一条反馈（ADMIN）。
 *
 * 只改状态与说明，**不自动改配置**：配置修改仍走页面上的显式保存，
 * 这样「谁改了什么」始终有明确的操作记录，而不是被一条反馈悄悄触发。
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
  const parsed = ResolveSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return jsonFail("invalid_request", parsed.error.issues[0]?.message ?? "请求体不合法", 400);
  }

  const result = await resolveFeedback(auth.id, id, parsed.data.status, parsed.data.note);
  if (!result.ok) {
    return jsonFail(result.reason, "反馈不存在", 404);
  }
  return jsonOk({ saved: true });
}
