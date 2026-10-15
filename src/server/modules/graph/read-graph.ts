import "server-only";

import { eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";

import {
  DEFAULT_MAX_NODES,
  RELATION_GROUPS,
  limitGraphSize,
  resolveRelationCategory
} from "@/lib/graph/grouping";
import { RELATION_TYPES } from "@/lib/relations";
import { getDatabase } from "@/server/db/client";
import {
  chapters,
  entities,
  entityMentions,
  evidenceSpans,
  relationships,
  books
} from "@/server/db/schema";
import type {
  GraphChapter,
  GraphCodeStat,
  GraphEdge,
  GraphLegendEntry,
  GraphNode,
  GraphSnapshot
} from "@/types/graph";

/**
 * 图谱快照查询（服务端）。
 *
 * 设计原因：
 * - 用 React `cache()` 包装，使同一请求内「页面 + 元数据」多处调用只查一次库，
 *   而不是在模块级维护 Map（后者会在请求间泄漏数据，见 `data-render-reads-use`）；
 * - 连接度、提及数等派生指标在 SQL 侧聚合，避免把全量行拉到 Node 里再算。
 *
 * 边界：本文件只读数据库、返回纯数据，不引入任何 React 渲染逻辑。
 */

/**
 * 读取作品图谱快照。
 *
 * @param bookId 作品 ID
 * @returns 图谱快照；作品不存在时返回 null
 */
export const loadGraphSnapshot = cache(async (bookId: string): Promise<GraphSnapshot | null> => {
  // 显式声明运行时边界，阻止构建期预渲染执行数据库查询（详见 `cacheComponents` 模式）。
  await connection();

  const db = getDatabase();

  const [book] = await db
    .select({
      id          : books.id,
      title       : books.title,
      chapterCount: books.chapterCount
    })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);

  if (book === undefined) {
    return null;
  }

  const [entityRows, relationRows, mentionRows, chapterRows] = await Promise.all([
    db
      .select({
        id          : entities.id,
        canonical   : entities.canonical,
        type        : entities.type,
        factionIndex: entities.factionIndex
      })
      .from(entities)
      .where(eq(entities.bookId, bookId)),

    db
      .select({
        id              : relationships.id,
        sourceEntityId  : relationships.sourceEntityId,
        targetEntityId  : relationships.targetEntityId,
        relationTypeCode: relationships.relationTypeCode,
        startChapter    : relationships.startChapter,
        endChapter      : relationships.endChapter,
        status          : relationships.status
      })
      .from(relationships)
      .where(eq(relationships.bookId, bookId)),

    db
      .select({ entityId: entityMentions.entityId })
      .from(entityMentions)
      .innerJoin(entities, eq(entityMentions.entityId, entities.id))
      .where(eq(entities.bookId, bookId)),

    db
      .select({
        ordinal: chapters.ordinal,
        title  : chapters.title
      })
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .orderBy(chapters.ordinal)
  ]);

  // 提及数：实体 → 段落出现次数。
  const mentionCounts = new Map<string, number>();
  for (const row of mentionRows) {
    mentionCounts.set(row.entityId, (mentionCounts.get(row.entityId) ?? 0) + 1);
  }

  // 连接度：出现在任一端即计 1。
  const degrees = new Map<string, number>();
  for (const row of relationRows) {
    degrees.set(row.sourceEntityId, (degrees.get(row.sourceEntityId) ?? 0) + 1);
    degrees.set(row.targetEntityId, (degrees.get(row.targetEntityId) ?? 0) + 1);
  }

  const allNodes: GraphNode[] = entityRows.map((row) => ({
    id          : row.id,
    name        : row.canonical,
    type        : row.type,
    factionIndex: row.factionIndex,
    degree      : degrees.get(row.id) ?? 0,
    // 子图度数先占位，待裁剪后再实算（见下方 `limited` 处理）。
    subDegree   : 0,
    mentionCount: mentionCounts.get(row.id) ?? 0
  }));

  const allEdges: GraphEdge[] = relationRows.map((row) => ({
    id            : row.id,
    source        : row.sourceEntityId,
    target        : row.targetEntityId,
    typeCode      : row.relationTypeCode,
    label         : row.relationTypeCode,
    category      : resolveRelationCategory(row.relationTypeCode),
    startChapter  : row.startChapter,
    endChapter    : row.endChapter,
    status        : row.status,
    // 证据在下面按保留边批量填充；先给空数组避免字段缺失。
    evidenceQuotes: [],
    evidenceCount : 0
  }));

  // 裁剪：长篇小说节点数可达上千，需聚焦主线人物。
  const limited = limitGraphSize(allNodes, allEdges, DEFAULT_MAX_NODES);

  // 子图度数：只统计保留下来的边，与全库 `degree` 显式区分。
  const subDegrees = new Map<string, number>();
  for (const edge of limited.edges) {
    subDegrees.set(edge.source, (subDegrees.get(edge.source) ?? 0) + 1);
    subDegrees.set(edge.target, (subDegrees.get(edge.target) ?? 0) + 1);
  }
  const nodes = limited.nodes.map((node) => ({
    ...node,
    subDegree: subDegrees.get(node.id) ?? 0
  }));

  // 证据引用：仅对保留下来的关系查询，避免无谓 IO。
  const keptEdgeIds = limited.edges.map((edge) => edge.id);
  const quotesByRelation = await loadEvidenceQuotes(keptEdgeIds);

  const edges = limited.edges.map((edge) => {
    const quotes = quotesByRelation.get(edge.id) ?? [];
    return { ...edge, evidenceQuotes: quotes, evidenceCount: quotes.length };
  });

  return {
    bookId            : book.id,
    bookTitle         : book.title,
    chapterCount      : book.chapterCount,
    nodes,
    edges,
    legend            : buildLegend(edges),
    truncatedNodeCount: limited.truncatedNodeCount,
    chapters          : chapterRows satisfies GraphChapter[],
    codeStats         : buildCodeStats(edges)
  };
});

