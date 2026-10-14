import { describe, expect, it } from "vitest";

import { buildRelationIdentity } from "@/lib/relations";

import {
  aggregateRelations,
  collapseByEntityTriple,
  type AggregatedRelation,
  type RelationObservation
} from "./aggregate";

const SYMMETRIC = new Set(["兄弟", "夫妻", "同年", "同僚", "朋友", "仇敌"]);

/** 构造观测。 */
function observation(
  chapterOrdinal: number,
  typeCode: string,
  sourceKey: string,
  targetKey: string
): RelationObservation {
  return {
    chapterOrdinal,
    typeCode,
    sourceKey,
    targetKey,
    sourceCanonical: sourceKey,
    targetCanonical: targetKey
  };
}

describe("aggregateRelations", () => {
  it("单次观测的关系 endChapter 为 null 且状态为 ACTIVE", () => {
    const result = aggregateRelations([observation(3, "朋友", "甲", "乙")], SYMMETRIC);
    expect(result).toHaveLength(1);
    expect(result[0]?.startChapter).toBe(3);
    expect(result[0]?.endChapter).toBeNull();
    expect(result[0]?.status).toBe("ACTIVE");
  });

  it("多次观测同一关系延长有效期并计次", () => {
    const result = aggregateRelations(
      [
        observation(3, "朋友", "甲", "乙"),
        observation(9, "朋友", "甲", "乙"),
        observation(15, "朋友", "甲", "乙")
      ],
      SYMMETRIC
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.startChapter).toBe(3);
    expect(result[0]?.endChapter).toBe(15);
    expect(result[0]?.observations).toBe(3);
  });

  it("对称关系合并双向观测到同一条记录", () => {
    const result = aggregateRelations(
      [observation(3, "夫妻", "甲", "乙"), observation(8, "夫妻", "乙", "甲")],
      SYMMETRIC
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.observations).toBe(2);
  });

  it("非对称关系区分方向", () => {
    const result = aggregateRelations(
      [observation(3, "父子", "甲", "乙"), observation(8, "父子", "乙", "甲")],
      SYMMETRIC
    );
    expect(result).toHaveLength(2);
  });

  it("类型切换时旧关系结束、新关系开始", () => {
    const result = aggregateRelations(
      [observation(2, "同僚", "甲", "乙"), observation(10, "仇敌", "甲", "乙")],
      SYMMETRIC
    );
    expect(result).toHaveLength(2);
    const colleague = result.find((item) => item.typeCode === "同僚");
    const enemy = result.find((item) => item.typeCode === "仇敌");
    expect(colleague?.status).toBe("ENDED");
    expect(colleague?.endChapter).toBe(9);
    expect(enemy?.status).toBe("ACTIVE");
    expect(enemy?.startChapter).toBe(10);
  });

  it("allowMultipleTypes 为 false 时每个关系对只保留一种类型", () => {
    const result = aggregateRelations(
      [
        observation(2, "同僚", "甲", "乙"),
        observation(4, "同僚", "甲", "乙"),
        observation(10, "仇敌", "甲", "乙")
      ],
      SYMMETRIC,
      { allowMultipleTypes: false }
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.typeCode).toBe("同僚");
  });

  it("结果与输入顺序无关", () => {
    const input = [
      observation(3, "朋友", "甲", "乙"),
      observation(15, "朋友", "甲", "乙"),
      observation(9, "朋友", "甲", "乙")
    ];
    const forward = aggregateRelations(input, SYMMETRIC);
    const backward = aggregateRelations([...input].reverse(), SYMMETRIC);
    expect(forward).toEqual(backward);
  });

  it("空输入返回空数组", () => {
    expect(aggregateRelations([], SYMMETRIC)).toEqual([]);
  });
});

/** 直接构造一条聚合结果，便于单独测折叠逻辑。 */
function aggregated(
  typeCode: string,
  sourceKey: string,
  targetKey: string,
  startChapter: number,
  endChapter: number | null,
  status: "ACTIVE" | "ENDED",
  observations = 1
): AggregatedRelation {
  return {
    typeCode,
    sourceKey,
    targetKey,
    sourceCanonical: sourceKey,
    targetCanonical: targetKey,
    identity       : buildRelationIdentity(sourceKey, targetKey, typeCode, SYMMETRIC.has(typeCode)),
    startChapter,
    endChapter,
    observations,
    status
  };
}

