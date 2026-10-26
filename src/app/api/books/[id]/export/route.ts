import { eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { entityAliases } from "@/server/db/schema";
import { jsonFail } from "@/server/http/json";
import { getAuthContext } from "@/server/modules/auth/session";
import { toEntitiesCsv, toGraphJson, toRelationshipsCsv } from "@/server/modules/graph/export";
import { loadGraphSnapshot } from "@/server/modules/graph/read-graph";

/**
 * GET /api/books/[id]/export?type=entities|relationships|json
 *
 * 导出图谱。**登录用户即可**（图谱本身对 VIEWER 开放，导出只是换个格式看同样的数据）。
 *
 * 为什么分三个文件而不是打一个 zip：CSV 是给人用 Excel 看的，
 * JSON 是给程序读的，混在一个包里反而每次都要解压挑文件。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await getAuthContext();
  if (auth === null) {
    return jsonFail("unauthorized", "请先登录", 401);
  }

  const { id } = await context.params;
  const type = new URL(request.url).searchParams.get("type") ?? "json";

  const snapshot = await loadGraphSnapshot(id);
  if (snapshot === null) {
    return jsonFail("not_found", "作品不存在或尚未解析", 404);
  }

  const db = getDatabase();
  const aliasRows = await db
    .select({ entityId: entityAliases.entityId, alias: entityAliases.alias })
    .from(entityAliases)
    .where(eq(entityAliases.bookId, id));
  const aliasesByEntity = new Map<string, string[]>();
  for (const row of aliasRows) {
    const list = aliasesByEntity.get(row.entityId) ?? [];
    list.push(row.alias);
    aliasesByEntity.set(row.entityId, list);
  }

  const input = { snapshot, aliasesByEntity };
  // 文件名去掉文件系统非法字符，避免下载时被浏览器截断或替换成乱码。
  const safeTitle = snapshot.bookTitle.replace(/[\\/:*?"<>|]/gu, "_");

  switch (type) {
    case "entities":
      return download(toEntitiesCsv(input), `${safeTitle}-实体.csv`, "text/csv; charset=utf-8");
    case "relationships":
      return download(
        toRelationshipsCsv(input),
        `${safeTitle}-关系.csv`,
        "text/csv; charset=utf-8"
      );
    default:
      return download(toGraphJson(input), `${safeTitle}-图谱.json`, "application/json; charset=utf-8");
  }
}

/** 附件下载响应（中文文件名走 RFC 5987 的 `filename*`，同时给 ASCII 兜底）。 */
function download(content: string, filename: string, contentType: string): Response {
  const encoded = encodeURIComponent(filename);
  return new Response(content, {
    headers: {
      "content-type"  : contentType,
      "content-disposition": `attachment; filename="export"; filename*=UTF-8''${encoded}`,
      // 大图谱（红楼 1000+ 实体）不缓存，避免用户拿到旧数据。
      "cache-control" : "no-store"
    }
  });
}
