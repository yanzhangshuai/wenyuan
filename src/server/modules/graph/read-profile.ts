import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";

import { groupDeedsByChapter } from "@/lib/graph/profile";
import { getDatabase } from "@/server/db/client";
import {
  chapters,
  entities,
  entityAliases,
  entityMentions,
  paragraphs
} from "@/server/db/schema";
import type { EntityDeed, EntityProfile } from "@/types/profile";

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
