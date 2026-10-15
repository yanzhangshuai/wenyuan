import "server-only";

import { and, asc, eq, inArray, or } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";

import { resolveRelationCategory } from "@/lib/graph/grouping";
import { groupDeedsByChapter } from "@/lib/graph/profile";
import { getDatabase } from "@/server/db/client";
import {
  chapters,
  entities,
  entityAliases,
  entityMentions,
  evidenceSpans,
  paragraphs,
  relationships
} from "@/server/db/schema";
import type { EntityDeed, EntityProfile, EntityRelationBrief } from "@/types/profile";

/**
 * 实体档案查询（服务端）——「人物百科」的**确定性**数据来源。
 *
 * ## 为什么这里不调 LLM
 *
 * 本项目的成本承诺是「**线性可预测**」（extract 占 93.7%～97.7%）。
 * 事迹时间线所需的全部信息**已经在库里**：`entity_mentions` 是段落级记录，
 * 而 `paragraphs → chapters` 提供了回号坐标。按
 * `(chapter.ordinal, paragraph.ordinal, start_offset)` 排序，
 * 直接得到「第 N 回 · 该段原文」的流水 —— 零模型调用、零额外成本、
 * **同输入必然同输出**（因此可以用 runId 锚定、可以进评测口径）。
 *
 * 「概述」（一句话小传）是另一个问题：它需要归纳，属 LLM 范畴。
 * 本模块**不提供**概述字段 —— 数据层给事实，归纳留在离线工具里，
 * 两者分离才能保证「花不花钱」是一个被看见的决定。
 *
 * ## 分档而非一刀切
 *
 * 实测《儒林外史》873 实体提及数中位数 **2**、《红楼梦》1004 实体中位数 **1**：
 * 过半实体只出现一两次，时间线只有一行。渲染层必须据此区别对待
 * （见 `classifyDensity`），否则会给「王胡子」这种配角生成一段空洞的介绍。
 */

/**
 * 读取实体档案快照。
 *
 * @param entityId 实体 ID
 * @returns 档案快照；实体不存在时返回 null
 */
export const loadEntityProfile = cache(async (entityId: string): Promise<EntityProfile | null> => {
  // 显式声明运行时边界，阻止构建期预渲染执行数据库查询（与 `read-graph.ts` 同口径）。
  await connection();

  const db = getDatabase();

  const [entity] = await db
    .select({
      id          : entities.id,
      canonical   : entities.canonical,
      type        : entities.type,
      factionIndex: entities.factionIndex
    })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);

  if (entity === undefined) {
    return null;
  }

  const [aliasRows, mentionRows] = await Promise.all([
    db
      .select({ alias: entityAliases.alias })
      .from(entityAliases)
      .where(eq(entityAliases.entityId, entityId))
      .orderBy(asc(entityAliases.alias)),

    // 事迹时间线的唯一查询：提及 → 段落 → 章节，一次取齐。
    // 排序键与探针实测一致 —— 缺了 `start_offset` 时同段内多条提及顺序不稳定。
    db
      .select({
        chapterOrdinal  : chapters.ordinal,
        chapterTitle    : chapters.title,
        paragraphOrdinal: paragraphs.ordinal,
        paragraphText   : paragraphs.text,
        surface         : entityMentions.surface,
        startOffset     : entityMentions.startOffset,
        endOffset       : entityMentions.endOffset
      })
      .from(entityMentions)
      .innerJoin(paragraphs, eq(entityMentions.paragraphId, paragraphs.id))
      .innerJoin(chapters, eq(paragraphs.chapterId, chapters.id))
      .where(and(eq(entityMentions.entityId, entityId)))
      .orderBy(
        asc(chapters.ordinal),
        asc(paragraphs.ordinal),
        asc(entityMentions.startOffset)
      )
  ]);

  const deeds: EntityDeed[] = mentionRows.map((row) => ({
    chapterOrdinal  : row.chapterOrdinal,
    chapterTitle    : row.chapterTitle,
    paragraphOrdinal: row.paragraphOrdinal,
    surface         : row.surface,
    paragraphText   : row.paragraphText,
    startOffset     : row.startOffset,
    endOffset       : row.endOffset
  }));

  const timeline = groupDeedsByChapter(deeds);
  const chapterOrdinals = timeline.map((group) => group.chapterOrdinal);

  return {
    id          : entity.id,
    name        : entity.canonical,
    type        : entity.type,
    factionIndex: entity.factionIndex,
    aliases     : aliasRows.map((row) => row.alias),
    mentionCount: deeds.length,
    chapterCount: chapterOrdinals.length,
    firstChapter: chapterOrdinals[0] ?? null,
    lastChapter : chapterOrdinals.at(-1) ?? null,
    timeline
  };
});