/**
 * 批量查询关系的**全部**证据引用。
 *
 * 为什么返回数组：`evidence_spans` 对一条关系可以有多行（不同段落的依据），
 * 只保留首条会丢信息 —— 详情卡需要把全部依据摊开，供用户核对模型判定。
 *
 * @param relationshipIds 关系 ID 列表
 * @returns 关系 ID → 引用文本列表（按查询返回顺序，天然稳定）
 */
async function loadEvidenceQuotes(
  relationshipIds: readonly string[]
): Promise<ReadonlyMap<string, string[]>> {
  if (relationshipIds.length === 0) {
    return new Map();
  }

  const db = getDatabase();
  const rows = await db
    .select({
      relationshipId: evidenceSpans.relationshipId,
      quote         : evidenceSpans.quote
    })
    .from(evidenceSpans)
    .where(inArray(evidenceSpans.relationshipId, [...relationshipIds]));

  const quotes = new Map<string, string[]>();
  for (const row of rows) {
    // 实体提及证据的证据行 `relationship_id` 为 null，此处不涉及关系引用，跳过。
    if (row.relationshipId === null) {
      continue;
    }
    const list = quotes.get(row.relationshipId);
    if (list === undefined) {
      quotes.set(row.relationshipId, [row.quote]);
    } else {
      list.push(row.quote);
    }
  }
  return quotes;
}

/**
 * 按当前快照实算关系码统计（非全库）。
 *
 * 用途：矩阵维度必须只取「切片内真实出现的关系码」。
 * 用全库统计会把切片内 0 条的码也带进来，形成空行空列。
 *
 * @param edges 当前快照的边
 * @returns 按出现次数降序的关系码统计
 */
function buildCodeStats(edges: readonly GraphEdge[]): GraphCodeStat[] {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    counts.set(edge.typeCode, (counts.get(edge.typeCode) ?? 0) + 1);
  }

  // 以闭集定义为准取 label/category，保证与图例、配色一致；
  // 闭集外的兜底码（category=4）也照常输出，不静默丢弃。
  return RELATION_TYPES.filter((definition) => counts.has(definition.code))
    .map((definition) => ({
      code    : definition.code,
      label   : definition.label,
      category: definition.category,
      count   : counts.get(definition.code) ?? 0
    }))
    .sort((left, right) => right.count - left.count);
}

/**
 * 构建图例（仅保留实际出现的关系分组）。
 *
 * @param edges 图谱边
 * @returns 按分组顺序排列的图例条目
 */
function buildLegend(edges: readonly GraphEdge[]): GraphLegendEntry[] {
  const counts = new Map<number, number>();
  for (const edge of edges) {
    counts.set(edge.category, (counts.get(edge.category) ?? 0) + 1);
  }

  return RELATION_GROUPS.flatMap((group) => {
    const count = counts.get(group.category) ?? 0;
    return count === 0 ? [] : [{ label: group.label, category: group.category, count }];
  });
}