describe("collapseByEntityTriple —— 修复 N16（聚合口径 ≠ 落库口径）", () => {
  /** 两个键归并成同一个实体的映射。 */
  const INDEX = new Map([
    ["甲", 0],
    ["甲某", 0],
    ["乙", 1],
    ["乙某", 1],
    ["丙", 2],
    ["丙某", 2]
  ]);

  it("无冲突时逐字节保持原样，只是给每条补一个长度为 1 的 mergedIdentities", () => {
    const input = [aggregated("朋友", "甲", "乙", 3, 15, "ACTIVE")];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);

    expect(outcome.collapsedCount).toBe(0);
    expect(outcome.relations).toHaveLength(1);
    expect(outcome.relations[0]?.mergedIdentities).toEqual([input[0]?.identity]);
    // 除新增字段外，其余字段与输入完全一致 —— 这是「不改图谱」的保证。
    expect(outcome.relations[0]).toMatchObject({
      typeCode    : "朋友",
      sourceKey   : "甲",
      targetKey   : "乙",
      identity    : input[0]?.identity,
      startChapter: 3,
      endChapter  : 15,
      status      : "ACTIVE",
      observations: 1
    });
  });

  it("**核心用例**：键不同但实体相同的两条被折叠成一条，且生命周期取并集", () => {
    // `甲`/`甲某` 是同一个人的两种写法，`乙`/`乙某` 同理。
    // 改动前这两条在 P6 看来是两条，到库里因唯一索引是**实体 id** 而被吞掉一条。
    const input = [
      aggregated("朋友", "甲", "乙", 3, 15, "ACTIVE"),
      aggregated("朋友", "甲某", "乙某", 20, null, "ACTIVE")
    ];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);

    expect(outcome.collapsedCount).toBe(1);
    expect(outcome.relations).toHaveLength(1);
    const merged = outcome.relations[0];
    expect(merged?.startChapter).toBe(3); // 更早的首次观测
    expect(merged?.endChapter).toBeNull(); // 有一条仍未结束 → 整体未结束
    expect(merged?.status).toBe("ACTIVE");
    expect(merged?.observations).toBe(2);
    // 证据引用的键级身份键必须**全部**带出来，否则被折叠那条的证据会静默丢失。
    expect(merged?.mergedIdentities).toEqual([input[0]?.identity, input[1]?.identity]);
  });

  it("**易错点**：只要有一条仍未结束，合并结果就不得被标成 ENDED", () => {
    const input = [
      aggregated("朋友", "甲", "乙", 2, 9, "ENDED"),
      aggregated("朋友", "甲某", "乙某", 20, null, "ACTIVE")
    ];
    const merged = collapseByEntityTriple(input, INDEX, SYMMETRIC).relations[0];
    expect(merged?.status).toBe("ACTIVE");
    expect(merged?.endChapter).toBeNull();
    expect(merged?.startChapter).toBe(2);
  });

  it("两条都已结束 → 取更晚的 endChapter，状态为 ENDED", () => {
    const input = [
      aggregated("朋友", "甲", "乙", 2, 9, "ENDED"),
      aggregated("朋友", "甲某", "乙某", 4, 30, "ENDED")
    ];
    const merged = collapseByEntityTriple(input, INDEX, SYMMETRIC).relations[0];
    expect(merged?.status).toBe("ENDED");
    expect(merged?.endChapter).toBe(30);
    expect(merged?.startChapter).toBe(2);
  });

  it("**不变量**：实体三元组的集合在折叠前后完全一致（折叠只合并、不丢边）", () => {
    const input = [
      aggregated("朋友", "甲", "乙", 3, null, "ACTIVE"),
      aggregated("朋友", "甲某", "乙某", 5, null, "ACTIVE"),
      aggregated("同僚", "甲", "乙", 7, null, "ACTIVE"),
      aggregated("同僚", "甲某", "乙某", 8, null, "ACTIVE"),
      aggregated("父子", "甲", "丙", 2, null, "ACTIVE")
    ];
    // ⚠️ 这个三元组口径必须与**生产**（`buildCollapseKey`）一致：对称码按**无序对**。
    // 批次 30 之前它是有向的 —— 与生产不一致，只是当前输入恰好区分不出来
    // （每个对称组的两条成员下标对本来就同向）。一旦往输入里加一条**对称反向**行，
    // 有向口径就会**谎报**「三元组变多了」，而生产其实会把它折掉。
    const triple = (item: AggregatedRelation) => {
      const source = INDEX.get(item.sourceKey);
      const target = INDEX.get(item.targetKey);
      if (source === undefined || target === undefined) {
        return `key|${item.identity}`;
      }
      if (!SYMMETRIC.has(item.typeCode)) {
        return `${String(source)}|${String(target)}|${item.typeCode}`;
      }
      const [first, second] = source <= target ? [source, target] : [target, source];
      return `${String(first)}|${String(second)}|${item.typeCode}`;
    };

    const before = new Set(input.map(triple));
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);
    const after = new Set(outcome.relations.map(triple));

    expect(after).toEqual(before);
    // 5 条 → 3 个实体三元组，折叠掉 2 条。
    expect(outcome.relations).toHaveLength(3);
    expect(outcome.collapsedCount).toBe(2);
    // 每个三元组恰好剩一条 —— 这正是落库唯一索引的口径。
    expect(after.size).toBe(outcome.relations.length);
  });

  it("两端解析不到实体的关系不参与折叠（落库时本就会被整条跳过）", () => {
    const input = [
      aggregated("朋友", "甲", "查无此人", 3, null, "ACTIVE"),
      aggregated("朋友", "甲某", "查无此人", 5, null, "ACTIVE")
    ];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);
    // 用键级身份键作去重键 → 两条身份键不同，不折叠。
    expect(outcome.relations).toHaveLength(2);
    expect(outcome.collapsedCount).toBe(0);
  });

  it("输出按起始章节稳定排序（折叠会把 startChapter 提前）", () => {
    const input = [
      aggregated("朋友", "甲某", "乙某", 20, null, "ACTIVE"),
      aggregated("朋友", "甲", "乙", 3, null, "ACTIVE"),
      aggregated("父子", "甲", "丙", 50, null, "ACTIVE")
    ];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);
    expect(outcome.relations.map((item) => item.startChapter)).toEqual([3, 50]);
  });

  it("空输入返回空结果", () => {
    expect(collapseByEntityTriple([], INDEX, SYMMETRIC)).toEqual({
      relations       : [],
      collapsedCount  : 0,
      droppedSelfLoops: 0
    });
  });

  /**
   * ⚠️ 这条断言存在的唯一理由：`run.ts` 的 `aggregate_summary` 把
   * `aggregated − collapsedByEntityTriple − droppedSelfLoops === relations
   *  === persistedRelations` 当作**可验伪的不变量**在报。
   * 等式左边依赖两个计数的确切语义 —— 一旦有人把 `collapsedCount` 从
   * 「被折进去的**输入**条数」改成「折叠后**剩下**的组数」，等式就会悄悄失衡，
   * 而 `aggregate_summary` 里几个数**看起来都还在**。
   * 所以这里把语义钉死：`输入条数 − collapsedCount − droppedSelfLoops === 输出条数`。
   *
   * ⚠️ 批次 30 追加 `− droppedSelfLoops`：自环是**丢掉**（1 → 0）而不是**折进去**
   * （2 → 1）。若把它并进 `collapsedCount`，等式**照样成立**（一增一减相抵）
   * → 「自环被剔了几条」在留档里静默消失。本条与下面 N22 的两条一起钉住这个区分。
   */
  it("**语义钉子**：collapsedCount 是「被折进去的输入条数」，即 输入 − collapsedCount − droppedSelfLoops === 输出", () => {
    const input = [
      aggregated("朋友", "甲", "乙", 3, null, "ACTIVE"),
      aggregated("朋友", "甲某", "乙某", 20, null, "ACTIVE"),
      aggregated("父子", "甲", "丙", 50, null, "ACTIVE"),
      aggregated("父子", "甲某", "丙某", 60, 70, "ENDED")
    ];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);
    expect(outcome.relations).toHaveLength(2);
    expect(outcome.collapsedCount).toBe(2);
    expect(outcome.droppedSelfLoops).toBe(0);
    expect(input.length - outcome.collapsedCount - outcome.droppedSelfLoops).toBe(
      outcome.relations.length
    );
  });
});

