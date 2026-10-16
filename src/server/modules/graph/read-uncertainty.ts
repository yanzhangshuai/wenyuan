import "server-only";

import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";

import {
  computeUncertainty,
  type UncertaintyEntityInput,
  type UncertaintyRelationInput
} from "@/lib/graph/uncertainty";
import { getDatabase } from "@/server/db/client";
import {
  books,
  chapters,
  entities,
  entityAliases,
  entityMentions,
  evidenceSpans,
  paragraphs,
  relationships
} from "@/server/db/schema";
import { judgeEntityName } from "@/server/modules/analysis/pipeline/entity-gate";
import {
  isHonorificForm,
  isProperNameForm
} from "@/server/modules/analysis/pipeline/name-form";
import type { UncertaintyReport } from "@/types/graph";

/**
 * 不确定性报告的读侧装配（设计文档 §5.3「读时叠加」）。
 *
 * 与 `loadGraphSnapshot` 的三个关键差异：
 * 1. **不裁剪** —— `loadGraphSnapshot` 的 nodes/edges 是渲染子集，
 *    不确定性检测必须跑在**全库**实体/关系上，否则就是「切片尺子」；
 * 2. **只派生、不写库** —— 检测结果是图谱的确定性派生（铁律：不写图谱表）；
 * 3. **并列返回** —— 返回值永不合并进 GraphSnapshot（铁律：评测口径不引用）。
 *
 * 词表相关判定（闸门复核 / 词形判断）在**本层**预计算后注入纯函数层，
 * 使 `src/lib/graph/uncertainty.ts` 保持零管线依赖、可纯单测。
 */

/**
 * 读取并计算作品的不确定性报告。
 *
 * @param bookId 作品 ID
 * @returns 不确定性报告；作品不存在时返回 null
 */
export const loadUncertainty = cache(async (bookId: string): Promise<UncertaintyReport | null> => {
  await connection();

  const db = getDatabase();

  // 与 loadGraphSnapshot 同一语义：作品不存在 → null（页面据此 404）。
  const [book] = await db
    .select({ id: books.id })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);

  if (book === undefined) {
    return null;
  }

  const [entityRows, aliasRows, relationRows, evidenceRows, mentionRows, chapterRows, paragraphRows] =
    await Promise.all([
      db
        .select({
          id       : entities.id,
          canonical: entities.canonical,
          type     : entities.type
        })
        .from(entities)
        .where(eq(entities.bookId, bookId)),

      db
        .select({ entityId: entityAliases.entityId })
        .from(entityAliases)
        .where(eq(entityAliases.bookId, bookId)),

      db
        .select({
          id      : relationships.id,
          sourceId: relationships.sourceEntityId,
          targetId: relationships.targetEntityId,
          code    : relationships.relationTypeCode,
          status  : relationships.status
        })
        .from(relationships)
        .where(eq(relationships.bookId, bookId)),

      // 证据计数：只要 relationship_id 非空的行（实体提及证据不参与关系计数）。
      db
        .select({ relationshipId: evidenceSpans.relationshipId })
        .from(evidenceSpans)
        .innerJoin(relationships, eq(evidenceSpans.relationshipId, relationships.id))
        .where(eq(relationships.bookId, bookId)),

      db
        .select({
          entityId   : entityMentions.entityId,
          paragraphId: entityMentions.paragraphId
        })
        .from(entityMentions)
        .innerJoin(entities, eq(entityMentions.entityId, entities.id))
        .where(eq(entities.bookId, bookId)),

      db
        .select({ id: chapters.id, ordinal: chapters.ordinal })
        .from(chapters)
        .where(eq(chapters.bookId, bookId)),

      db
        .select({ id: paragraphs.id, chapterId: paragraphs.chapterId })
        .from(paragraphs)
        .innerJoin(chapters, eq(paragraphs.chapterId, chapters.id))
        .where(eq(chapters.bookId, bookId))
    ]);

  const nameById = new Map(entityRows.map((row) => [row.id, row.canonical]));
  const chapterOrdinalById = new Map(chapterRows.map((row) => [row.id, row.ordinal]));
  const chapterByParagraph = new Map(paragraphRows.map((row) => [row.id, row.chapterId]));

  const aliasCounts = new Map<string, number>();
  for (const row of aliasRows) {
    aliasCounts.set(row.entityId, (aliasCounts.get(row.entityId) ?? 0) + 1);
  }

  const evidenceCounts = new Map<string, number>();
  for (const row of evidenceRows) {
    if (row.relationshipId === null) continue;
    evidenceCounts.set(row.relationshipId, (evidenceCounts.get(row.relationshipId) ?? 0) + 1);
  }

  const paragraphsByEntity = new Map<string, string[]>();
  const chaptersByEntity = new Map<string, number[]>();
  for (const row of mentionRows) {
    const list = paragraphsByEntity.get(row.entityId) ?? [];
    list.push(row.paragraphId);
    paragraphsByEntity.set(row.entityId, list);

    const chapterId = chapterByParagraph.get(row.paragraphId);
    const ordinal = chapterId === undefined ? undefined : chapterOrdinalById.get(chapterId);
    if (ordinal !== undefined) {
      const chapterList = chaptersByEntity.get(row.entityId) ?? [];
      chapterList.push(ordinal);
      chaptersByEntity.set(row.entityId, chapterList);
    }
  }

  const entityInputs: UncertaintyEntityInput[] = entityRows.map((row) => {
    // 溯源矛盾的数据源：用**现行闸门**复核落库 canonical。
    // 闸门是纯函数（词表来自题材包），此调用零 LLM、$0。
    const verdict = judgeEntityName(row.canonical, row.type);
    const mentionParagraphs = paragraphsByEntity.get(row.id) ?? [];
    return {
      id             : row.id,
      canonical      : row.canonical,
      type           : row.type,
      aliasCount     : aliasCounts.get(row.id) ?? 0,
      honorificForm  : isHonorificForm(row.canonical),
      properNameForm : isProperNameForm(row.canonical),
      gateRejection  : verdict.accepted ? null : verdict.reason,
      mentionCount   : mentionParagraphs.length,
      paragraphIds   : mentionParagraphs,
      chapterOrdinals: chaptersByEntity.get(row.id) ?? []
    };
  });

  const relationInputs: UncertaintyRelationInput[] = relationRows.map((row) => ({
    id      : row.id,
    sourceId: row.sourceId,
    targetId: row.targetId,
    pairKey:
      `${nameById.get(row.sourceId) ?? "?"}⇄${nameById.get(row.targetId) ?? "?"}[${row.code}]`,
    status       : row.status,
    evidenceCount: evidenceCounts.get(row.id) ?? 0
  }));

  return computeUncertainty({ entities: entityInputs, relations: relationInputs });
});
