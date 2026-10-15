import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphNode } from "@/types/graph";

import {
  buildChapterSeries,
  buildDiagDetail,
  buildMatrix,
  buildNameLookup,
  buildPairDetail,
  cellCount,
  computeExclusivePairs,
  computeSubDegrees,
  exclusivePairKeys,
  groupByPair,
  matrixCodes,
  normalizePair,
  pairKey,
  sortDetailEntries
} from "./matrix";

/**
 * 关系矩阵纯逻辑测试。
 *
 * ⚠️ 全部使用**受控 fixture**，不依赖生产库，也不复用 demo 的 46 节点切片
 * —— 那份切片是人工挑选的，其数字（如「朋友 92 组」）是切片性质而非逻辑常量。
 * 本文件断言的是**逻辑**，因此数据要小到能手算。
 */

/** 构造一条边；默认值可被覆盖。 */
function edge(
  id: string,
  source: string,
  target: string,
  typeCode: string,
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

/** 构造一个节点。 */
function node(id: string, name = id): GraphNode {
  return {
    id,
    name,
    type        : "PERSON",
    factionIndex: null,
    degree      : 0,
    subDegree   : 0,
    mentionCount: 0
  };
}

describe("normalizePair", () => {
  it("字典序归一化，交换顺序结果一致", () => {
    expect(normalizePair("b", "a")).toEqual(["a", "b"]);
    expect(normalizePair("a", "b")).toEqual(["a", "b"]);
  });
});

describe("groupByPair", () => {
  it("同一对人物的多条边归为一组", () => {
    const edges = [
      edge("e1", "a", "b", "父子", 0),
      edge("e2", "b", "a", "兄弟", 0),
      edge("e3", "a", "c", "朋友", 1)
    ];
    const pairs = groupByPair(edges);
    expect(pairs).toHaveLength(2);
    const ab = pairs.find((pair) => pair.low === "a" && pair.high === "b");
    expect(ab?.edges).toHaveLength(2);
  });

  it("方向不影响归并（无向）", () => {
    const pairs = groupByPair([edge("e1", "b", "a", "朋友")]);
    expect(pairs[0]?.low).toBe("a");
    expect(pairs[0]?.high).toBe("b");
  });
});

describe("computeSubDegrees", () => {
  it("只统计传入边集的度数", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("e1", "a", "b", "朋友")];
    const degrees = computeSubDegrees(nodes, edges);
    expect(degrees.get("a")).toBe(1);
    expect(degrees.get("b")).toBe(1);
    expect(degrees.get("c")).toBe(0);
  });

  it("端点不在节点集内的边不计入", () => {
    const nodes = [node("a")];
    const edges = [edge("e1", "a", "zzz", "朋友")];
    const degrees = computeSubDegrees(nodes, edges);
    // b 侧不在节点集，只有 a 侧计入。
    expect(degrees.get("a")).toBe(1);
  });

  it("孤岛节点度数为 0（空态路径）", () => {
    const nodes = [node("a"), node("孤岛")];
    const degrees = computeSubDegrees(nodes, [edge("e1", "a", "b", "朋友")]);
    expect(degrees.get("孤岛")).toBe(0);
  });
});

describe("computeExclusivePairs", () => {
  it("同对多码被识别为关系特异", () => {
    const edges = [
      edge("e1", "a", "b", "父子", 0),
      edge("e2", "a", "b", "兄弟", 0),
      edge("e3", "a", "c", "朋友", 1)
    ];
    const exclusive = computeExclusivePairs(edges);
    expect(exclusive).toHaveLength(1);
    expect(exclusive[0]?.low).toBe("a");
    expect(exclusive[0]?.high).toBe("b");
  });

  it("同对同码多条边不算特异（仍是单码）", () => {
    const edges = [
      edge("e1", "a", "b", "朋友", 1),
      edge("e2", "a", "b", "朋友", 1)
    ];
    expect(computeExclusivePairs(edges)).toHaveLength(0);
  });

  it("无特异时返回空数组", () => {
    const edges = [edge("e1", "a", "b", "朋友"), edge("e2", "b", "c", "朋友")];
    expect(computeExclusivePairs(edges)).toEqual([]);
  });
});