describe("collapseByEntityTriple —— 修复 N21（对称码的折叠键漏了排序）", () => {
  /** `甲`/`甲某` → 0，`乙`/`乙某` → 1：两个键归并成同一个实体。 */
  const INDEX = new Map([
    ["甲", 0],
    ["甲某", 0],
    ["乙", 1],
    ["乙某", 1],
    ["丙", 2]
  ]);

  it("**核心用例**：键不同、实体对相同、方向相反的对称关系被折叠成一条", () => {
    // 这两条在 `aggregateRelations` 里**不会**被折叠（键集不同 → 身份键不同），
    // 但落库口径是**实体对**（对称码无序），所以它们在语义上是**同一条边**。
    // 批次 30 之前折叠键是**有向**的 → 两条都落库 → 绕过 P4/P6 的对称去重。
    const input = [
      aggregated("朋友", "甲", "乙", 13, null, "ACTIVE"),
      aggregated("朋友", "乙某", "甲某", 13, null, "ACTIVE")
    ];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);

    expect(outcome.relations).toHaveLength(1);
    expect(outcome.collapsedCount).toBe(1);
    expect(outcome.droppedSelfLoops).toBe(0);
    // 证据引用的键级身份键必须**全部**带出来（与 N16 同一条纪律）。
    expect(outcome.relations[0]?.mergedIdentities).toEqual([input[0]?.identity, input[1]?.identity]);
    // 存活的是 `aggregated` 顺序里**先出现**的那条（`compareAggregated` 决定，确定性）。
    expect(outcome.relations[0]?.sourceKey).toBe("甲");
  });

  it("**负例**：非对称码（父子）方向相反的两条**不得**被折叠", () => {
    // `父子 A→B` 与 `父子 B→A` 是两条**不同的**关系，不是重复。
    // 若把排序做成无条件生效，这一条会被错误合并（变异 AG3 专打它）。
    const input = [
      aggregated("父子", "甲", "乙", 3, null, "ACTIVE"),
      aggregated("父子", "乙", "甲", 8, null, "ACTIVE")
    ];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);
    expect(outcome.relations).toHaveLength(2);
    expect(outcome.collapsedCount).toBe(0);
  });

  it("**负例**：同一对实体的**不同**对称码（朋友 vs 同僚）不得被折叠", () => {
    // 「既是朋友又是同僚」是**正常数据**。按无序对分组**必须带 typeCode**，
    // 否则会把两种关系错误合并成一种。
    const input = [
      aggregated("朋友", "甲", "乙", 3, null, "ACTIVE"),
      aggregated("同僚", "乙", "甲", 8, null, "ACTIVE")
    ];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);
    expect(outcome.relations).toHaveLength(2);
    expect(outcome.collapsedCount).toBe(0);
  });
});

