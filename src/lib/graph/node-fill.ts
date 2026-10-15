/**
 * 节点填充色的决策（纯逻辑，便于单测）。
 *
 * ## 为什么需要它
 *
 * 图谱节点此前用 `factionIndex` 取色，而该字段在落库时**恒为 `null`**
 * （`persist-graph.ts` 未做派系识别），于是**每个节点都落进同一个兜底色** ——
 * 画布上所有球体同色，用户读到的是「配色不协调、分不出谁是谁」。
 *
 * 本模块改用一条**真实存在、可确定性计算**的维度：
 * 节点的**主导关系分组**（0 亲属 / 1 友好 / 2 对立 / 3 从属 / 4 无关系）。
 * 它的好处：
 * - **有意义**：家族中心读出暖红、上下级读出松绿，与左下角图例的语义**同源**；
 * - **$0 可算**：只依赖快照里已有的边，无需模型、无需重跑分析；
 * - **可断言**：纯函数，能在 `vitest` 里直接验「同票数时取更小的分组码」这类边界。
 *
 * ## 为什么不是「按实体类型」
 *
 * `EntityType` 只有 4 个取值（人物/地点/组织/概念），而长篇小说里绝大多数
 * 实体都是人物 —— 按类型上色仍然是一片同色，等于没解决问题。
 *
 * ## 与边色的关系
 *
 * 索引相同（都对齐 `RelationCategory`），**色值不同**（见各主题的 `nodeColors`）：
 * 边是细线、需要高明度；节点是实心球、需要中明度才吃得住球面渐变。
 */

import type { RelationCategory } from "@/lib/relations";
import type { GraphEdge } from "@/types/graph";

/** 无任何关系的节点归入「无关系」槽位（= 5 色盘的最后一位）。 */
export const NODE_COLOR_NO_RELATION_INDEX = 4;

/** 节点色盘下标的合法取值：与关系分组同域，外加「无关系」（= 4，与「其他」同位）。 */
export type NodeColorIndex = RelationCategory;

/**
 * 计算「实体 id → 主导关系分组下标」。
 *
 * 语义：统计每个实体参与的全部边（两个方向都算），按语义分组计数，
 * 取**计数最多**的分组；票数相同时取**更小的分组码**（0 亲属 < 1 友好 < ...），
 * 让结果稳定可复现，不受边遍历顺序影响。
 *
 * @param edges 当前快照内的全部边
 * @returns 实体 id → 分组下标；**没有任何边的实体不出现在 Map 里**
 *          （调用方据此回退到「无关系」色）
 */
export function computeDominantCategoryByNode(
  edges: readonly GraphEdge[]
): ReadonlyMap<string, RelationCategory> {
  /** 实体 → (分组 → 票数)。 */
  const tally = new Map<string, Map<RelationCategory, number>>();

  const count = (nodeId: string, category: RelationCategory): void => {
    let perNode = tally.get(nodeId);
    if (perNode === undefined) {
      perNode = new Map<RelationCategory, number>();
      tally.set(nodeId, perNode);
    }
    perNode.set(category, (perNode.get(category) ?? 0) + 1);
  };

  for (const edge of edges) {
    count(edge.source, edge.category);
    count(edge.target, edge.category);
  }

  const result = new Map<string, RelationCategory>();
  for (const [nodeId, perNode] of tally) {
    let bestCategory: RelationCategory = 0;
    let bestCount = -1;
    // 显式按 0..4 升序遍历：票数相同时自然落在更小的分组码上。
    for (const category of [0, 1, 2, 3, 4] as const) {
      const value = perNode.get(category) ?? 0;
      if (value > bestCount) {
        bestCount = value;
        bestCategory = category;
      }
    }
    result.set(nodeId, bestCategory);
  }
  return result;
}

/**
 * 取某节点应使用的节点色盘下标。
 *
 * @param dominant 主导分组的查找表（见 `computeDominantCategoryByNode`）
 * @param nodeId   节点 id
 * @returns 色盘下标；无关系的节点返回 `NODE_COLOR_NO_RELATION_INDEX`
 */
export function resolveNodeColorIndex(
  dominant: ReadonlyMap<string, RelationCategory>,
  nodeId: string
): NodeColorIndex {
  return dominant.get(nodeId) ?? NODE_COLOR_NO_RELATION_INDEX;
}
