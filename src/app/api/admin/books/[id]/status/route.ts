import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { jsonFail, jsonOk } from "@/server/http/json";
import { loadAnalysisStatus } from "@/server/modules/admin/analysis-status";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * GET /api/admin/books/[id]/status
 *
 * 返回该作品最近一次解析的进度快照，供后台轮询。
 *
 * 为什么单独开一个接口而不是让页面整页刷新：解析要跑 3–8 分钟，
 * 整页刷新会把书籍列表、统计卡片全部重算一遍；进度只是一个小面板的数据。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await getAuthContext();
  if (auth === null || auth.role !== AUTH_ADMIN_ROLE) {
    return jsonFail("forbidden", "需要管理员权限", 403);
  }

  const { id } = await context.params;
  if (id.trim().length === 0) {
    return jsonFail("invalid_request", "缺少作品 ID", 400);
  }

  const snapshot = await loadAnalysisStatus(id);
  if (snapshot === null) {
    return jsonFail("not_found", "作品不存在", 404);
  }

  return jsonOk({ snapshot });
}
