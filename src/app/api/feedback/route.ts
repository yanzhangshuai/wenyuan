import { jsonFail, jsonOk, readJson } from "@/server/http/json";
import { submitFeedback } from "@/server/modules/feedback/service";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * POST /api/feedback —— 提交读者反馈。
 *
 * **仅登录用户**（产品决定）：反馈的价值在于「不同人提同一件事」，
 * 匿名提交既无法去重、也无法在滥用时追溯。
 *
 * 请求体：`{ bookId, payload }`，`payload.kind` 决定其余字段
 * （见 `src/server/modules/feedback/service.ts` 的 PayloadSchema）。
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await getAuthContext();
  if (auth === null) {
    return jsonFail("unauthorized", "请先登录", 401);
  }

  const body = (await readJson(request)) as { bookId?: unknown; payload?: unknown };
  if (typeof body.bookId !== "string" || body.bookId.length === 0) {
    return jsonFail("invalid_request", "缺少 bookId", 400);
  }

  const result = await submitFeedback(auth.id, body.bookId, body.payload);
  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid_input  : "反馈内容不合法",
      book_not_found : "作品不存在",
      duplicate      : "你已经提过同样的反馈，管理员还没处理"
    };
    return jsonFail(result.reason, messages[result.reason] ?? "提交失败", 400);
  }

  return jsonOk({ id: result.id }, 201);
}
