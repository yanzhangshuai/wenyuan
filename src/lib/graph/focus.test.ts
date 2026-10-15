import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphNode } from "@/types/graph";

import { getIncidentEdges, getNeighbors, getSubDegree, topBySubDegree } from "./focus";

/**
 * 聚焦视图纯逻辑测试。
 *
 * 核心承重点：`getSubDegree` 必须只数**切片内的边**，
 * 不能退回 `node.degree`（那是全库口径）。demo 里的 `陈木南` 即此例
 * ——全库 7 条、切片内 0 条，若用 `degree` 判断会显示成「有关系」。
 */

function edge(
  id: string,
  source: string,
  target: string,
  typeCode = "朋友",
  category: GraphEdge["category"] = 1
): GraphEdge {
  return {
    id,
    source,
    target,
    typeCode,
    label         : typeCode,
    category,
    startChapter  : 1,
    endChapter    : null,
    status        : "ACTIVE",
    evidenceQuotes: [],
    evidenceCount : 0
  };
}

function node(id: string, subDegree: number, degree = subDegree * 10): GraphNode {
  return {
    id,
    name        : id,
    type        : "PERSON",
    factionIndex: null,
    degree,
    subDegree,
    mentionCount: 0
  };
}

describe("getSubDegree", () => {
  it("只数切片内的边", () => {
    const edges = [edge("e1", "a", "b"), edge("e2", "a", "c")];
    expect(getSubDegree(node("a", 0), edges)).toBe(2);
  });

  it("切片内无边时为 0 —— 即便全库 degree 很大（陈木南案例）", () => {
    const chenmunan = node("chen", 0, 7);
    expect(getSubDegree(chenmunan, [])).toBe(0);
  });

  it("自环只算一次（一条边就是一条边）", () => {
    const edges = [edge("e1", "a", "a")];
    // 实现用 `source === id || target === id` 短路判定，自环因此只计 1。
    // 自环在小说关系里不存在，此处记录实际行为以免未来误改。
    expect(getSubDegree(node("a", 0), edges)).toBe(1);
  });
});

describe("getIncidentEdges", () => {
  it("两个方向的边都算", () => {
    const edges = [
      edge("e1", "a", "b"),
      edge("e2", "c", "a"),
      edge("e3", "b", "c")
    ];
    expect(getIncidentEdges("a", edges).map((item) => item.id)).toEqual(["e1", "e2"]);
  });

  it("按语义分组、再按关系码排序", () => {
    const edges = [
      edge("e1", "a", "b", "朋友", 1),
      edge("e2", "a", "c", "父子", 0),
      edge("e3", "a", "d", "仇敌", 2)
    ];
    expect(getIncidentEdges("a", edges).map((item) => item.category)).toEqual([0, 1, 2]);
  });

  it("无关联边时返回空数组", () => {
    expect(getIncidentEdges("z", [edge("e1", "a", "b")])).toEqual([]);
  });
});

describe("getNeighbors", () => {
  const nodes = [node("a", 2), node("b", 1), node("c", 1), node("z", 0)];
  const edges = [edge("e1", "a", "b"), edge("e2", "c", "a")];

  it("返回全部邻居且不含自身", () => {
    const neighbors = getNeighbors("a", nodes, edges);
    expect(neighbors.map((item) => item.id).sort()).toEqual(["b", "c"]);
  });

  it("不包含无边相连的节点", () => {
    expect(getNeighbors("a", nodes, edges).some((item) => item.id === "z")).toBe(false);
  });

  it("邻居去重（同一邻居多条边只出现一次）", () => {
    const multi = [edge("e1", "a", "b"), edge("e2", "a", "b", "父子", 0)];
    expect(getNeighbors("a", nodes, multi).map((item) => item.id)).toEqual(["b"]);
  });
});

describe("topBySubDegree", () => {
  it("按子图度数降序取前 N", () => {
    const nodes = [node("a", 1), node("b", 5), node("c", 3)];
    expect(topBySubDegree(nodes, 2).map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("limit 为 0 时返回空数组", () => {
    expect(topBySubDegree([node("a", 1)], 0)).toEqual([]);
  });

  it("limit 超过总数时返回全部", () => {
    expect(topBySubDegree([node("a", 1), node("b", 2)], 10)).toHaveLength(2);
  });
});
