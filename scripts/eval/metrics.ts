import { SYMMETRIC_RELATION_CODES } from "@/lib/relations";
import { normalizeName } from "@/lib/text";

import type { GoldEntity, GoldRelation } from "./goldset-schema";

/**
 * 评测指标（微平均 F1）。
 *
 * 口径来源：v1 `scripts/eval/evaluate.ts`，保持完全一致以便对比两版成绩。
 *
 * 关键设计：
 * - **微平均**而非宏平均 —— 一部小说中实体数量差异巨大（周进 vs 一个路人），
 *   宏平均会让一个只出现一次的路人拥有与主角相同的权重，与「图谱是否有用」不符；
 * - 比较前一律经 `normalizeName()` —— 与落库、归并共用同一归一化实现，
 *   保证「评测判为相同」与「系统认为相同」永远一致；
 * - 对称关系（夫妻、朋友等）的方向不参与比较，A→B 与 B→A 视为同一条。
 */

/** 单个实体的匹配结果。 */
export interface EntityOutcome {
  truePositive : number;
  falsePositive: number;
  falseNegative: number;
}

/** 单个关系的匹配结果。 */
export interface RelationOutcome {
  truePositive : number;
  falsePositive: number;
  falseNegative: number;
}

/** 精确率 / 召回率 / F1。 */
export interface Prf {
  precision: number;
  recall   : number;
  f1       : number;
}

/**
 * 由 TP/FP/FN 计算 PRF。
 *
 * @param tp 真正例数
 * @param fp 假正例数
 * @param fn 假负例数
 * @returns 三项指标；分母为 0 时该项记 0（而非 NaN），保证可比较
 */
export function computePrf(tp: number, fp: number, fn: number): Prf {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/**
 * 计算实体指标。
 *
 * 匹配口径：实体的**任一成员名**（规范名或其别名）命中金标的任一成员名即视为匹配。
 * 这与归并逻辑一致 —— 系统把「范进」和「范老爷」合并后，
 * 只要金标认可其中任意一个名字，就应算召回成功。
 *
 * @param gold 金标实体
 * @param extracted 系统输出的实体（含别名）
 * @returns TP/FP/FN 计数
 */
export function computeEntityMetric(
  gold: readonly GoldEntity[],
  extracted: readonly { canonical: string; aliases: readonly string[] }[]
): EntityOutcome {
  const goldMembers = gold.map((entity) => memberKeySet(entity.canonical, entity.aliases));
  const extractedMembers = extracted.map((entity) => memberKeySet(entity.canonical, entity.aliases));

  // 贪心一对一匹配：每个系统实体最多认领一个金标实体。
  const claimed = new Set<number>();
  let truePositive = 0;

  for (const members of extractedMembers) {
    const matchedIndex = goldMembers.findIndex(
      (goldMember, index) => !claimed.has(index) && intersects(members, goldMember)
    );
    if (matchedIndex >= 0) {
      claimed.add(matchedIndex);
      truePositive += 1;
    }
  }

  return {
    truePositive,
    falsePositive: extractedMembers.length - truePositive,
    falseNegative: goldMembers.length - claimed.size
  };
}

/**
 * 参与关系端点解析的实体。
 *
 * 只需成员名（规范名 + 别名）—— 关系指标**不需要**类型与 `nameType`。
 */
export interface RelationEndpointSource {
  canonical: string;
  aliases  : readonly string[];
}

/** 名字 → 比较键 的解析函数。 */
export type NameResolver = (name: string) => string;

/**
 * 用「成员名 → 实体下标」构造端点解析函数。
 *
 * ## 为什么关系端点必须解析别名（本项目第五次「坏的是尺子」）
 *
 * 实体指标按**成员集合**匹配（规范名或任一别名命中即算匹配），
 * 但关系指标此前只比**规范名**。两侧口径不一致的直接后果是：
 *
 *   金标写 `师生 危素→时知县`（原文里就叫「时知县」），
 *   而图谱的规范名是 `时仁`（`时知县` 是它的别名）
 *   → 同一实体、同一关系，**永远配不上** → 召回率被系统性低估。
 *
 * 实测：修正前该条关系在报告里是 FN，修正后是 TP。
 *
 * 解析不到的端点**退回归一化名本身**（而不是丢弃）——
 * 这样「金标里有、图谱里没有」的实体仍然能被识别为「两边都缺」，
 * 使 FN 的计数保持正确。
 *
 * @param entities 图谱实体（含别名）
 * @returns 解析函数
 */
function buildEndpointResolver(entities: readonly RelationEndpointSource[]): NameResolver {
  // 成员名 → 实体下标。同一成员名只属于一个实体（落库侧有唯一约束保证）。
  const indexOfKey = new Map<string, number>();
  entities.forEach((entity, index) => {
    for (const key of memberKeySet(entity.canonical, entity.aliases)) {
      if (!indexOfKey.has(key)) {
        indexOfKey.set(key, index);
      }
    }
  });

  return (name) => {
    const key = normalizeName(name);
    const index = indexOfKey.get(key);
    // 前缀区分「已解析到实体」与「未解析到」，避免两种来源的比较键相撞。
    return index === undefined ? `N${key}` : `E${String(index)}`;
  };
}

/**
 * 计算关系指标。
 *
 * ⚠️ 第三个参数**必填**：关系端点必须经成员名解析后再比较，
 * 否则「金标用别名、图谱用规范名」的同一实体会永远配不上（见 `buildEndpointResolver`）。
 * 设为必填而非可选，是为了让「忘了传」变成编译错误，而不是一个静默偏低的召回率。
 *
 * @param gold 金标关系
 * @param extracted 系统输出的关系
 * @param entities 系统输出的实体（提供别名，用于端点解析）
 * @returns TP/FP/FN 计数
 */
export function computeRelationMetric(
  gold: readonly GoldRelation[],
  extracted: readonly { typeCode: string; sourceCanonical: string; targetCanonical: string }[],
  entities: readonly RelationEndpointSource[]
): RelationOutcome {
  const resolve = buildEndpointResolver(entities);
  const goldKeys = new Set(gold.map((relation) => relationIdentity(relation, resolve)));
  const extractedKeys = extracted.map((relation) => relationIdentity(relation, resolve));

  let truePositive = 0;
  const seen = new Set<string>();

  for (const key of extractedKeys) {
    if (goldKeys.has(key) && !seen.has(key)) {
      seen.add(key);
      truePositive += 1;
    }
  }

  return {
    truePositive,
    falsePositive: extractedKeys.length - truePositive,
    falseNegative: goldKeys.size - truePositive
  };
}

/** 构建实体的成员名归一化集合（规范名 + 别名）。 */
function memberKeySet(canonical: string, aliases: readonly string[]): Set<string> {
  const keys = new Set<string>();
  const canonicalKey = normalizeName(canonical);
  if (canonicalKey.length > 0) {
    keys.add(canonicalKey);
  }
  for (const alias of aliases) {
    const key = normalizeName(alias);
    if (key.length > 0) {
      keys.add(key);
    }
  }
  return keys;
}

/** 两个集合是否有交集。 */
function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  // 遍历较小集合以降低比较次数。
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const key of small) {
    if (large.has(key)) {
      return true;
    }
  }
  return false;
}

