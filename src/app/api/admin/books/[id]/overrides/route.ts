import { z } from "zod";

import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { getDatabase } from "@/server/db/client";
import { books, graphOverrides } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { jsonFail, jsonOk, readJson } from "@/server/http/json";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * POST /api/admin/books/[id]/overrides —— 写一条图谱覆盖（人工修正）。
 *
 * 覆盖层是**读时叠加**的（见 `graph_overrides` 表注释），不写图谱表 ——
 * `persistGraph` 是 DELETE+重插，直接改表会在下次解析时被整体冲掉。
 *
 * 能力边界：只有 `hide_entity` 与 `change_type` 能影响当前画面；
 * `drop_alias` / `add_alias` 会被接受并保存，但要等下次解析才生效
 * （响应里用 `effectiveNow` 明确告知，不让人以为已经改好了）。
 */

const PayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hide_entity") }),
  z.object({
    kind: z.literal("change_type"),
    type: z.enum(["PERSON", "LOCATION", "ORGANIZATION", "CONCEPT"])
  }),
  z.object({ kind: z.literal("drop_alias"), alias: z.string().trim().min(1).max(32) }),
  z.object({ kind: z.literal("add_alias"), alias: z.string().trim().min(1).max(32) })
]);

const BodySchema = z.object({
  targetName: z.string().trim().min(1).max(64),
  payload   : PayloadSchema,
  note      : z.string().trim().max(200).optional()
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await getAuthContext();
  if (auth === null || auth.role !== AUTH_ADMIN_ROLE) {
    return jsonFail("forbidden", "需要管理员权限", 403);
  }

  const { id } = await context.params;
  const parsed = BodySchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return jsonFail("invalid_request", parsed.error.issues[0]?.message ?? "请求体不合法", 400);
  }

  const db = getDatabase();
  const [book] = await db.select({ id: books.id }).from(books).where(eq(books.id, id)).limit(1);
  if (book === undefined) {
    return jsonFail("not_found", "作品不存在", 404);
  }

  const { targetName, payload, note } = parsed.data;

  await db.insert(graphOverrides).values({
    bookId    : id,
    kind      : payload.kind,
    targetName,
    payload,
    createdBy : auth.id,
    note      : note ?? null
  });

  // 只有这两种改的是「节点本身」，快照里看得见。
  const effectiveNow = payload.kind === "hide_entity" || payload.kind === "change_type";

  return jsonOk({ saved: true, effectiveNow }, 201);
}
