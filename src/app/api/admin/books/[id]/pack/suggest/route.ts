import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { jsonFail, jsonOk } from "@/server/http/json";
import { buildSuggestedPack } from "@/server/modules/analysis/pack-suggest/build";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * POST /api/admin/books/[id]/pack/suggest
 *
 * 生成「建议配置」：扫描全书候选 → 模型分组 → 写 `book_packs`（`status=draft`）。
 *
 * ## 为什么同步执行（而不是像解析那样丢给子进程）
 *
 * - 它**不碰图谱**、不写 `entities`/`relationships`，失败最坏结果是没有配置；
 * - 耗时集中在一次全书分词扫描 + **一次**模型调用（红楼约 1–2 分钟），
 *   没有「跑几十分钟」的风险；
 * - 同步返回结果，页面能立刻显示「扫了多少候选、生成多少组、模型编造的别名被砍了几条」——
 *   这些数字是用户判断「这套机制靠不靠谱」的依据，丢进后台日志就看不见了。
 *
 * 代价是请求会挂 1–2 分钟。前端按钮必须显示「正在扫描全书」的进度提示，
 * 不能让用户以为卡死。
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
  try {
    const result = await buildSuggestedPack(id);
    return jsonOk({ result }, 201);
  } catch (error) {
    return jsonFail(
      "suggest_failed",
      error instanceof Error ? error.message : "生成建议配置失败",
      422
    );
  }
}
