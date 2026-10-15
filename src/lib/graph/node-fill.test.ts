import { describe, expect, it } from "vitest";

import type { RelationCategory } from "@/lib/relations";
import type { GraphEdge } from "@/types/graph";

import {
  NODE_COLOR_NO_RELATION_INDEX,
  computeDominantCategoryByNode,
  resolveNodeColorIndex
} from "./node-fill";

/**
 * 造一条边。`category` 即 `RelationCategory`（0 亲属 / 1 友好 / 2 对立 / 3 从属 / 4 其他）。
 * `computeDominantCategoryByNode` 只读 source / target / category 三个字段，
 * 其余填中性值即可（不写 `as` —— 让类型系统继续守住字段名与取值域）。
 */
function edge(source: string, target: string, category: RelationCategory): GraphEdge {
  return {
    id            : `${source}->${target}`,
    source,
    target,
    typeCode      : "朋友",
    label         : "朋友",
    category,
    startChapter  : 1,
    endChapter    : null,
    status        : "ACTIVE",
    evidenceQuotes: [],
    evidenceCount : 0
  };
}

describe("computeDominantCategoryByNode", () => {
  it("取票数最多的分组", () => {
    const dominant = computeDominantCategoryByNode([
      edge("a", "b", 0),
      edge("a", "c", 0),
      edge("a", "d", 1)
    ]);
    // a 参与 3 条边：亲属 2 票 > 友好 1 票 ⇒ 0
    expect(dominant.get("a")).toBe(0);
    // b / c / d 各 1 票，各自落在其边的分组上
    expect(dominant.get("b")).toBe(0);
    expect(dominant.get("d")).toBe(1);
  });

  it("两个方向都计入统计（边的两端是对等的）", () => {
    const dominant = computeDominantCategoryByNode([edge("a", "b", 2)]);
    expect(dominant.get("a")).toBe(2);
    expect(dominant.get("b")).toBe(2);
  });

  it("票数相同时取更小的分组码，结果与边顺序无关", () => {
    const forward = computeDominantCategoryByNode([
      edge("a", "b", 3),
      edge("a", "c", 1)
    ]);
    const reversed = computeDominantCategoryByNode([
      edge("a", "c", 1),
      edge("a", "b", 3)
    ]);
    // 友好(1) 与 从属(3) 各 1 票 ⇒ 取更小的 1
    expect(forward.get("a")).toBe(1);
    expect(reversed.get("a")).toBe(1);
  });

  it("没有任何边的实体不出现在 Map 里（调用方据此回退）", () => {
    const dominant = computeDominantCategoryByNode([edge("a", "b", 0)]);
    expect(dominant.has("a")).toBe(true);
    expect(dominant.has("b")).toBe(true);
    expect(dominant.has("orphan")).toBe(false);
  });

  it("空边集返回空 Map，不抛错", () => {
    expect(computeDominantCategoryByNode([]).size).toBe(0);
  });

  it("多组混合时逐节点独立判断，互不串味", () => {
    const dominant = computeDominantCategoryByNode([
      // a 是家族中心：3 条亲属 + 1 条对立
      edge("a", "x", 0),
      edge("a", "y", 0),
      edge("a", "z", 0),
      edge("a", "w", 2),
      // b 是对立中心：2 条对立
      edge("b", "w", 2),
      edge("b", "z", 2)
    ]);
    expect(dominant.get("a")).toBe(0);
    expect(dominant.get("b")).toBe(2);
    // w 参与 (a,2) 与 (b,2)：对立 2 票
    expect(dominant.get("w")).toBe(2);
    // z 参与 (a,0) 与 (b,2)：各 1 票 ⇒ 取更小的 0
    expect(dominant.get("z")).toBe(0);
  });
});

describe("resolveNodeColorIndex", () => {
  it("命中时返回该节点的主导分组码", () => {
    const dominant = computeDominantCategoryByNode([edge("a", "b", 3)]);
    expect(resolveNodeColorIndex(dominant, "a")).toBe(3);
  });

  it("未命中（无关系）时回退到「无关系」槽位", () => {
    const dominant = computeDominantCategoryByNode([edge("a", "b", 0)]);
    expect(resolveNodeColorIndex(dominant, "orphan")).toBe(NODE_COLOR_NO_RELATION_INDEX);
  });

  it("「无关系」槽位落在 5 色盘的最后一位（索引 4）", () => {
    expect(NODE_COLOR_NO_RELATION_INDEX).toBe(4);
  });
});
