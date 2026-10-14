import { describe, expect, it } from "vitest";

import { normalizeName } from "@/lib/text";

import {
  computeEntityMetric,
  computePrf,
  computeRelationMetric,
  evaluateAll,
  relationIdentity
} from "./metrics";

describe("computePrf", () => {
  it("常规计算", () => {
    const prf = computePrf(8, 2, 2);
    expect(prf.precision).toBeCloseTo(0.8);
    expect(prf.recall).toBeCloseTo(0.8);
    expect(prf.f1).toBeCloseTo(0.8);
  });

  it("分母为 0 时返回 0 而非 NaN", () => {
    expect(computePrf(0, 0, 0)).toEqual({ precision: 0, recall: 0, f1: 0 });
  });

  it("只有 TP 时为满分", () => {
    expect(computePrf(5, 0, 0)).toEqual({ precision: 1, recall: 1, f1: 1 });
  });
});

describe("computeEntityMetric", () => {
  it("完全匹配", () => {
    const outcome = computeEntityMetric(
      [{ canonical: "范进", type: "PERSON", nameType: "NAMED", aliases: [] }],
      [{ canonical: "范进", aliases: [] }]
    );
    expect(outcome).toEqual({ truePositive: 1, falsePositive: 0, falseNegative: 0 });
  });

  it("别名命中即算匹配（与归并口径一致）", () => {
    const outcome = computeEntityMetric(
      [{ canonical: "范进", type: "PERSON", nameType: "NAMED", aliases: [] }],
      [{ canonical: "范老爷", aliases: ["范进"] }]
    );
    expect(outcome.truePositive).toBe(1);
  });

  it("归一化后比较，空白差异不影响匹配", () => {
    const outcome = computeEntityMetric(
      [{ canonical: "司马光", type: "PERSON", nameType: "NAMED", aliases: [] }],
      [{ canonical: "司马 光", aliases: [] }]
    );
    expect(outcome.truePositive).toBe(1);
  });

  it("统计假正例与假负例", () => {
    const outcome = computeEntityMetric(
      [
        { canonical: "甲", type: "PERSON", nameType: "NAMED", aliases: [] },
        { canonical: "乙", type: "PERSON", nameType: "NAMED", aliases: [] }
      ],
      [{ canonical: "甲", aliases: [] }, { canonical: "丙", aliases: [] }]
    );
    expect(outcome).toEqual({ truePositive: 1, falsePositive: 1, falseNegative: 1 });
  });

  it("多个系统实体不会重复认领同一金标实体", () => {
    const outcome = computeEntityMetric(
      [{ canonical: "范进", type: "PERSON", nameType: "NAMED", aliases: ["范老爷"] }],
      [{ canonical: "范进", aliases: [] }, { canonical: "范老爷", aliases: [] }]
    );
    expect(outcome.truePositive).toBe(1);
    expect(outcome.falsePositive).toBe(1);
  });
});

describe("computeRelationMetric", () => {
  // 第三个参数是**实体表**（提供别名用于端点解析）。此处传 `[]` 表示
  // 「没有别名信息」—— 端点退化为按归一化名相等比较，即本组用例的原始口径。
  // 别名解析本身另有一组用例（见下方「关系端点必须解析别名」）。
  it("完全匹配", () => {
    const outcome = computeRelationMetric(
      [{ typeCode: "师生", sourceCanonical: "周进", targetCanonical: "范进" }],
      [{ typeCode: "师生", sourceCanonical: "周进", targetCanonical: "范进" }],
      []
    );
    expect(outcome).toEqual({ truePositive: 1, falsePositive: 0, falseNegative: 0 });
  });

  it("对称关系方向不影响匹配", () => {
    const outcome = computeRelationMetric(
      [{ typeCode: "夫妻", sourceCanonical: "甲", targetCanonical: "乙" }],
      [{ typeCode: "夫妻", sourceCanonical: "乙", targetCanonical: "甲" }],
      []
    );
    expect(outcome.truePositive).toBe(1);
  });

  it("非对称关系方向影响匹配", () => {
    const outcome = computeRelationMetric(
      [{ typeCode: "父子", sourceCanonical: "甲", targetCanonical: "乙" }],
      [{ typeCode: "父子", sourceCanonical: "乙", targetCanonical: "甲" }],
      []
    );
    expect(outcome.truePositive).toBe(0);
    expect(outcome.falsePositive).toBe(1);
    expect(outcome.falseNegative).toBe(1);
  });

  it("重复输出不重复计 TP", () => {
    const outcome = computeRelationMetric(
      [{ typeCode: "朋友", sourceCanonical: "甲", targetCanonical: "乙" }],
      [
        { typeCode: "朋友", sourceCanonical: "甲", targetCanonical: "乙" },
        { typeCode: "朋友", sourceCanonical: "甲", targetCanonical: "乙" }
      ],
      []
    );
    expect(outcome.truePositive).toBe(1);
    expect(outcome.falsePositive).toBe(1);
  });
});

