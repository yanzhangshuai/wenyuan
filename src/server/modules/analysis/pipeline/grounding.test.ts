import { describe, expect, it } from "vitest";

import {
  buildGroundingIndex,
  groundEntities,
  groundRelations,
  isNameGrounded
} from "./grounding";

const CORPUS = [
  "范进进学回家，母亲、妻子俱各欢喜。",
  "周学道坐在堂上，见范进进来。"
];

const INDEX = buildGroundingIndex(CORPUS);

describe("grounding 基础判定", () => {
  it("有字面证据的名字通过", () => {
    expect(isNameGrounded("范进", INDEX)).toBe(true);
    expect(isNameGrounded("周学道", INDEX)).toBe(true);
  });

  it("无字面证据的名字被拒", () => {
    expect(isNameGrounded("严监生", INDEX)).toBe(false);
  });

  it("空名字恒被拒", () => {
    expect(isNameGrounded("", INDEX)).toBe(false);
    expect(isNameGrounded("   ", INDEX)).toBe(false);
  });

  it("归一化后匹配：内部空白不影响命中", () => {
    expect(isNameGrounded("范 进", INDEX)).toBe(true);
  });
});

describe("groundEntities", () => {
  it("整条剔除无证据实体，仅剔除无证据别名", () => {
    const outcome = groundEntities(
      [
        { canonical: "范进", type: "PERSON", nameType: "NAMED", aliases: ["进学", "范老爷"] },
        { canonical: "严监生", type: "PERSON", nameType: "NAMED", aliases: [] }
      ],
      INDEX
    );

    expect(outcome.kept).toHaveLength(1);
    expect(outcome.kept[0]?.canonical).toBe("范进");
    expect(outcome.kept[0]?.aliases).toEqual(["进学"]);
    expect(outcome.droppedEntities).toEqual(["严监生"]);
    expect(outcome.droppedAliases).toBe(1);
  });
});

describe("groundRelations", () => {
  const base = {
    typeCode       : "师生",
    sourceCanonical: "范进",
    targetCanonical: "周学道"
  };

  it("默认要求引用本身可字面命中", () => {
    const outcome = groundRelations(
      [
        { ...base, quote: "见范进进来" },
        { ...base, quote: "这段引用是编造的" }
      ],
      INDEX
    );

    expect(outcome.kept).toHaveLength(1);
    expect(outcome.droppedRelations).toEqual(["师生:范进→周学道"]);
  });

  it("两端实体无证据时剔除", () => {
    const outcome = groundRelations(
      [{ ...base, sourceCanonical: "查无此人", quote: "见范进进来" }],
      INDEX
    );
    expect(outcome.kept).toHaveLength(0);
  });

  it("可关闭引用校验，退化为仅校验两端实体", () => {
    const outcome = groundRelations(
      [{ ...base, quote: "这段引用是编造的" }],
      INDEX,
      { requireQuoteEvidence: false }
    );
    expect(outcome.kept).toHaveLength(1);
  });

  it("保留调用方附加的元信息（如来源章节），供 P6 计算有效期", () => {
    // 这是 P6 关系生命周期能否生效的前提：若 grounding 把附加字段剥掉，
    // 上层就只能靠名字回查章节 —— 正是 v1 的缺陷模式。
    const outcome = groundRelations(
      [
        { ...base, quote: "见范进进来", chapterOrdinal: 3 },
        { ...base, quote: "周学道坐在堂上", chapterOrdinal: 9 }
      ],
      INDEX
    );
    expect(outcome.kept.map((item) => item.chapterOrdinal)).toEqual([3, 9]);
  });
});
