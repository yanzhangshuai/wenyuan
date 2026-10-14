import { RELATION_TYPES, type RelationCategory } from "@/lib/relations";

/**
 * 图谱语义分组的展示元数据。
 *
 * 与 v1 的差异（这是 v3 的一处实质改进）：
 * v1 用 `normalizeRelationIdx()` 做**关键词子串匹配**把任意关系名塞进 5 个分组
 * （`graph-view.tsx:69-76`），结果是「同窗」漏配到「其他」、「师姐」误配到「亲属」，
 * 且新增关系码时必须回来补关键词表。
 *
 * v3 的关系码是闭集，`category` 在 `RELATION_TYPES` 中**显式声明**，
 * 因此分组是查表而非猜测 —— 不会漏配，也不会误配。
 */

/** 分组展示元数据。 */
export interface RelationGroupMeta {
  category  : RelationCategory;
  label     : string;
  /** 该分组在主题 `edgeTypeColors` 中的下标（与 `category` 一致，显式写出以免误解耦）。 */
  colorIndex: RelationCategory;
}

/** 分组展示顺序，与 `edgeTypeColors[0..4]` 严格对应。 */
export const RELATION_GROUPS: readonly RelationGroupMeta[] = [
  { category: 0, label: "亲属", colorIndex: 0 },
  { category: 1, label: "友好", colorIndex: 1 },
  { category: 2, label: "对立", colorIndex: 2 },
  { category: 3, label: "从属", colorIndex: 3 },
  { category: 4, label: "其他", colorIndex: 4 }
];

/** 关系码 → 分组元数据的查找表。 */
const CATEGORY_BY_CODE: ReadonlyMap<string, RelationCategory> = new Map(
  RELATION_TYPES.map((item) => [item.code, item.category])
);

/**
 * 取关系码的语义分组。
 *
 * @param typeCode 关系码
 * @returns 分组下标；未知关系码归入「其他」(4)，与 v1 的兜底语义一致
 */
export function resolveRelationCategory(typeCode: string): RelationCategory {
  return CATEGORY_BY_CODE.get(typeCode) ?? 4;
}

/**
 * 取分组的中文标签。
 *
 * @param category 分组下标
 * @returns 分组标签
 */
export function getRelationGroupLabel(category: RelationCategory): string {
  return RELATION_GROUPS.find((group) => group.category === category)?.label ?? "其他";
}

/**
 * 按分组下标取主题颜色。
 *
 * @param colors 主题的 `edgeTypeColors` 调色板
 * @param category 分组下标
 * @returns 颜色值；调色板缺失该下标时回退到末位（「其他」色）
 */
export function getEdgeColorForCategory(
  colors: readonly string[],
  category: RelationCategory
): string {
  return colors[category] ?? colors[colors.length - 1] ?? "#888888";
}

/**
 * 计算节点半径。
 *
 * 采用平方根缩放而非线性：人物连接度分布长尾（主角可达数十、配角仅 1-2），
 * 线性映射会让主角大到遮挡画面、配角小到不可见。
 *
 * @param degree 连接度
 * @param options 半径区间
 * @returns 像素半径
 */
export function computeNodeRadius(
  degree: number,
  options: { min?: number; max?: number } = {}
): number {
  const min = options.min ?? 4;
  const max = options.max ?? 18;
  if (degree <= 0) {
    return min;
  }
  // 以 30 连接度作为「接近上限」的参考值，超出后不再显著增大。
  const normalized = Math.min(1, Math.sqrt(degree / 30));
  return min + (max - min) * normalized;
}

/**
 * 按连接度裁剪节点集合，并同步剔除两端已不存在的边。
 *
 * 用途：长篇小说可解析出上千个实体，一次性渲染会拖垮画布。
 * 裁剪保留连接度最高的 N 个节点，使画面聚焦主线人物。
 *
 * 泛型说明：保留入参的具体类型（如 `GraphNode`），使调用方无需重新断言，
 * 避免在边界处引入 `as`（见 `type-no-escape-hatches`）。
 *
 * @param nodes 全部节点
 * @param edges 全部边
 * @param maxNodes 节点上限
 * @returns 裁剪后的节点、边与被剔除的节点数
 */
export function limitGraphSize<
  TNode extends { id: string; degree: number },
  TEdge extends { source: string; target: string }
>(
  nodes: readonly TNode[],
  edges: readonly TEdge[],
  maxNodes: number
): {
  nodes             : TNode[];
  edges             : TEdge[];
  truncatedNodeCount: number;
} {
  if (nodes.length <= maxNodes) {
    return { nodes: [...nodes], edges: [...edges], truncatedNodeCount: 0 };
  }

  // 连接度降序；同度时按 id 排序，保证裁剪结果稳定可复现。
  const kept = [...nodes]
    .sort((left, right) => {
      if (right.degree !== left.degree) {
        return right.degree - left.degree;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, maxNodes);

  const keptIds = new Set(kept.map((node) => node.id));

  return {
    nodes             : kept,
    edges             : edges.filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target)),
    truncatedNodeCount: nodes.length - kept.length
  };
}

/** 默认渲染节点上限。 */
export const DEFAULT_MAX_NODES = 300;