describe("computeRelationMetric —— 关系端点必须解析别名（与实体指标同口径）", () => {
  /** 图谱：规范名 `时仁`，别名 `时知县` —— 与真实数据同形。 */
  const entities = [
    { canonical: "危素", aliases: [] },
    { canonical: "时仁", aliases: ["时知县"] }
  ];

  it("**回归护栏**：金标写别名、图谱写规范名时仍算 TP", () => {
    // 这是实测踩到的口径缺陷：实体指标按成员集合匹配，关系指标却只比规范名，
    // 于是 `师生 危素→时知县`（金标）与 `师生 危素→时仁`（图谱）
    // 明明是同一条，却被判成 FN —— 召回率被系统性低估。
    const outcome = computeRelationMetric(
      [{ typeCode: "师生", sourceCanonical: "危素", targetCanonical: "时知县" }],
      [{ typeCode: "师生", sourceCanonical: "危素", targetCanonical: "时仁" }],
      entities
    );

    expect(outcome).toEqual({ truePositive: 1, falsePositive: 0, falseNegative: 0 });
  });

  it("**护栏**：别名解析不得把两个不同实体混为一谈", () => {
    // `时知县` 只属于 `时仁`；若解析实现退化成「去后缀/子串匹配」，
    // `知县` 之类的名字就会被并到同一个下标，TP 会虚高。
    const outcome = computeRelationMetric(
      [{ typeCode: "师生", sourceCanonical: "危素", targetCanonical: "时仁" }],
      [
        { typeCode: "师生", sourceCanonical: "危素", targetCanonical: "时仁" },
        { typeCode: "师生", sourceCanonical: "危素", targetCanonical: "时知县" }
      ],
      entities
    );

    // 两条输出是同一条关系（同一实体对）→ 只算 1 个 TP、另 1 个重复算 FP。
    expect(outcome.truePositive).toBe(1);
    expect(outcome.falsePositive).toBe(1);
  });

  it("两端都解析不到实体时退回归一化名比较（FN 计数仍正确）", () => {
    const outcome = computeRelationMetric(
      [{ typeCode: "母子", sourceCanonical: "王母", targetCanonical: "王冕" }],
      [],
      entities
    );

    expect(outcome.truePositive).toBe(0);
    expect(outcome.falseNegative).toBe(1);
  });

  it("**护栏**：一端可解析、一端不可解析时不得误判为匹配", () => {
    const outcome = computeRelationMetric(
      [{ typeCode: "母子", sourceCanonical: "王母", targetCanonical: "王冕" }],
      [{ typeCode: "母子", sourceCanonical: "时仁", targetCanonical: "王冕" }],
      entities
    );

    expect(outcome.truePositive).toBe(0);
    expect(outcome.falsePositive).toBe(1);
    expect(outcome.falseNegative).toBe(1);
  });
});

