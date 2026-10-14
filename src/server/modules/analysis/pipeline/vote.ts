import { buildRelationIdentity, resolveRelationCode } from "@/lib/relations";
import { normalizeName } from "@/lib/text";

import type { EntityType, ExtractedRelation, SliceExtraction } from "../schemas";

/**
 * P4 投票与消歧（零 LLM 成本）。
 *
 * 职责：
 * 1. **关系码归一化** —— 模型常输出「父女」「好友」等别称，统一收敛到闭集码；
 *    命不中的记为 `unknown_relation_code` 问题（不静默丢弃，便于迭代提示词）。
 * 2. **重复关系去重** —— 重叠分片必然产生同一 pair 的重复观测，
 *    按「出现片数」计票，保留票数高者。
 * 3. **对称关系归一化** —— 对称关系（兄弟/夫妻/同年/同僚/朋友/仇敌）的
 *    方向由模型自由输出，需按归一化键排序统一（A→B 与 B→A 视为同一条），
 *    否则会出现「同一对人物两条边」的重复渲染。
 *
 * v1 缺陷对照：v1 直接信任模型输出的方向与字面关系名，
 * 导致图上出现大量反向重复边与未识别关系。
 */

/** 一条被投票统计后的关系。 */
export interface VotedRelation {
  typeCode       : string;
  sourceCanonical: string;
  targetCanonical: string;
  /** 归一化键，供落库与去重使用。 */
  sourceKey      : string;
  targetKey      : string;
  /**
   * 关系身份键（`buildRelationIdentity` 的结果）。
   *
   * 在计票时一并产出，使 P6 聚合与落库无需重算 —— 避免两处算法漂移。
   */
  identity       : string;
  /** 观测到该关系的分片数量（含重叠片重复观测）。 */
  votes          : number;
  /** 支撑证据引用（去重后的前若干条）。 */
  quotes         : string[];
}

/** 投票结果。 */
export interface VoteOutcome {
  relations   : VotedRelation[];
  /** 无法归一化的关系字面量及其出现次数，写入 `analysis_issues`。 */
  unknownCodes: { raw: string; count: number }[];
}

/** 单条关系的证据引用保留上限，避免长篇小说累积成巨量文本。 */
const MAX_QUOTES_PER_RELATION = 3;

/**
 * 对多片提取结果做关系投票与归一化。
 *
 * @param extractions 各分片的提取结果（按取得顺序传入，用于计票）
 * @param symmetricRelations 对称关系码集合（通常来自 `SYMMETRIC_RELATION_CODES`）
 * @returns 去重后的关系与未知关系码统计
 */
export function voteRelations(
  extractions: readonly SliceExtraction[],
  symmetricRelations: ReadonlySet<string>
): VoteOutcome {
  const buckets = new Map<string, VotedRelation>();
  const unknownCounts = new Map<string, number>();

  for (const extraction of extractions) {
    for (const relation of extraction.relations) {
      appendRelation(relation, buckets, unknownCounts, symmetricRelations);
    }
  }

  return {
    relations   : [...buckets.values()].sort((left, right) => right.votes - left.votes),
    unknownCodes: [...unknownCounts.entries()]
      .map(([raw, count]) => ({ raw, count }))
      .sort((left, right) => right.count - left.count)
  };
}

/** 把单条关系并入计票桶。 */
function appendRelation(
  relation: ExtractedRelation,
  buckets: Map<string, VotedRelation>,
  unknownCounts: Map<string, number>,
  symmetricRelations: ReadonlySet<string>
): void {
  const typeCode = resolveRelationCode(relation.typeCode);
  if (typeCode === null) {
    // 保留原文以便在报告中定位是哪个别称没被收录。
    unknownCounts.set(relation.typeCode, (unknownCounts.get(relation.typeCode) ?? 0) + 1);
    return;
  }

  const sourceKey = normalizeName(relation.sourceCanonical);
  const targetKey = normalizeName(relation.targetCanonical);
  if (sourceKey.length === 0 || targetKey.length === 0 || sourceKey === targetKey) {
    // 自环关系在人物图谱中无意义，直接丢弃。
    return;
  }

  const identity = buildRelationIdentity(
    sourceKey,
    targetKey,
    typeCode,
    symmetricRelations.has(typeCode)
  );

  const existing = buckets.get(identity);
  if (existing === undefined) {
    buckets.set(identity, {
      typeCode,
      sourceCanonical: relation.sourceCanonical,
      targetCanonical: relation.targetCanonical,
      sourceKey,
      targetKey,
      identity,
      votes          : 1,
      quotes         : [relation.quote]
    });
    return;
  }

  existing.votes += 1;
  if (
    existing.quotes.length < MAX_QUOTES_PER_RELATION &&
    !existing.quotes.includes(relation.quote)
  ) {
    existing.quotes.push(relation.quote);
  }
}

/**
 * 对实体的类型归属做多数投票。
 *
 * 用途：同一实体在不同分片可能被标为不同类型（如「书院」既可能是
 * `ORGANIZATION` 也可能是 `LOCATION`），取票数最高者；
 * 平票时按固定优先级（PERSON > LOCATION > ORGANIZATION > CONCEPT）决策，
 * 保证结果与插入顺序无关、可复现。
 *
 * @param observations 归一化键 → 各片给出的类型（按观测顺序）
 * @returns 归一化键 → 最终类型
 */
export function voteEntityTypes(
  observations: ReadonlyMap<string, readonly EntityType[]>
): ReadonlyMap<string, EntityType> {
  const typeOrder: readonly EntityType[] = ["PERSON", "LOCATION", "ORGANIZATION", "CONCEPT"];
  const decided = new Map<string, EntityType>();

  for (const [key, types] of observations) {
    const counts = new Map<EntityType, number>();
    for (const type of types) {
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    let best: EntityType = "PERSON";
    let bestCount = 0;
    for (const type of typeOrder) {
      const count = counts.get(type) ?? 0;
      if (count > bestCount) {
        best = type;
        bestCount = count;
      }
    }
    decided.set(key, best);
  }

  return decided;
}
