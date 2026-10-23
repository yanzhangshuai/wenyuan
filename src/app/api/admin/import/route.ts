import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { jsonFail, jsonOk } from "@/server/http/json";
import { MAX_FILE_BYTES, importBookFromText } from "@/server/modules/admin/import-service";
import { enqueueAnalysis } from "@/server/modules/analysis/runner";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * POST /api/admin/import
 *
 * 表单字段：`file`（必填，txt）、`title`（可空，默认取文件名）、`author`（可空）。
 *
 * 安全与边界：
 * - **必须 ADMIN**：布局层的守卫挡不住直接打接口，这里必须独立校验；
 * - 只接受纯文本，且限制 20 MB；
 * - 导入成功后**自动入队解析**（独立子进程，不在本请求内执行），
 *   进度通过 `GET /api/admin/books/[id]/status` 轮询。
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await getAuthContext();
  if (auth === null) {
    return jsonFail("forbidden", "需要管理员权限", 403);
  }
  if (auth.role !== AUTH_ADMIN_ROLE) {
    return jsonFail("forbidden", "需要管理员权限", 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonFail("invalid_request", "请求必须是 multipart/form-data", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonFail("missing_file", "请选择要导入的文本文件", 400);
  }
  if (file.size === 0) {
    return jsonFail("empty_file", "文件为空", 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return jsonFail("file_too_large", "文件超过 20 MB 上限", 413);
  }

  const rawTitle = form.get("title");
  const rawAuthor = form.get("author");
  const fallbackTitle = file.name.replace(/\.[^.]+$/u, "");
  const title = (typeof rawTitle === "string" && rawTitle.trim().length > 0 ? rawTitle : fallbackTitle).trim();
  const authorText = typeof rawAuthor === "string" ? rawAuthor.trim() : "";
  const author = authorText.length > 0 ? authorText : null;

  if (title.length === 0) {
    return jsonFail("missing_title", "作品标题不能为空", 400);
  }

  try {
    const text = await file.text();
    const result = await importBookFromText(title, author, text);
    // 导入即解析：入队后立即返回，真正的执行在独立子进程里（见 runner.ts）。
    // 入队失败（队列满 / 已在跑）不影响导入本身的结果 —— 导入已经成功落库。
    const analysis = await enqueueAnalysis(result.bookId);
    return jsonOk({ result, analysis }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入失败";
    return jsonFail("import_failed", message, 422);
  }
}
