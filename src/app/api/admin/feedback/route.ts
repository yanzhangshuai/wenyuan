import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { jsonFail, jsonOk } from "@/server/http/json";
import { listFeedback } from "@/server/modules/feedback/service";
import { getAuthContext } from "@/server/modules/auth/session";
import type { FeedbackStatus } from "@/server/db/schema";

/** 允许的查询参数值。 */
const STATUSES = new Set<string>(["pending", "accepted", "rejected"]);

/**
 * GET /api/admin/feedback?status=pending&bookId=...
 *
 * 队列默认看 `pending`；`status=all` 或不传则返回全部。
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await getAuthContext();
  if (auth === null || auth.role !== AUTH_ADMIN_ROLE) {
    return jsonFail("forbidden", "需要管理员权限", 403);
  }

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const bookId = url.searchParams.get("bookId") ?? undefined;
  const status: FeedbackStatus | undefined =
    rawStatus !== null && STATUSES.has(rawStatus) ? (rawStatus as FeedbackStatus) : undefined;

  const rows = await listFeedback({
    ...(status === undefined ? {} : { status }),
    ...(bookId === undefined ? {} : { bookId })
  });
  return jsonOk({ feedback: rows });
}
