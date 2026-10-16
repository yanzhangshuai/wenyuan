/**
 * 三期「判定层」的类型定义（设计文档 §5.2 / §5.4）。
 *
 * 关键定位：外部知识**只产出疑点与置信度，不产出事实**（证伪不证真）——
 * 它标注、不改写图谱。
 */

/** 外部知识可标注的字段（闭集，与 `external_knowledge.field` 一致）。 */
export const KNOWLEDGE_FIELDS = [
  "canonical_name",
  "biography",
  "hometown",
  "courtesy_name",
  "prototype",
  "relation_note"
] as const;

export type KnowledgeField = (typeof KNOWLEDGE_FIELDS)[number];

/** 判定终态：`unresolvable` 是**必须能表达**的终态（系统必须能说「我尽力了，但确实不知道」）。 */
export type KnowledgeResolution = "resolved" | "disputed" | "unresolvable";

export type KnowledgeConfidence = "high" | "medium" | "low" | "none";

/** 一次检索命中。 */
export interface SearchHit {
  title   : string;
  url     : string;
  snippet : string;
  /** 抓取到的正文（可空；空时判定只能依赖 snippet）。 */
  content?: string;
}

/** 一次检索的完整结果（留档单位）。 */
export interface SearchResult {
  query   : string;
  /** 检索器身份（provider 名），与 `snapshotHash` 一起构成可复核链。 */
  provider: string;
  hits    : SearchHit[];
}

/** 单条判定结果（落库前的纯数据）。 */
export interface KnowledgeVerdict {
  resolution: KnowledgeResolution;
  confidence: KnowledgeConfidence;
  value     : string | null;
  /** 模型引用到的来源 URL（必须 ⊆ 检索结果里的 URL）。 */
  sourceUrls: string[];
  /** 一句话理由，留档用。 */
  rationale : string;
}

/** 触发集对象（离线 Agent 的工作单元）。 */
export interface KnowledgeTarget {
  subjectType: "entity";
  subjectId  : string;
  /** 规范名（图谱侧）。 */
  subjectKey : string;
  bookId     : string;
  bookTitle  : string;
  field      : KnowledgeField;
  /** 为什么选中（触发档位 + 触发规则），留档用。 */
  reason     : string;
  /** 建议检索词。 */
  query      : string;
}
