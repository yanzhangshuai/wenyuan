import type { EntityType } from "@/lib/entities";
import type { RelationCategory } from "@/lib/relations";

/**
 * 图谱视图模型（服务端查询 → 客户端渲染的唯一数据契约）。
 *
 * 设计原因：不把数据库行直接透传给客户端组件，而是收敛成「渲染所需的最小集合」。
 * 好处有三：
 * 1. 客户端组件不必知道 UUID 之外的表结构，边界清晰；
 * 2. `degree`、`mentionCount` 等派生指标在服务端一次算好，避免客户端 O(n²) 重算；
 * 3. 需要新增字段时改这一处即可，不必追着查询语句改。
 */

/** 图谱节点（实体）。 */
export interface GraphNode {
  id          : string;
  /** 展示名（实体的规范名）。 */
  name        : string;
  type        : EntityType;
  /** 派系分组下标（对应主题 `factionColors`）；未分组为 null。 */
  factionIndex: number | null;
  /**
   * **全库**连接度（该实体在整个作品中的关系条数），决定节点半径。
   *
   * ⚠️ 与 `subDegree` 语义不同，**不可混用**：本字段是裁剪前的口径，
   * 用于表达人物的真实重要度；`subDegree` 只在当前快照的保留子图上成立。
   */
  degree      : number;
  /**
   * **子图内**连接度（在当前快照保留下来的节点/边上实算）。
   *
   * 用途：矩阵、聚焦视图等「按当前画面」推理的场景必须用本字段 ——
   * 用全库 `degree` 会让 0 度节点看起来有关系（见 §三 的 `陈木南` 案例）。
   */
  subDegree   : number;
  /** 在原文中被提及的段落数，决定标签字号。 */
  mentionCount: number;
}

/** 图谱边（关系）。 */
export interface GraphEdge {
  id            : string;
  source        : string;
  target        : string;
  /** 关系码（闭集内的规范码）。 */
  typeCode      : string;
  /** 关系码的中文标签（与 `typeCode` 相同，保留字段以便未来支持多语言）。 */
  label         : string;
  /** 语义分组下标，直接决定边的颜色（0 亲属 / 1 友好 / 2 对立 / 3 从属 / 4 其他）。 */
  category      : RelationCategory;
  /** 关系生效章节。 */
  startChapter  : number;
  /** 关系终止章节；null 表示到全书结束仍成立。 */
  endChapter    : number | null;
  status        : "ACTIVE" | "ENDED";
  /**
   * 支撑本关系的**全部**原文引用（`evidence_spans` 是一对多）。
   *
   * 为什么是数组而不是单值：早期只取首条，导致「一条关系有多段依据」的事实被抹掉；
   * 详情卡与矩阵详情需要把全部依据摊开给用户核对（见 `docs/plans/2026-10-14-三视图合一-nextjs-设计.md`）。
   */
  evidenceQuotes: string[];
  /** 证据条数（= `evidenceQuotes.length`），供 UI 直接显示计数。 */
  evidenceCount : number;
}

/** 章节摘要（供时间轴与证据定位显示章节名）。 */
export interface GraphChapter {
  /** 回号；前置内容为 0（与 `chapters.ordinal` 一致，**不可 `+1`**）。 */
  ordinal: number;
  title  : string;
}

/** 关系码统计（按当前快照实算，非全库）。 */
export interface GraphCodeStat {
  code    : string;
  label   : string;
  category: RelationCategory;
  /** 当前快照内该码出现的边数。 */
  count   : number;
}

/** 图例条目。 */
export interface GraphLegendEntry {
  label   : string;
  /** 已归一化的语义分组下标。 */
  category: RelationCategory;
  count   : number;
}

/** 图谱快照（页面首屏所需的全部数据）。 */
export interface GraphSnapshot {
  bookId            : string;
  bookTitle         : string;
  chapterCount      : number;
  nodes             : GraphNode[];
  edges             : GraphEdge[];
  /** 按语义分组统计的关系数量，供图例展示（不含 count 为 0 的分组）。 */
  legend            : GraphLegendEntry[];
  /** 被裁剪的节点数量（超出渲染上限时）。 */
  truncatedNodeCount: number;
  /**
   * 章节摘要（按 `ordinal` 升序，含 `ordinal=0` 的前置内容）。
   *
   * 用途：把边的 `startChapter` 回号翻译成「第 N 回 标题」；
   * 时间轴与矩阵详情都依赖它，因此随快照一次性下发，避免客户端二次取数。
   */
  chapters          : GraphChapter[];
  /**
   * 关系码统计（**按当前快照实算**，非全库）。
   *
   * 用途：矩阵的行列维度必须只取「当前切片内真实出现的关系码」，
   * 用全库统计会把切片内 0 条的码也带进来（形成空行空列）。
   * 按 `count` 降序排列。
   */
  codeStats         : GraphCodeStat[];
}
