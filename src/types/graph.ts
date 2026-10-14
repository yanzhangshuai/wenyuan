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
  /** 连接度（关联关系条数），决定节点半径。 */
  degree      : number;
  /** 在原文中被提及的段落数，决定标签字号。 */
  mentionCount: number;
}

/** 图谱边（关系）。 */
export interface GraphEdge {
  id          : string;
  source      : string;
  target      : string;
  /** 关系码（闭集内的规范码）。 */
  typeCode    : string;
  /** 关系码的中文标签（与 `typeCode` 相同，保留字段以便未来支持多语言）。 */
  label       : string;
  /** 语义分组下标，直接决定边的颜色（0 亲属 / 1 友好 / 2 对立 / 3 从属 / 4 其他）。 */
  category    : RelationCategory;
  /** 关系生效章节。 */
  startChapter: number;
  /** 关系终止章节；null 表示到全书结束仍成立。 */
  endChapter  : number | null;
  status      : "ACTIVE" | "ENDED";
  /** 支撑证据的原文引用（取首条，供侧栏展示）。 */
  quote       : string | null;
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
}
