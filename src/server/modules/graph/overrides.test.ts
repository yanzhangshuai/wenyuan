// @vitest-environment node
import { describe, expect, it } from "vitest";

import { applyOverrides } from "./overrides";
import type { GraphSnapshot } from "@/types/graph";

/**
 * 覆盖层应用的纯函数测试。
 *
 * 重点在三条「不能出错」的语义：
 * 1. 无覆盖时必须原样返回（否则所有图谱页都会多一次无意义的拷贝）；
 * 2. 隐藏节点必须连带剔除边（否则画布上会出现指向不存在节点的悬空边）；
 * 3. `drop_alias` / `add_alias` 不能被当成「已生效」——它们改不动快照。
 */

const snapshot = {
  bookId            : "b1",
  bookTitle         : "测试书",
  chapterCount      : 10,
  truncatedNodeCount: 0,
  chapters          : [],
  nodes: [
    { id: "e1", name: "贾政", type: "PERSON", factionIndex: null, degree: 2, subDegree: 2, mentionCount: 10 },
    { id: "e2", name: "宝玉", type: "PERSON", factionIndex: null, degree: 2, subDegree: 2, mentionCount: 20 },
    { id: "e3", name: "姑丈", type: "PERSON", factionIndex: null, degree: 1, subDegree: 1, mentionCount: 3 }
  ],
  edges: [
    {
      id: "r1", source: "e1", target: "e2", typeCode: "父子", label: "父子",
      category: 0, startChapter: 1, endChapter: null, status: "ACTIVE",
      evidenceQuotes: ["q"], evidenceCount: 1
    },
    {
      id: "r2", source: "e1", target: "e3", typeCode: "父子", label: "父子",
      category: 0, startChapter: 1, endChapter: null, status: "ACTIVE",
      evidenceQuotes: ["q"], evidenceCount: 1
    },
    {
      id: "r3", source: "e2", target: "e3", typeCode: "朋友", label: "朋友",
      category: 1, startChapter: 2, endChapter: null, status: "ACTIVE",
      evidenceQuotes: ["q"], evidenceCount: 1
    }
  ],
  legend: [
    { category: 0, label: "亲属", count: 2 },
    { category: 1, label: "友好", count: 1 }
  ]
} as unknown as GraphSnapshot;

describe("applyOverrides", () => {
  it("没有覆盖时原样返回（引用相等，零开销）", () => {
    const result = applyOverrides(snapshot, []);
    expect(result.snapshot).toBe(snapshot);
    expect(result.unmatched).toEqual([]);
    expect(result.deferred).toEqual([]);
  });

  it("hide_entity 剔除节点，**并连带剔除它的边**", () => {
    const result = applyOverrides(snapshot, [
      { kind: "hide_entity", targetName: "姑丈", payload: { kind: "hide_entity" } }
    ]);
    expect(result.snapshot.nodes.map((n) => n.name)).toEqual(["贾政", "宝玉"]);
    // r2 / r3 都连着「姑丈」，必须一起消失 —— 否则是悬空边。
    expect(result.snapshot.edges.map((e) => e.id)).toEqual(["r1"]);
  });

  it("隐藏后重算 legend（否则图例数量与画面不符）", () => {
    const result = applyOverrides(snapshot, [
      { kind: "hide_entity", targetName: "姑丈", payload: { kind: "hide_entity" } }
    ]);
    expect(result.snapshot.legend).toEqual([{ category: 0, label: "亲属", count: 1 }]);
  });

  it("change_type 改写节点类型", () => {
    const result = applyOverrides(snapshot, [
      { kind: "change_type", targetName: "姑丈", payload: { kind: "change_type", type: "CONCEPT" } }
    ]);
    expect(result.snapshot.nodes.find((n) => n.name === "姑丈")?.type).toBe("CONCEPT");
    // 类型改了但节点还在，边不受影响。
    expect(result.snapshot.edges).toHaveLength(3);
  });

  it("drop_alias / add_alias 进 deferred，不改快照（快照没有别名字段）", () => {
    const result = applyOverrides(snapshot, [
      { kind: "drop_alias", targetName: "贾政", payload: { kind: "drop_alias", alias: "政老爷" } }
    ]);
    expect(result.snapshot).toBe(snapshot); // 没有可见变化 → 原样返回
    expect(result.deferred).toEqual(["贾政"]);
  });

  it("找不到目标时进 unmatched（重跑后实体被改名或合并）", () => {
    const result = applyOverrides(snapshot, [
      { kind: "hide_entity", targetName: "不存在的人", payload: { kind: "hide_entity" } }
    ]);
    expect(result.unmatched).toEqual(["不存在的人"]);
    expect(result.snapshot).toBe(snapshot);
  });

  it("隐藏全部节点时 legend 变空（不会留下 count 为 0 的图例项）", () => {
    const result = applyOverrides(snapshot, [
      { kind: "hide_entity", targetName: "贾政", payload: { kind: "hide_entity" } },
      { kind: "hide_entity", targetName: "宝玉", payload: { kind: "hide_entity" } },
      { kind: "hide_entity", targetName: "姑丈", payload: { kind: "hide_entity" } }
    ]);
    expect(result.snapshot.nodes).toHaveLength(0);
    expect(result.snapshot.edges).toHaveLength(0);
    expect(result.snapshot.legend).toEqual([]);
  });
});
