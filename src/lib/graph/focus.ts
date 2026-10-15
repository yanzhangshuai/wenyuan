import type { GraphEdge, GraphNode } from "@/types/graph";

/**
 * 聚焦视图的**纯逻辑**（邻居筛选、子图度数）。
 *
 * 为什么单独一个文件：与 `profile.ts` 同因 —— 组件文件带 `"use client"`，
 * 里头的纯函数无法在 Node 侧直接断言；挪出来后既能被组件用，也能被测试用。
 *
 * 边界：不碰 DOM、不读主题、不查库。
 */

/**
 * 取某节点在**当前切片**中的关系条数。
 *
 * ⚠️ 与 `GraphNode.degree` 的区别是承重的：
 * `degree` 是全库口径（决定画布上的节点半径，语义不能动），
 * 而本函数算的是「画面上这个人到底连了几条线」。
 * demo 里 `陈木南` 全库 7 条、切片内 0 条 —— 若用 `degree` 判断，
 * 会显示成「有关系」但画面上找不到任何连线（见设计文档 §三 注释）。
 *
 * @param node 目标节点
 * @param edges 切片边集
 * @returns 子图度数
 */
export function getSubDegree(node: GraphNode, edges: readonly GraphEdge[]): number {
  let count = 0;
  for (const edge of edges) {
    if (edge.source === node.id || edge.target === node.id) {
      count += 1;
    }
  }
  return count;
}

/**
 * 取某节点的全部关联边（两个方向），按语义分组、再按关系码稳定排序。
 *
 * @param nodeId 节点 ID
 * @param edges 切片边集
 * @returns 关联边（新数组）
 */
export function getIncidentEdges(nodeId: string, edges: readonly GraphEdge[]): GraphEdge[] {
  return edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .sort((left, right) => {
      if (left.category !== right.category) {
        return left.category - right.category;
      }
      return left.typeCode.localeCompare(right.typeCode);
    });
}

/**
 * 取某节点的邻居节点（去重，按子图度数降序、再按 id 稳定排序）。
 *
 * @param nodeId 中心节点
 * @param nodes 节点集
 * @param edges 切片边集
 * @returns 邻居节点（不含中心自身）
 */
export function getNeighbors(
  nodeId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[]
): GraphNode[] {
  const neighborIds = new Set<string>();
  for (const edge of edges) {
    if (edge.source === nodeId) {
      neighborIds.add(edge.target);
    } else if (edge.target === nodeId) {
      neighborIds.add(edge.source);
    }
  }

  return nodes
    .filter((node) => neighborIds.has(node.id))
    .sort((left, right) => {
      if (right.subDegree !== left.subDegree) {
        return right.subDegree - left.subDegree;
      }
      return left.id.localeCompare(right.id);
    });
}

/**
 * 按子图度数取「最活跃的若干人物」，供未选中时的快速选择器使用。
 *
 * @param nodes 节点集
 * @param limit 数量上限
 * @returns 前 N 个节点
 */
export function topBySubDegree(nodes: readonly GraphNode[], limit: number): GraphNode[] {
  return [...nodes]
    .sort((left, right) => {
      if (right.subDegree !== left.subDegree) {
        return right.subDegree - left.subDegree;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, Math.max(0, limit));
}
