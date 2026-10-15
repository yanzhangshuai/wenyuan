import type { GraphEdge, GraphNode } from "@/types/graph";

/**
 * 章节切片（纯逻辑，可在 vitest 里断言）。
 *
 * ## 为什么切片放在客户端
 *
 * v1 每切一章都要向 `/api/books/[id]/graph?chapter=N` 重新取数（服务端重算快照）。
 * v3 的快照里**每条边都带 `startChapter` / `endChapter`**（见 `GraphEdge`），
 * 因此「截至第 N 回时图谱长什么样」完全可以在客户端算出来 ——
 * 拖动滑块不再触发网络请求，交互是即时的。
 *
 * ## 切片语义（对齐 v1 的 `chapterCap`）
 *
 * 一条边在「截至第 N 回」的快照里可见，当且仅当：
 * - `startChapter <= N`（已经发生）；
 * - 且**不是**在 N 之前就已终止（`endChapter !== null && endChapter < N`）。
 *
 * 节点则保留「切完边之后仍至少有一条边相连」的那些，
 * 否则会留下一堆孤立点，看起来像图谱坏了。
 */

/** 判断一条边在「截至 `chapter` 回」时是否可见。 */
export function isEdgeVisibleAtChapter(edge: GraphEdge, chapter: number): boolean {
  if (edge.startChapter > chapter) {
    return false;
  }
  // endChapter 为 null 表示到全书结束仍成立；否则要求终止回 >= 当前回。
  if (edge.endChapter !== null && edge.endChapter < chapter) {
    return false;
  }
  return true;
}

export interface ChapterSlice {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * 按「截至第 `chapter` 回」裁剪快照。
 *
 * ⚠️ **返回的节点是原对象的浅拷贝**：`subDegree` 必须按**切片内**的边重算
 * （对齐 §三 的 `陈木南` 案例 —— 用全库 `degree` 会让 0 度节点看起来有关系）。
 * `degree`（全库口径）**保持不变**，因为它是人物的真实重要度。
 *
 * @param nodes   全量节点
 * @param edges   全量边
 * @param chapter 截至的回号（`>= chapterCount` 时等价于全图）
 */
export function sliceByChapter(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  chapter: number
): ChapterSlice {
  const slicedEdges = edges.filter((edge) => isEdgeVisibleAtChapter(edge, chapter));

  const subDegree = new Map<string, number>();
  for (const edge of slicedEdges) {
    subDegree.set(edge.source, (subDegree.get(edge.source) ?? 0) + 1);
    subDegree.set(edge.target, (subDegree.get(edge.target) ?? 0) + 1);
  }

  const slicedNodes: GraphNode[] = [];
  for (const node of nodes) {
    const degree = subDegree.get(node.id);
    // 只保留切片内仍有关系的节点，避免孤立点。
    if (degree === undefined) {
      continue;
    }
    slicedNodes.push({ ...node, subDegree: degree });
  }

  return { nodes: slicedNodes, edges: slicedEdges };
}

/**
 * 按名字模糊匹配节点（用于「选择人物」搜索框）。
 *
 * 匹配规则：**包含**即可（不区分大小写），结果按
 * 「子图度数降序 → 名字升序」排序，最活跃的人物排前面。
 *
 * @param nodes  候选节点（应为当前切片内的节点）
 * @param query  查询串；空串返回空数组（由调用方决定是否展示默认列表）
 * @param limit  最多返回条数
 */
export function searchNodes(
  nodes: readonly GraphNode[],
  query: string,
  limit = 8
): GraphNode[] {
  const keyword = query.trim().toLowerCase();
  if (keyword === "") {
    return [];
  }
  return nodes
    .filter((node) => node.name.toLowerCase().includes(keyword))
    .sort((left, right) => {
      if (right.subDegree !== left.subDegree) {
        return right.subDegree - left.subDegree;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}
