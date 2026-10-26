import { eq } from "drizzle-orm";
import { z } from "zod";

import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { getDatabase } from "@/server/db/client";
import { bookPacks, books } from "@/server/db/schema";
import { jsonFail, jsonOk, readJson } from "@/server/http/json";
import { loadWorkPack } from "@/server/modules/analysis/genre-pack/load";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * GET /api/admin/books/[id]/pack   —— 读这本书的解析条件
 * PUT /api/admin/books/[id]/pack   —— 保存（手工编辑或确认）
 *
 * 读的时候同时返回「库里存的」与「实际生效的」：
 * 库里有配置就用库里的，没有则回落内置包/空词典。页面需要能说清
 * 「你现在看到的是哪一份」，否则用户会以为改了代码里的包。
 */

/** 保存请求体。 */
const SavePackSchema = z.object({
  properNouns: z
    .array(
      z.object({
        name  : z.string().trim().min(1).max(32),
        postag: z.number().int().refine((value) => value === 128 || value === 64, "postag 只能是 128(人名) 或 64(地名)")
      })
    )
    .max(2000),
  aliasGroups: z.array(z.array(z.string().trim().min(1).max(32)).min(2)).max(500),
  status     : z.enum(["draft", "confirmed"]).optional()
});

/** 统一鉴权。 */
async function requireAdmin(): Promise<Response | null> {
  const auth = await getAuthContext();
  if (auth === null || auth.role !== AUTH_ADMIN_ROLE) {
    return jsonFail("forbidden", "需要管理员权限", 403);
  }
  return null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const denied = await requireAdmin();
  if (denied !== null) return denied;

  const { id } = await context.params;
  const db = getDatabase();
  const [row] = await db.select().from(bookPacks).where(eq(bookPacks.bookId, id)).limit(1);
  const [book] = await db.select({ title: books.title }).from(books).where(eq(books.id, id)).limit(1);
  if (book === undefined) {
    return jsonFail("not_found", "作品不存在", 404);
  }

  // 「实际生效」要问 loadWorkPack —— 它才是解析时真正走的那条路径，
  // 这里不重写一份回落逻辑（两份口径必然漂移）。
  const effective = await loadWorkPack(id, book.title);

  return jsonOk({
    stored:
      row === undefined
        ? null
        : {
            source        : row.source,
            status        : row.status,
            properNouns   : row.properNouns,
            aliasGroups   : row.aliasGroups,
            suggestionNote: row.suggestionNote,
            metrics       : row.metrics,
            updatedAt     : row.updatedAt.toISOString()
          },
    effective: {
      origin          : effective.origin,
      packId          : effective.pack.id,
      packLabel       : effective.pack.label,
      properNounCount : effective.properNounCount,
      aliasGroupCount : effective.aliasGroupCount
    }
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const denied = await requireAdmin();
  if (denied !== null) return denied;

  const { id } = await context.params;
  const parsed = SavePackSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return jsonFail("invalid_request", parsed.error.issues[0]?.message ?? "请求体不合法", 400);
  }

  // 规范化：去重、去自环、去空组。存进去的必须是「可以直接喂给分词器」的形态，
  // 而不是把清洗留给读取侧（读取侧还有内置包与空词典两条路径，不该各写一遍）。
  const properNouns = dedupeProperNouns(parsed.data.properNouns);
  const aliasGroups = normalizeAliasGroups(parsed.data.aliasGroups);

  const db = getDatabase();
  await db
    .insert(bookPacks)
    .values({
      bookId    : id,
      source    : "custom",
      status    : parsed.data.status ?? "confirmed",
      properNouns,
      aliasGroups,
      updatedAt : new Date()
    })
    .onConflictDoUpdate({
      target: bookPacks.bookId,
      set   : {
        // 人工保存过就视为 custom —— 即便内容是从 generated 改出来的，
        // 责任主体已经从「模型建议」变成「人确认过的配置」。
        source    : "custom",
        status    : parsed.data.status ?? "confirmed",
        properNouns,
        aliasGroups,
        updatedAt : new Date()
      }
    });

  return jsonOk({ saved: true, properNounCount: properNouns.length, aliasGroupCount: aliasGroups.length });
}

/** 去重（同名保留首次出现的词性），并按名字排序保证输出稳定。 */
export function dedupeProperNouns(
  items: readonly { name: string; postag: number }[]
): { name: string; postag: number }[] {
  const seen = new Map<string, number>();
  for (const item of items) {
    if (!seen.has(item.name)) seen.set(item.name, item.postag);
  }
  return [...seen.entries()]
    .map(([name, postag]) => ({ name, postag }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

/** 组内去重、剔除自环与单元素组。 */
export function normalizeAliasGroups(groups: readonly (readonly string[])[]): string[][] {
  const result: string[][] = [];
  for (const group of groups) {
    const unique = [...new Set(group)];
    if (unique.length < 2) continue;
    result.push(unique);
  }
  return result;
}