describe("collapseByEntityTriple —— 修复 N22（归并后的自环无人复查）", () => {
  /** `甲`/`甲某` 归并成**同一个**实体 → `甲 → 甲某` 在实体层就是自环。 */
  const INDEX = new Map([
    ["甲", 0],
    ["甲某", 0],
    ["乙", 1],
    ["丙", 2]
  ]);

  it("**核心用例**：归并后两端落到同一实体的关系被剔除并单独计数", () => {
    // P4 只在**归一化键**上判自环（`甲` ≠ `甲某` → 放行），
    // 到 P5 归并之后才知道两者是同一个人 —— 这时行已经成了非法自环。
    const input = [aggregated("夫妻", "甲", "甲某", 6, null, "ACTIVE")];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);

    expect(outcome.relations).toHaveLength(0);
    expect(outcome.droppedSelfLoops).toBe(1);
    // ⚠️ 必须是 0：自环是「丢掉」不是「折进去」。混进 `collapsedCount` 会让
    // run.ts 的可验伪等式**照样成立**（一增一减相抵）→ 剔除这件事静默消失。
    expect(outcome.collapsedCount).toBe(0);
  });

  it("剔除自环不影响同批的正常行，且可验伪等式仍成立", () => {
    const input = [
      aggregated("夫妻", "甲", "甲某", 6, null, "ACTIVE"),
      aggregated("朋友", "甲", "乙", 3, null, "ACTIVE"),
      aggregated("父子", "甲", "丙", 9, null, "ACTIVE")
    ];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);
    expect(outcome.relations).toHaveLength(2);
    expect(outcome.droppedSelfLoops).toBe(1);
    expect(outcome.collapsedCount).toBe(0);
    expect(input.length - outcome.collapsedCount - outcome.droppedSelfLoops).toBe(
      outcome.relations.length
    );
  });

  it("**边界**：键级自环（甲 → 甲）由 P4 负责，但本函数也必须剔掉它", () => {
    // `vote.ts` 的 `sourceKey === targetKey` 已经把这种行丢在 P4。
    // 万一有别的调用点漏过来，本函数用**同一个判据**（实体下标相等）兜住。
    const input = [aggregated("朋友", "甲", "甲", 3, null, "ACTIVE")];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);
    expect(outcome.relations).toHaveLength(0);
    expect(outcome.droppedSelfLoops).toBe(1);
  });

  it("**负例**：两端都解析不到实体时**不**按自环剔除（退回归一化键口径）", () => {
    // 判据是「实体下标相等」，两端都解析不出来就**判不了** ——
    // 此时保持改动前的行为（不剔除、不计数），因为这条关系落库时本就会被整条跳过。
    const input = [aggregated("朋友", "查无此人", "查无此人", 3, null, "ACTIVE")];
    const outcome = collapseByEntityTriple(input, INDEX, SYMMETRIC);
    expect(outcome.relations).toHaveLength(1);
    expect(outcome.droppedSelfLoops).toBe(0);
  });
});