describe("buildMatrix / cellCount", () => {
  const codes = ["朋友", "父子", "兄弟"];
  const edges = [
    edge("e1", "a", "b", "父子", 0),
    edge("e2", "a", "b", "兄弟", 0),
    edge("e3", "b", "c", "朋友", 1),
    edge("e4", "a", "c", "朋友", 1)
  ];

  it("对角值 = 该码涉及的人物对数", () => {
    const matrix = buildMatrix(edges, codes);
    // 朋友涉及 a-b? 否；b-c 是，a-c 是 → 2 对
    expect(cellCount(matrix, "朋友", "朋友")).toBe(2);
    // 父子只涉及 a-b → 1 对
    expect(cellCount(matrix, "父子", "父子")).toBe(1);
  });

  it("非对角值 = 同时具备两码的人物对数", () => {
    const matrix = buildMatrix(edges, codes);
    // 父子×兄弟 = a-b 一对
    expect(cellCount(matrix, "父子", "兄弟")).toBe(1);
    // 朋友×父子 = 0（没有既朋友又父子的一对）
    expect(cellCount(matrix, "朋友", "父子")).toBe(0);
  });

  it("查询顺序无关（对称）", () => {
    const matrix = buildMatrix(edges, codes);
    expect(cellCount(matrix, "父子", "兄弟")).toBe(cellCount(matrix, "兄弟", "父子"));
  });

  it("同一对人物的同码多条边在矩阵里只计 1", () => {
    const matrix = buildMatrix(
      [edge("e1", "a", "b", "朋友"), edge("e2", "a", "b", "朋友")],
      ["朋友"]
    );
    expect(cellCount(matrix, "朋友", "朋友")).toBe(1);
  });

  it("只生成上三角 + 对角，不重复计数", () => {
    const matrix = buildMatrix(edges, codes);
    // 3 个码 → 上三角含对角 = 3+2+1 = 6 格
    expect(matrix.cells).toHaveLength(6);
  });

  it("码不在维度内时返回 0", () => {
    const matrix = buildMatrix(edges, codes);
    expect(cellCount(matrix, "夫妻", "朋友")).toBe(0);
  });
});

describe("buildPairDetail", () => {
  const edges = [
    edge("e1", "a", "b", "父子", 0),
    edge("e2", "a", "b", "兄弟", 0),
    edge("e3", "a", "b", "朋友", 1)
  ];

  it("返回同时命中的对，并保留其全部关系码", () => {
    const detail = buildPairDetail(edges, "父子", "兄弟");
    expect(detail).toHaveLength(1);
    expect(detail[0]?.low).toBe("a");
    // 三条边全部保留（含第三个码「朋友」），供详情卡展示全貌。
    expect(detail[0]?.edges).toHaveLength(3);
  });

  it("无命中时返回空数组", () => {
    expect(buildPairDetail(edges, "夫妻", "朋友")).toEqual([]);
  });
});

describe("buildDiagDetail", () => {
  const edges = [
    edge("e1", "a", "b", "朋友", 1),
    edge("e2", "a", "b", "父子", 0),
    edge("e3", "b", "c", "朋友", 1)
  ];

  it("只返回该码的边（对角格问的是单一关系码）", () => {
    const detail = buildDiagDetail(edges, "朋友");
    expect(detail).toHaveLength(2);
    for (const entry of detail) {
      expect(entry.edges.every((item) => item.typeCode === "朋友")).toBe(true);
    }
  });

  it("无该码时返回空数组", () => {
    expect(buildDiagDetail(edges, "同年")).toEqual([]);
  });
});

describe("matrixCodes", () => {
  it("按传入顺序投影关系码", () => {
    expect(
      matrixCodes([
        { code: "朋友", label: "朋友", category: 1, count: 10 },
        { code: "父子", label: "父子", category: 0, count: 3 }
      ])
    ).toEqual(["朋友", "父子"]);
  });
});

describe("pairKey", () => {
  it("与交换顺序无关", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });

  it("与 groupByPair 的归并键一致", () => {
    const group = groupByPair([edge("e1", "b", "a", "朋友")])[0];
    expect(pairKey("b", "a")).toBe(`${group?.low ?? ""}\u0000${group?.high ?? ""}`);
  });
});

