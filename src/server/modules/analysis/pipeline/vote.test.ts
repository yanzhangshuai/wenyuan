import { describe, expect, it } from "vitest";

import type { SliceExtraction } from "../schemas";

import { voteEntityTypes, voteRelations } from "./vote";

/** 构造单条关系的分片结果。 */
function sliceOf(
  relations: { typeCode: string; source: string; target: string; quote?: string }[]
): SliceExtraction {
  return {
    entities : [],
    relations: relations.map((item) => ({
      typeCode       : item.typeCode,
      sourceCanonical: item.source,
      targetCanonical: item.target,
      quote          : item.quote ?? "引文"
    }))
  };
}

const SYMMETRIC = new Set(["兄弟", "夫妻", "同年", "同僚", "朋友", "仇敌"]);

describe("voteRelations", () => {
  it("别称归一化到规范码", () => {
    const outcome = voteRelations([sliceOf([{ typeCode: "父女", source: "甲", target: "乙" }])], SYMMETRIC);
    expect(outcome.relations[0]?.typeCode).toBe("父子");
  });

  it("无法归一化的关系码记入 unknownCodes 而非静默丢弃", () => {
    const outcome = voteRelations([sliceOf([{ typeCode: "同窗", source: "甲", target: "乙" }])], SYMMETRIC);
    expect(outcome.relations).toHaveLength(0);
    expect(outcome.unknownCodes).toEqual([{ raw: "同窗", count: 1 }]);
  });

  it("重叠分片产生的重复观测合并为一条并计票", () => {
    const outcome = voteRelations(
      [
        sliceOf([{ typeCode: "朋友", source: "甲", target: "乙" }]),
        sliceOf([{ typeCode: "朋友", source: "甲", target: "乙" }])
      ],
      SYMMETRIC
    );
    expect(outcome.relations).toHaveLength(1);
    expect(outcome.relations[0]?.votes).toBe(2);
  });

  it("对称关系合并双向", () => {
    const outcome = voteRelations(
      [
        sliceOf([{ typeCode: "夫妻", source: "甲", target: "乙" }]),
        sliceOf([{ typeCode: "夫妻", source: "乙", target: "甲" }])
      ],
      SYMMETRIC
    );
    expect(outcome.relations).toHaveLength(1);
    expect(outcome.relations[0]?.votes).toBe(2);
  });

  it("非对称关系保留方向", () => {
    const outcome = voteRelations(
      [
        sliceOf([{ typeCode: "父子", source: "甲", target: "乙" }]),
        sliceOf([{ typeCode: "父子", source: "乙", target: "甲" }])
      ],
      SYMMETRIC
    );
    expect(outcome.relations).toHaveLength(2);
  });

  it("丢弃自环关系", () => {
    const outcome = voteRelations([sliceOf([{ typeCode: "朋友", source: "甲", target: "甲" }])], SYMMETRIC);
    expect(outcome.relations).toHaveLength(0);
  });

  it("同一关系保留去重后的多条证据引用", () => {
    const outcome = voteRelations(
      [
        sliceOf([{ typeCode: "朋友", source: "甲", target: "乙", quote: "引文一" }]),
        sliceOf([{ typeCode: "朋友", source: "甲", target: "乙", quote: "引文二" }])
      ],
      SYMMETRIC
    );
    expect(outcome.relations[0]?.quotes).toEqual(["引文一", "引文二"]);
  });

  it("按票数降序排列", () => {
    const outcome = voteRelations(
      [
        sliceOf([{ typeCode: "朋友", source: "甲", target: "乙" }]),
        sliceOf([{ typeCode: "朋友", source: "甲", target: "乙" }]),
        sliceOf([{ typeCode: "仇敌", source: "丙", target: "丁" }])
      ],
      SYMMETRIC
    );
    expect(outcome.relations.map((item) => item.typeCode)).toEqual(["朋友", "仇敌"]);
  });
});

describe("voteEntityTypes", () => {
  it("取票数最高的类型", () => {
    const decided = voteEntityTypes(new Map([["书院", ["LOCATION", "ORGANIZATION", "ORGANIZATION"]]]));
    expect(decided.get("书院")).toBe("ORGANIZATION");
  });

  it("平票时按固定优先级 PERSON 优先，结果可复现", () => {
    const decided = voteEntityTypes(new Map([["某地", ["LOCATION", "PERSON"]]]));
    expect(decided.get("某地")).toBe("PERSON");
  });
});
