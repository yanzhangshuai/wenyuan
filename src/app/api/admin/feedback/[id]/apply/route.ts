import { eq } from "drizzle-orm";

import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { getDatabase } from "@/server/db/client";
import { graphOverrides, packFeedback } from "@/server/db/schema";
import { jsonFail, jsonOk } from "@/server/http/json";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * POST /api/admin/feedback/[id]/apply —— 按反馈执行修改。
 *
 * ## 为什么只有两类能「立刻生效」
 *
 * `GraphNode` 不带别名，所以覆盖层只能改「节点本身」（隐藏 / 改类型）：
 *
 * | 反馈类型 | 能否立刻执行 | 原因 |
 * | --- | --- | --- |
 * | `wrong_type` | ✅ 写 `change_type` 覆盖 | 改的是节点类型 |
 * | `wrong_merge` | ❌ | 合并已发生（一个 uuid），摘别名不会让它们分开；只能改别名组 + 重跑 |
 * | `missing_alias` | ❌ | 快照没有别名字段，加了也看不见；只能改别名组 + 重跑 |
 * | `missing_entity` | ❌ | 要造一个没有原文依据的实体，与「证据可追溯」冲突 |
 *
 * 后三类返回 422 并说明该走哪条路 —— **假装能一键修好比直接说不行更糟**。
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

  const [row] = await db.select().from(packFeedback).where(eq(packFeedback.id, id)).limit(1);
  if (row === undefined) {
    return jsonFail("not_found", "反馈不存在", 404);
  }
  if (row.status !== "pending") {
    return jsonFail("already_resolved", "这条反馈已处理过", 409);
  }

  const payload = row.payload;

  if (payload.kind !== "wrong_type") {
    const guidance: Record<string, string> = {
      wrong_merge   : "错并的实体已经合并成一个，摘别名无法拆开。请改别名组后重新解析。",
      missing_alias : "别名只在解析时写入图谱，当前页面无法追加。请改别名组后重新解析。",
      missing_entity: "新增实体需要原文依据，不能凭空造。请重新解析或人工确认是否需要。"
    };
    return jsonFail("needs_reparse", guidance[payload.kind] ?? "这条反馈无法直接执行", 422);
  }

  await db.insert(graphOverrides).values({
    bookId          : row.bookId,
    kind            : "change_type",
    targetName      : payload.name,
    payload         : { kind: "change_type", type: payload.expectedType },
    sourceFeedbackId: row.id,
    createdBy       : auth.id,
    note            : `来自反馈：${payload.name} 应为 ${payload.expectedType}`
  });

  await db
    .update(packFeedback)
    .set({
      status    : "accepted",
      note      : `已改类型：${payload.name} → ${payload.expectedType}`,
      resolvedBy: auth.id,
      resolvedAt: new Date()
    })
    .where(eq(packFeedback.id, id));

  return jsonOk({ applied: "change_type", target: payload.name });
}