describe("buildChapterSeries", () => {
  it("按 startChapter 归入回号桶", () => {
    const edges = [
      { ...edge("e1", "a", "b", "朋友"), startChapter: 0 },
      { ...edge("e2", "a", "c", "朋友"), startChapter: 2 },
      { ...edge("e3", "a", "d", "朋友"), startChapter: 2 },
      { ...edge("e4", "a", "e", "父子"), startChapter: 2 }
    ];
    // 桶长 = max(chapterCount+1, 最大回号+1)；此处 chapterCount=3 → 长度 4
    expect(buildChapterSeries(edges, "朋友", 3)).toEqual([1, 0, 2, 0]);
  });

  it("回号 0（前置内容）不丢弃，落在下标 0", () => {
    const series = buildChapterSeries(
      [{ ...edge("e1", "a", "b", "朋友"), startChapter: 0 }],
      "朋友",
      2
    );
    expect(series[0]).toBe(1);
  });

  it("缺回保持 0，不压缩数组（下标必须等于回号）", () => {
    const series = buildChapterSeries(
      [{ ...edge("e1", "a", "b", "朋友"), startChapter: 5 }],
      "朋友",
      5
    );
    expect(series).toHaveLength(6);
    expect(series.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(series[5]).toBe(1);
  });

  it("只统计指定关系码", () => {
    const series = buildChapterSeries(
      [
        { ...edge("e1", "a", "b", "朋友"), startChapter: 1 },
        { ...edge("e2", "a", "c", "父子"), startChapter: 1 }
      ],
      "朋友",
      1
    );
    expect(series[1]).toBe(1);
  });

  it("起始回号超出 chapterCount 时自动扩桶", () => {
    const series = buildChapterSeries(
      [{ ...edge("e1", "a", "b", "朋友"), startChapter: 9 }],
      "朋友",
      3
    );
    expect(series).toHaveLength(10);
    expect(series[9]).toBe(1);
  });

  it("无该码时返回全 0 数组", () => {
    expect(buildChapterSeries([edge("e1", "a", "b", "朋友")], "同年", 2)).toEqual([
      0, 0, 0
    ]);
  });
});

describe("buildNameLookup", () => {
  it("节点 ID → 名称", () => {
    const lookup = buildNameLookup([node("a", "范进"), node("b", "周进")]);
    expect(lookup.get("a")).toBe("范进");
    expect(lookup.get("b")).toBe("周进");
  });

  it("缺失 ID 不在表内（调用方须兜底）", () => {
    const lookup = buildNameLookup([node("a", "范进")]);
    expect(lookup.get("zzz")).toBeUndefined();
  });
});

describe("sortDetailEntries", () => {
  const names = new Map([
    ["a", "范进"],
    ["b", "周进"],
    ["c", "张乡绅"]
  ]);

  it("边数多者在前", () => {
    const entries = [
      { low: "a", high: "c", edges: [edge("e1", "a", "c", "朋友")] },
      {
        low  : "a",
        high : "b",
        edges: [edge("e2", "a", "b", "朋友"), edge("e3", "a", "b", "父子", 0)]
      }
    ];
    expect(sortDetailEntries(entries, names).map((item) => item.high)).toEqual(["b", "c"]);
  });

  it("边数相同时按端点名稳定排序（确定性，不假设具体中文序）", () => {
    const entries = [
      { low: "a", high: "c", edges: [edge("e1", "a", "c", "朋友")] },
      { low: "a", high: "b", edges: [edge("e2", "a", "b", "朋友")] }
    ];
    // ⚠️ 不断言「哪个中文名在前」—— `localeCompare` 的中文序取决于运行环境 ICU，
    // 钉死具体结果会让测试在换环境后莫名失败。这里只断言**确定性**：
    // 同一输入重复排序结果一致，且两项都在。
    const first = sortDetailEntries(entries, names);
    const second = sortDetailEntries(entries, names);
    expect(first.map((item) => item.high)).toEqual(second.map((item) => item.high));
    expect([...first.map((item) => item.high)].sort()).toEqual(["b", "c"]);
  });

  it("不改动原数组", () => {
    const entries = [{ low: "a", high: "c", edges: [] }];
    const copy = [...entries];
    sortDetailEntries(entries, names);
    expect(entries).toEqual(copy);
  });

  it("端点名缺失时退回 ID 参与排序（不抛错）", () => {
    const entries = [{ low: "zz", high: "yy", edges: [edge("e1", "zz", "yy", "朋友")] }];
    expect(() => sortDetailEntries(entries, new Map())).not.toThrow();
  });
});

describe("exclusivePairKeys", () => {
  it("只含多码人物对的键", () => {
    const edges = [
      edge("e1", "a", "b", "朋友"),
      edge("e2", "a", "b", "父子", 0),
      edge("e3", "b", "c", "朋友")
    ];
    const keys = exclusivePairKeys(edges);
    expect(keys.has(pairKey("a", "b"))).toBe(true);
    expect(keys.has(pairKey("b", "c"))).toBe(false);
  });

  it("与 computeExclusivePairs 规模一致", () => {
    const edges = [
      edge("e1", "a", "b", "朋友"),
      edge("e2", "a", "b", "同年"),
      edge("e3", "c", "d", "朋友"),
      edge("e4", "c", "d", "父子", 0)
    ];
    expect(exclusivePairKeys(edges).size).toBe(computeExclusivePairs(edges).length);
  });
});