/**
 * 读取实体在本书内的关系简述（档案页的「第 2 层：关系时间轴」）。
 *
 * 与 `loadEntityProfile` 分开的理由：
 * - 两者的**失败语义不同** —— 实体不存在时档案返回 null，而关系为空是合法状态
 *   （大量长尾实体没有任何关系记录），合并成一个返回值会让「不存在」与「无关系」混淆；
 * - 档案页可以**先渲染时间线、再补关系**，不必被关系查询拖慢首屏。
 *
 * 为什么只取首条 quote：档案页的关系表是**索引**（点了跳图谱看全部依据），
 * 全量证据留给图谱详情卡（那里才有逐条展开的空间）。
 *
 * @param entityId 实体 ID
 * @returns 关系简述；按分组、再按起始回号排序
 */
export const loadEntityRelations = cache(
  async (entityId: string): Promise<EntityRelationBrief[]> => {
    await connection();

    const db = getDatabase();

    // 两个方向都算：`relationships` 是邻接表，无向遍历须以 OR 合并。
    const rows = await db
      .select({
        id          : relationships.id,
        sourceId    : relationships.sourceEntityId,
        targetId    : relationships.targetEntityId,
        typeCode    : relationships.relationTypeCode,
        startChapter: relationships.startChapter,
        endChapter  : relationships.endChapter,
        status      : relationships.status
      })
      .from(relationships)
      .where(
        or(
          eq(relationships.sourceEntityId, entityId),
          eq(relationships.targetEntityId, entityId)
        )
      )
      .orderBy(asc(relationships.startChapter));

    if (rows.length === 0) {
      return [];
    }

    const counterpartIds = [
      ...new Set(
        rows.map((row) => (row.sourceId === entityId ? row.targetId : row.sourceId))
      )
    ];

    const [counterpartRows, quoteRows] = await Promise.all([
      db
        .select({ id: entities.id, canonical: entities.canonical })
        .from(entities)
        .where(inArray(entities.id, counterpartIds)),

      // 每条关系取**一条**证据（按 start_offset 稳定取最小者），供档案页摘要展示。
      db
        .select({
          relationshipId: evidenceSpans.relationshipId,
          quote         : evidenceSpans.quote
        })
        .from(evidenceSpans)
        .where(
          inArray(
            evidenceSpans.relationshipId,
            rows.map((row) => row.id)
          )
        )
        .orderBy(asc(evidenceSpans.startOffset))
    ]);

    const nameById = new Map(counterpartRows.map((row) => [row.id, row.canonical]));
    const firstQuoteByRelation = new Map<string, string>();
    for (const row of quoteRows) {
      if (row.relationshipId === null || firstQuoteByRelation.has(row.relationshipId)) {
        continue;
      }
      firstQuoteByRelation.set(row.relationshipId, row.quote);
    }

    return rows
      .map((row) => {
        const counterpartId = row.sourceId === entityId ? row.targetId : row.sourceId;
        return {
          id          : row.id,
          counterpart : nameById.get(counterpartId) ?? "未知",
          typeCode    : row.typeCode,
          category    : resolveRelationCategory(row.typeCode),
          startChapter: row.startChapter,
          endChapter  : row.endChapter,
          status      : row.status,
          quote       : firstQuoteByRelation.get(row.id) ?? null
        } satisfies EntityRelationBrief;
      })
      .sort((left, right) => {
        if (left.category !== right.category) {
          return left.category - right.category;
        }
        return left.startChapter - right.startChapter;
      });
  }
);

/** 供档案页一次性取齐；与 `loadEntityProfile` 同源，避免两处拼接。 */
export const loadEntityProfileWithRelations = cache(
  async (
    entityId: string
  ): Promise<{ profile: EntityProfile; relations: EntityRelationBrief[] } | null> => {
    const profile = await loadEntityProfile(entityId);
    if (profile === null) {
      return null;
    }
    const relations = await loadEntityRelations(entityId);
    return { profile, relations };
  }
);
