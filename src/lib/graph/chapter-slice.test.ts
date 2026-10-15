import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphNode } from "@/types/graph";

import { isEdgeVisibleAtChapter, searchNodes, sliceByChapter } from "./chapter-slice";

/**
 * 章节切片是纯逻辑，**必须**在这一层钉死语义。
 *
 * 为什么不做组件测试兼验证：切片的正确性只取决于「哪些边可见」与「节点保留哪些」，
 * 在 DOM 上断言只能看到最终画了多少个圈，一旦算错（比如忘了剔除孤立点）
 * 需要反推很久。这里直接对函数输入输出断言，失败信息自解释。
 */

function makeNode(overrides: Partial<GraphNode> & { id: string; name: string }): GraphNode {
  return {
    type        : "PERSON",
    factionIndex: null,
    degree      : 0,
    subDegree   : 0,
    mentionCount: 0,
    ...overrides
  };
}

function makeEdge(
  overrides: Partial<GraphEdge> & { id: string; source: string; target: string }
): GraphEdge {
  return {
    typeCode      : "FRIEND",
    label         : "友",
    category      : 1,
    startChapter  : 1,
    endChapter    : null,
    status        : "ACTIVE",
    evidenceQuotes: [],
    evidenceCount : 0,
    ...overrides
  };
}

describe("isEdgeVisibleAtChapter", () => {
  it("尚未发生的边不可见（startChapter > chapter）", () => {
    const edge = makeEdge({ id: "e1", source: "a", target: "b", startChapter: 5 });
    expect(isEdgeVisibleAtChapter(edge, 4)).toBe(false);
    // 边界：恰好等于起步回则可见。
    expect(isEdgeVisibleAtChapter(edge, 5)).toBe(true);
  });

  it("已终止的边在终止回之后不可见（endChapter < chapter）", () => {
    const edge = makeEdge({ id: "e2", source: "a", target: "b", startChapter: 1, endChapter: 3 });
    expect(isEdgeVisibleAtChapter(edge, 3)).toBe(true);
    expect(isEdgeVisibleAtChapter(edge, 4)).toBe(false);
  });

  it("endChapter 为 null 表示持续到全书结束", () => {
    const edge = makeEdge({ id: "e3", source: "a", target: "b", startChapter: 1, endChapter: null });
    expect(isEdgeVisibleAtChapter(edge, 1)).toBe(true);
    expect(isEdgeVisibleAtChapter(edge, 999)).toBe(true);
  });
});

describe("sliceByChapter", () => {
  const nodes: GraphNode[] = [
    makeNode({ id: "a", name: "甲", degree: 2 }),
    makeNode({ id: "b", name: "乙", degree: 2 }),
    makeNode({ id: "c", name: "丙", degree: 1 })
  ];

  const edges: GraphEdge[] = [
    makeEdge({ id: "e-ab", source: "a", target: "b", startChapter: 1 }),
    // 第 3 回才发生：切到 2 回时 b–c 尚不存在。
    makeEdge({ id: "e-bc", source: "b", target: "c", startChapter: 3 })
  ];

  it("只保留 startChapter <= chapter 的边", () => {
    const slice = sliceByChapter(nodes, edges, 2);
    expect(slice.edges.map((edge) => edge.id)).toEqual(["e-ab"]);
  });

  it("剔除切完边后没有关系的孤立点", () => {
    const slice = sliceByChapter(nodes, edges, 2);
    expect(slice.nodes.map((node) => node.id)).toEqual(["a", "b"]);
  });

  it("subDegree 按切片内的边重算，degree 保持全库口径不变", () => {
    const slice = sliceByChapter(nodes, edges, 2);
    const a = slice.nodes.find((node) => node.id === "a");
    const b = slice.nodes.find((node) => node.id === "b");
    // 全库口径：a、b 都声明了 degree=2（b 还有一条 3 回才发生的边），保持不变。
    expect(a?.degree).toBe(2);
    expect(b?.degree).toBe(2);
    // 切片内 b 只剩 a–b 一条边。
    expect(a?.subDegree).toBe(1);
    expect(b?.subDegree).toBe(1);
  });

  it("切片到全书末尾时等价于全图", () => {
    const slice = sliceByChapter(nodes, edges, 999);
    expect(slice.edges).toHaveLength(2);
    expect(slice.nodes).toHaveLength(3);
    const b = slice.nodes.find((node) => node.id === "b");
    expect(b?.subDegree).toBe(2);
  });

  it("返回的节点是浅拷贝，不污染入参", () => {
    const slice = sliceByChapter(nodes, edges, 2);
    const b = slice.nodes.find((node) => node.id === "b");
    expect(b).toBeDefined();
    expect(b?.subDegree).toBe(1);
    if (b !== undefined) {
      b.subDegree = 999;
    }
    // 入参里的原对象不应被改写。
    const originalB = nodes.find((node) => node.id === "b");
    expect(originalB?.subDegree).toBe(0);
  });
});

describe("searchNodes", () => {
  const nodes: GraphNode[] = [
    makeNode({ id: "n1", name: "贾宝玉", subDegree: 10 }),
    makeNode({ id: "n2", name: "贾政", subDegree: 5 }),
    makeNode({ id: "n3", name: "贾母", subDegree: 5 }),
    makeNode({ id: "n4", name: "林黛玉", subDegree: 8 })
  ];

  it("按「包含」匹配，空串返回空数组", () => {
    expect(searchNodes(nodes, "贾").map((node) => node.name).sort()).toEqual(
      ["贾宝玉", "贾政", "贾母"].sort()
    );
    expect(searchNodes(nodes, "")).toEqual([]);
    expect(searchNodes(nodes, "   ")).toEqual([]);
  });

  it("先按子图度数降序，再按名字升序", () => {
    const result = searchNodes(nodes, "贾");
    // 第一名必须是度数最高的「贾宝玉」。
    expect(result[0]?.name).toBe("贾宝玉");
    // 余下两条度数相同（5），只断言「按名字升序」这一**关系**成立：
    // ⚠️ 不硬编码「贾母 / 贾政」的先后 —— `String.prototype.localeCompare`
    //    对中文的排序**取决于运行时 ICU**，jsdom 与 node 环境给出的结果不同，
    //    写死顺序会让测试在换环境时假红（这里是实现无关的环境噪音）。
    const rest = result.slice(1).map((node) => node.name);
    const sorted = [...rest].sort((left, right) => left.localeCompare(right));
    expect(rest).toEqual(sorted);
    expect(result).toHaveLength(3);
  });

  it("遵守 limit", () => {
    const result = searchNodes(nodes, "贾", 2);
    expect(result).toHaveLength(2);
    // limit 先于排序之外截断，保留的是度数最高的两条。
    expect(result[0]?.name).toBe("贾宝玉");
  });

  it("匹配不到返回空数组", () => {
    expect(searchNodes(nodes, "孙悟空")).toEqual([]);
  });
});
