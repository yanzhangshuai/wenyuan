/**
 * 关系类型目录（闭集）。
 *
 * 来源：v1 `scripts/skills/classical-relationship-types.md` 的 frontmatter，
 * 保持 code / direction 完全一致，以保证与既有 goldset 的 `typeCode` 可直接对齐。
 *
 * `category` 是 v3 新增的**确定性**映射（v1 用关键词模糊匹配 `normalizeRelationIdx()`），
 * 下标与主题 `edgeTypeColors` 顺序一一对应：
 *   0 亲属 / 1 友好 / 2 对立 / 3 从属 / 4 其他（兜底）
 */

/** 关系方向：`SYMMETRIC` 双向可互换，`INVERSE` 有方向。 */
export type RelationDirection = "SYMMETRIC" | "INVERSE";

/** 关系语义分组下标，与 `edgeTypeColors` 一一对应。 */
export type RelationCategory = 0 | 1 | 2 | 3 | 4;

/** 关系类型定义。 */
export interface RelationTypeDefinition {
  code     : string;
  label    : string;
  category : RelationCategory;
  direction: RelationDirection;
  /** 口语化别称，用于模型输出归一化。 */
  aliases  : readonly string[];
}

/** 关系类型闭集。 */
export const RELATION_TYPES: readonly RelationTypeDefinition[] = [
  { code: "父子", label: "父子", category: 0, direction: "INVERSE",   aliases: ["父与子", "父子关系", "父女", "父女关系"] },
  { code: "母子", label: "母子", category: 0, direction: "INVERSE",   aliases: ["母与子", "母子关系", "母女", "母女关系"] },
  { code: "兄弟", label: "兄弟", category: 0, direction: "SYMMETRIC", aliases: ["手足", "弟兄", "姐妹", "兄妹", "姐弟"] },
  { code: "夫妻", label: "夫妻", category: 0, direction: "SYMMETRIC", aliases: ["夫妇", "两口子", "伉俪"] },
  { code: "师生", label: "师生", category: 3, direction: "INVERSE",   aliases: ["受业", "门生", "座师", "师徒", "师父", "弟子"] },
  { code: "同年", label: "同年", category: 1, direction: "SYMMETRIC", aliases: ["同科", "同榜"] },
  { code: "同僚", label: "同僚", category: 1, direction: "SYMMETRIC", aliases: ["同寅", "同事", "同官"] },
  { code: "主仆", label: "主仆", category: 3, direction: "INVERSE",   aliases: ["主家", "仆人", "家主", "奴仆"] },
  { code: "朋友", label: "朋友", category: 1, direction: "SYMMETRIC", aliases: ["好友", "故交", "知己", "挚友"] },
  { code: "仇敌", label: "仇敌", category: 2, direction: "SYMMETRIC", aliases: ["仇家", "死对头", "宿敌", "对头"] }
];

/** 关系码闭集，用于校验模型输出是否越界。 */
export const RELATION_TYPE_CODES: ReadonlySet<string> = new Set(
  RELATION_TYPES.map((item) => item.code)
);

/**
 * 对称关系码集合。
 *
 * 替代 v1 `scripts/eval/evaluate.ts` 中标注为「临时静态表」的 `SYMMETRIC_CODES`：
 * 此处由 `direction` 字段派生，新增关系类型时不会再出现「字典与评测表不一致」。
 */
export const SYMMETRIC_RELATION_CODES: ReadonlySet<string> = new Set(
  RELATION_TYPES.filter((item) => item.direction === "SYMMETRIC").map((item) => item.code)
);

/** 别称 → 规范码 的查找表（已归一化）。 */
export const RELATION_ALIAS_TO_CODE: ReadonlyMap<string, string> = new Map(
  RELATION_TYPES.flatMap((item) => [
    [item.code, item.code] as const,
    ...item.aliases.map((alias) => [alias, item.code] as const)
  ])
);

/**
 * 将任意关系字面量归一化为规范码。
 *
 * @param raw 模型输出的原始关系字面量
 * @returns 命中的规范码；未命中返回 null（调用方应记为 `unknown_relation_code` 问题）
 */
export function resolveRelationCode(raw: string): string | null {
  const key = raw.normalize("NFKC").replace(/[\s\u3000]+/g, "");
  return RELATION_ALIAS_TO_CODE.get(key) ?? null;
}

/**
 * 构造关系的**身份键**（用于去重、计票与生命周期聚合）。
 *
 * 语义：
 * - 对称关系（兄弟/夫妻/同年/同僚/朋友/仇敌）的 A→B 与 B→A 是同一条事实，
 *   因此对两端归一化键排序后再拼接，使方向不影响身份；
 * - 非对称关系（父子/母子/师生/主仆）保留方向。
 *
 * 关键约束：P4 计票、P6 聚合与落库三处必须使用**同一个**身份算法，
 * 否则「章节坐标回填」会找错关系。因此该函数定义在共享层而非某个管线模块内。
 *
 * @param sourceKey 源实体归一化键
 * @param targetKey 目标实体归一化键
 * @param typeCode 关系码
 * @param symmetric 该关系码是否对称
 * @returns 稳定的关系身份键
 */
export function buildRelationIdentity(
  sourceKey: string,
  targetKey: string,
  typeCode: string,
  symmetric: boolean
): string {
  if (!symmetric) {
    return `${typeCode}\u0000${sourceKey}\u0000${targetKey}`;
  }
  const [first, second] =
    sourceKey <= targetKey ? [sourceKey, targetKey] : [targetKey, sourceKey];
  return `${typeCode}\u0000${first}\u0000${second}`;
}
