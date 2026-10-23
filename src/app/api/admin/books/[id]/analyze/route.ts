import { eq } from "drizzle-orm";

import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { getDatabase } from "@/server/db/client";
import { books } from "@/server/db/schema";
import { jsonFail, jsonOk } from "@/server/http/json";
import { enqueueAnalysis } from "@/server/modules/analysis/runner";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * POST /api/admin/books/[id]/analyze
 *
 * 手动（重新）发起解析：入队后立即返回 202，真正的执行在独立子进程里。
 *
 * 为什么不是 `await runPipeline()`：一次 3–8 分钟，HTTP 请求必然超时；
 * 而且请求断开后的行为在不同部署形态下不一致。
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await getAuthContext();
  if (auth === null || auth.role !== AUTH_ADMIN_ROLE) {
    return jsonFail("forbidden", "需要管理员权限", 403);
  }

  const { id } = await context.params;
  const db = getDatabase();
  const [book] = await db.select({ id: books.id }).from(books).where(eq(books.id, id)).limit(1);
  if (book === undefined) {
    return jsonFail("not_found", "作品不存在", 404);
  }

  const result = await enqueueAnalysis(id);
  if (!result.queued) {
    return jsonFail(
      result.reason ?? "not_queued",
      result.reason === "queue_full" ? "解析队列已满，请稍后再试" : "该作品正在解析中",
      409
    );
  }

  return jsonOk({ position: result.position }, 202);
}
