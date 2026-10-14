import { normalizeName } from "@/lib/text";

import type { ExtractedEntity, ExtractedRelation } from "../schemas";

/**
 * P2 grounding：候选名的字面证据校验（**零 LLM 成本**）。
 *
 * 原理（借鉴 AI-Reader-V2）：模型输出的实体名必须能在原文中找到字面出现，
 * 否则视为幻觉并直接剔除。这一步不调用任何模型，却是压制误报（提升 precision）的主力。
 *
 * 关键实现细节：匹配前必须用与落库相同的 `normalizeName()` 归一化，
 * 否则「司马 光」与「司马光」会被误判为无证据。
 */

/** grounding 索引：把全库正文归一化后拼接成单一长串，子串匹配即等价于「字面出现」。 */
export type GroundingIndex = string;

/**
 * 构建 grounding 索引。
 *
 * @param texts 全库文本片段（通常为各章正文）
 * @returns 归一化拼接后的索引串
 */
export function buildGroundingIndex(texts: readonly string[]): GroundingIndex {
  return texts.map((text) => normalizeName(text)).join("");
}

/**
 * 判断名字是否有字面证据。
 *
 * @param name 待校验名字
 * @param index grounding 索引
 * @returns 归一化后能在索引中命中时为 true；空名字恒为 false
 */
export function isNameGrounded(name: string, index: GroundingIndex): boolean {
  const key = normalizeName(name);
  if (key.length === 0) {
    return false;
  }
  return index.includes(key);
}

/** 实体 grounding 结果。 */
export interface EntityGroundingOutcome<T extends ExtractedEntity = ExtractedEntity> {
  kept           : T[];
  /** 因无字面证据被整条剔除的实体名。 */
  droppedEntities: string[];
  /** 因无字面证据被剔除的别名数量。 */
  droppedAliases : number;
}

/**
 * 过滤实体：规范名无证据则整条剔除；别名无证据则仅剔除该别名。
 *
 * 泛型说明（与 {@link groundRelations} 同源，理由也相同）：
 * 调用方需要在实体上附加**来源章节**等元信息 —— 缺陷 N1 的修法是
 * 「提及必须限制在该实体的观测章节内」，而观测章节来自 P1 的分片坐标。
 * 若此处把类型收窄回 `ExtractedEntity`，附加字段虽在运行时被展开保留、
 * 在类型上却已经丢了，上层只能靠「按名字回查章节」——那正是 v1 的缺陷模式。
 *
 * @param entities 候选实体（可携带附加字段）
 * @param index grounding 索引
 * @returns 保留项与被剔除项的统计
 */
export function groundEntities<T extends ExtractedEntity>(
  entities: readonly T[],
  index: GroundingIndex
): EntityGroundingOutcome<T> {
  const kept: T[] = [];
  const droppedEntities: string[] = [];
  let droppedAliases = 0;

  for (const entity of entities) {
    if (!isNameGrounded(entity.canonical, index)) {
      droppedEntities.push(entity.canonical);
      continue;
    }
    const aliases = entity.aliases.filter((alias) => isNameGrounded(alias, index));
    droppedAliases += entity.aliases.length - aliases.length;
    kept.push({ ...entity, aliases });
  }

  return { kept, droppedEntities, droppedAliases };
}

/** 关系 grounding 选项。 */
export interface RelationGroundingOptions {
  /**
   * 是否要求 `quote` 能在原文中字面命中。
   *
   * 默认 true —— 这是压制「模型编造证据」的关键约束，代价是要求提示词明确指示逐字摘录。
   * 若召回明显受损，可置为 false 退化为仅校验两端实体。
   */
  requireQuoteEvidence?: boolean;
}

/** 关系 grounding 结果。 */
export interface RelationGroundingOutcome<T extends ExtractedRelation> {
  kept            : T[];
  /** 被剔除关系的可读描述（`码:源→目标`）。 */
  droppedRelations: string[];
}

/** 把关系格式化为可读描述，用于留档与报告。 */
function formatRelation(relation: ExtractedRelation): string {
  return `${relation.typeCode}:${relation.sourceCanonical}→${relation.targetCanonical}`;
}

/**
 * 过滤关系：两端实体必须有字面证据；默认还要求证据引用本身可字面命中。
 *
 * 泛型说明：调用方常需要在关系上附加**来源章节**等元信息（P6 计算关系有效期必需）。
 * 此处保留入参类型 `T`，使附加字段不在此工序丢失 ——
 * 否则上层只能靠「按名字回查章节」，而那正是 v1 的缺陷模式。
 *
 * @param relations 候选关系（可携带附加字段）
 * @param index grounding 索引
 * @param options 选项
 * @returns 保留项与被剔除项
 */
export function groundRelations<T extends ExtractedRelation>(
  relations: readonly T[],
  index: GroundingIndex,
  options: RelationGroundingOptions = {}
): RelationGroundingOutcome<T> {
  const requireQuoteEvidence = options.requireQuoteEvidence ?? true;
  const kept: T[] = [];
  const droppedRelations: string[] = [];

  for (const relation of relations) {
    const endpointsGrounded =
      isNameGrounded(relation.sourceCanonical, index) &&
      isNameGrounded(relation.targetCanonical, index);
    const quoteGrounded = !requireQuoteEvidence || isNameGrounded(relation.quote, index);

    if (endpointsGrounded && quoteGrounded) {
      kept.push(relation);
      continue;
    }
    droppedRelations.push(formatRelation(relation));
  }

  return { kept, droppedRelations };
}
