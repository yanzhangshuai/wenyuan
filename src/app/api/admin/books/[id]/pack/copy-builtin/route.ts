import { eq } from "drizzle-orm";

import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { getDatabase } from "@/server/db/client";
import { bookPacks, books } from "@/server/db/schema";
import { jsonFail, jsonOk } from "@/server/http/json";
import { resolveWorkPack } from "@/server/modules/analysis/genre-pack";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * POST /api/admin/books/[id]/pack/copy-builtin
 *
 * 把内置作品包**复制一份**到库里，之后这本书就用库里的配置（可自由编辑）。
 *
 * ## 为什么必须有这一步
 *
 * 内置包（儒林 135 专名 / 红楼 163）在代码里，页面改不了。
 * 用户看到别名错并（实测 `鲍廷玺` 的别名含 `姑丈人`/`姑太爷`）却无处下手 ——
 * 没有「复制到库」这一步，配置页对这两本书就是只读的。
 *
 * ## 为什么复制后 `status = confirmed`
 *
 * 内容来自**人工策展并经过金标验证**的包，不是模型生成的草稿。
 * 标成 `draft` 会误导用户以为它没被审过。
 *
 * ## 与「自动生成」的区别
 *
 * 自动生成是**从零产出**（实测质量明显更低：红楼 145 专名 / 3 组 vs 内置 163 / 32）。
 * 复制是**沿用已验证的资产**，只把它的存放位置从代码搬到库里。
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

  const [book] = await db.select({ title: books.title }).from(books).where(eq(books.id, id)).limit(1);
  if (book === undefined) {
    return jsonFail("not_found", "作品不存在", 404);
  }

  const [existing] = await db
    .select({ id: bookPacks.id })
    .from(bookPacks)
    .where(eq(bookPacks.bookId, id))
    .limit(1);
  if (existing !== undefined) {
    // 已经有库内配置时不允许覆盖 —— 用户可能已经改过，覆盖等于丢掉他的工作。
    return jsonFail("already_exists", "这本书已有自定义配置，如需重置请先清空", 409);
  }

  const resolved = resolveWorkPack(book.title);
  if (!resolved.matched) {
    return jsonFail("no_builtin", "这本书没有内置作品包，请用「自动生成建议」", 422);
  }

  const properNouns = resolved.pack.properNouns.map(([name, postag]) => ({ name, postag }));
  const aliasGroups = (resolved.pack.aliasGroups ?? []).map((group) => [...group]);

  await db.insert(bookPacks).values({
    bookId        : id,
    source        : "builtin",
    status        : "confirmed",
    properNouns,
    aliasGroups,
    suggestionNote: `copied from builtin pack "${resolved.pack.id}" (${resolved.matchedAlias ?? ""})`,
    updatedAt     : new Date()
  });

  return jsonOk(
    {
      properNounCount: properNouns.length,
      aliasGroupCount: aliasGroups.length,
      packId         : resolved.pack.id
    },
    201
  );
}
