import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_NODES,
  RELATION_GROUPS,
  computeNodeRadius,
  getEdgeColorForCategory,
  getRelationGroupLabel,
  limitGraphSize,
  resolveRelationCategory
} from "./grouping";

describe("resolveRelationCategory", () => {
  it("按 RELATION_TYPES 的显式 category 分组（非关键词猜测）", () => {
    expect(resolveRelationCategory("父子")).toBe(0);
    expect(resolveRelationCategory("夫妻")).toBe(0);
    expect(resolveRelationCategory("朋友")).toBe(1);
    expect(resolveRelationCategory("同年")).toBe(1);
    expect(resolveRelationCategory("仇敌")).toBe(2);
    expect(resolveRelationCategory("师生")).toBe(3);
    expect(resolveRelationCategory("主仆")).toBe(3);
  });

  it("未知关系码归入「其他」", () => {
    expect(resolveRelationCategory("同窗")).toBe(4);
    expect(resolveRelationCategory("")).toBe(4);
  });
});

describe("RELATION_GROUPS", () => {
  it("分组下标连续覆盖 0..4，与 edgeTypeColors 顺序对应", () => {
    expect(RELATION_GROUPS.map((group) => group.category)).toEqual([0, 1, 2, 3, 4]);
    expect(RELATION_GROUPS.map((group) => group.colorIndex)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("getRelationGroupLabel", () => {
  it("返回中文分组标签", () => {
    expect(getRelationGroupLabel(0)).toBe("亲属");
    expect(getRelationGroupLabel(4)).toBe("其他");
  });
});

describe("getEdgeColorForCategory", () => {
  const COLORS = ["#a", "#b", "#c", "#d", "#e"] as const;

  it("按下标取色", () => {
    expect(getEdgeColorForCategory(COLORS, 2)).toBe("#c");
  });

  it("调色板缺该下标时回退到末位，不返回 undefined", () => {
    expect(getEdgeColorForCategory(["#only"], 4)).toBe("#only");
  });

  it("空调色板返回兜底色", () => {
    expect(getEdgeColorForCategory([], 0)).toBe("#888888");
  });
});

describe("computeNodeRadius", () => {
  it("无连接时为最小值", () => {
    expect(computeNodeRadius(0)).toBe(4);
  });

  it("随连接度单调递增且不超过上限", () => {
    const radii = [1, 3, 8, 20, 60, 200].map((degree) => computeNodeRadius(degree));
    for (let index = 1; index < radii.length; index += 1) {
      const previous = radii[index - 1] ?? 0;
      const current = radii[index] ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous);
    }
    expect(Math.max(...radii)).toBeLessThanOrEqual(18);
  });

  it("采用平方根缩放：小连接度不会贴地不动", () => {
    // 线性映射下 degree=1 只会得到极小值；平方根应给出明显大于 min 的半径。
    expect(computeNodeRadius(1)).toBeGreaterThan(5);
  });
});

describe("limitGraphSize", () => {
  const nodes = [
    { id: "a", degree: 10 },
    { id: "b", degree: 5 },
    { id: "c", degree: 1 }
  ];
  const edges = [
    { source: "a", target: "b" },
    { source: "a", target: "c" },
    { source: "b", target: "c" }
  ];

  it("未超上限时原样返回且不标记裁剪", () => {
    const result = limitGraphSize(nodes, edges, 10);
    expect(result.nodes).toHaveLength(3);
    expect(result.truncatedNodeCount).toBe(0);
  });

  it("超上限时保留连接度最高的节点", () => {
    const result = limitGraphSize(nodes, edges, 2);
    expect(result.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(result.truncatedNodeCount).toBe(1);
  });

  it("剔除两端已不存在的边，避免悬空引用", () => {
    const result = limitGraphSize(nodes, edges, 2);
    expect(result.edges).toEqual([{ source: "a", target: "b" }]);
  });

  it("同连接度时按 id 排序，结果稳定可复现", () => {
    const tied = [
      { id: "z", degree: 3 },
      { id: "a", degree: 3 },
      { id: "m", degree: 3 }
    ];
    const first = limitGraphSize(tied, [], 2).nodes.map((node) => node.id);
    const second = limitGraphSize([...tied].reverse(), [], 2).nodes.map((node) => node.id);
    expect(first).toEqual(["a", "m"]);
    expect(second).toEqual(first);
  });

  it("默认上限为 300", () => {
    expect(DEFAULT_MAX_NODES).toBe(300);
  });
});