describe("relationIdentity", () => {
  it("对称关系两端排序后生成稳定键", () => {
    const left = relationIdentity(
      { typeCode: "夫妻", sourceCanonical: "乙", targetCanonical: "甲" },
      normalizeName
    );
    const right = relationIdentity(
      { typeCode: "夫妻", sourceCanonical: "甲", targetCanonical: "乙" },
      normalizeName
    );
    expect(left).toBe(right);
  });

  it("非对称关系保留方向", () => {
    const left = relationIdentity(
      { typeCode: "父子", sourceCanonical: "乙", targetCanonical: "甲" },
      normalizeName
    );
    const right = relationIdentity(
      { typeCode: "父子", sourceCanonical: "甲", targetCanonical: "乙" },
      normalizeName
    );
    expect(left).not.toBe(right);
  });

  it("**护栏**：`relationIdentity` 必须对**两端**都调用解析函数", () => {
    // 解析函数由用例提供：`时知县` 与 `时仁` 代表**同一个实体**的两种写法。
    // 未命中时把原名拼进键里，这样「压根没调 resolve」的变异也会让结果不同。
    const resolve = (name: string) => {
      const key = normalizeName(name);
      return key === "时知县" || key === "时仁" ? "E1" : `E0:${key}`;
    };

    // 只解析一端（或两端都不解析）时，两条关系会得到不同的键，本用例即失败。
    expect(
      relationIdentity({ typeCode: "师生", sourceCanonical: "危素", targetCanonical: "时知县" }, resolve)
    ).toBe(
      relationIdentity({ typeCode: "师生", sourceCanonical: "危素", targetCanonical: "时仁" }, resolve)
    );
  });

  it("**护栏**：源端也必须被解析（差异只放在源端时仍要归到同一个键）", () => {
    // 上一条的差异在**目标端**，漏掉源端解析照样能过。
    // 本条把差异放到**源端**：只有源端也走了 resolve，两条键才会相等。
    const resolve = (name: string) => {
      const key = normalizeName(name);
      return key === "时知县" || key === "时仁" ? "E1" : `E0:${key}`;
    };

    expect(
      relationIdentity({ typeCode: "师生", sourceCanonical: "时知县", targetCanonical: "范进" }, resolve)
    ).toBe(
      relationIdentity({ typeCode: "师生", sourceCanonical: "时仁", targetCanonical: "范进" }, resolve)
    );
  });
});

describe("evaluateAll", () => {
  it("汇总实体与关系指标", () => {
    const report = evaluateAll(
      {
        entities : [{ canonical: "范进", type: "PERSON", nameType: "NAMED", aliases: [] }],
        relations: [{ typeCode: "师生", sourceCanonical: "周进", targetCanonical: "范进" }]
      },
      {
        entities : [{ canonical: "范进", aliases: [] }],
        relations: [{ typeCode: "师生", sourceCanonical: "周进", targetCanonical: "范进" }]
      }
    );
    expect(report.entity.f1).toBe(1);
    expect(report.relation.f1).toBe(1);
  });

  it("**接线回归护栏**：`evaluateAll` 必须把实体表传给关系指标", () => {
    // 只写上面的用例时，若有人把 `computeRelationMetric` 的第三个实参删掉，
    // 那里两端都是规范名，结果**不变** —— 变异存活。
    // 本用例的金标端点写的是别名，只有真正接上了实体表才会是 TP。
    const report = evaluateAll(
      {
        entities : [{ canonical: "时知县", type: "PERSON", nameType: "NAMED", aliases: ["时仁"] }],
        relations: [{ typeCode: "师生", sourceCanonical: "危素", targetCanonical: "时知县" }]
      },
      {
        entities: [
          { canonical: "危素", aliases: [] },
          { canonical: "时仁", aliases: ["时知县"] }
        ],
        relations: [{ typeCode: "师生", sourceCanonical: "危素", targetCanonical: "时仁" }]
      }
    );

    expect(report.relation.tp).toBe(1);
    expect(report.relation.fn).toBe(0);
  });
});