/**
 * 构造关系的比较键。
 *
 * @param relation 关系
 * @param resolve 名字 → 比较键 的解析函数（把同一实体的不同写法归到一起；
 *                只做名字相等比较时传 `normalizeName`）
 * @returns 稳定键；对称关系按两端比较键排序，使方向不影响比较
 */
export function relationIdentity(relation: GoldRelation, resolve: NameResolver): string {
  const source = resolve(relation.sourceCanonical);
  const target = resolve(relation.targetCanonical);

  if (!SYMMETRIC_RELATION_CODES.has(relation.typeCode)) {
    return `${relation.typeCode}\u0000${source}\u0000${target}`;
  }
  const [first, second] = source <= target ? [source, target] : [target, source];
  return `${relation.typeCode}\u0000${first}\u0000${second}`;
}

/** 完整评测报告。 */
export interface EvalReport {
  entity  : Prf & { tp: number; fp: number; fn: number };
  relation: Prf & { tp: number; fp: number; fn: number };
}

/**
 * 汇总评测报告。
 *
 * @param gold 金标
 * @param extracted 系统输出
 * @returns 实体与关系的 PRF
 */
export function evaluateAll(
  gold: { entities: readonly GoldEntity[]; relations: readonly GoldRelation[] },
  extracted: {
    entities : readonly { canonical: string; aliases: readonly string[] }[];
    relations: readonly { typeCode: string; sourceCanonical: string; targetCanonical: string }[];
  }
): EvalReport {
  const entity = computeEntityMetric(gold.entities, extracted.entities);
  // 端点解析必须吃**实体表**：关系里存的是规范名，而金标可能写别名。
  const relation = computeRelationMetric(gold.relations, extracted.relations, extracted.entities);

  return {
    entity: {
      tp: entity.truePositive,
      fp: entity.falsePositive,
      fn: entity.falseNegative,
      ...computePrf(entity.truePositive, entity.falsePositive, entity.falseNegative)
    },
    relation: {
      tp: relation.truePositive,
      fp: relation.falsePositive,
      fn: relation.falseNegative,
      ...computePrf(relation.truePositive, relation.falsePositive, relation.falseNegative)
    }
  };
}
