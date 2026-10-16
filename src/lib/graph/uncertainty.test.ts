import { describe, expect, it } from "vitest";

import {
  ALIAS_SUSPECT_MIN_CHAPTER_OVERLAP,
  ALIAS_SUSPECT_MIN_MENTIONS,
  computeUncertainty,
  detectAliasSuspect,
  detectNameAmbiguous,
  detectNameIncomplete,
  detectRelationSingleSource,
  detectTypeSuspect,
  groupMarksByKind,
  sampleMarksForAudit,
  type UncertaintyEntityInput,
  type UncertaintyRelationInput
} from "./uncertainty";

/**
 * 不确定性检测器单测（纯函数层）。
 *
 * 每个检测器至少覆盖：命中 / 不命中 / 边界。④ 号额外覆盖修正案 4 的
 * 「信号方向」：共现的亲属对**不得**命中，互斥的拆人对**才**命中。
 */

function entity(overrides: Partial<UncertaintyEntityInput>): UncertaintyEntityInput {
  return {
    id             : "e1",
    canonical      : "某",
    type           : "PERSON",
    aliasCount     : 0,
    honorificForm  : false,
    properNameForm : true,
    gateRejection  : null,
    mentionCount   : 0,
    paragraphIds   : [],
    chapterOrdinals: [],
    ...overrides
  };
}

function relation(overrides: Partial<UncertaintyRelationInput>): UncertaintyRelationInput {
  return {
    id           : "r1",
    sourceId     : "e1",
    targetId     : "e2",
    pairKey      : "甲⇄乙[朋友]",
    status       : "ACTIVE",
    evidenceCount: 2,
    ...overrides
  };
}

describe("① detectNameIncomplete（本名缺失）", () => {
  it("称谓形式 + 零别名 → high 标记", () => {
    const marks = detectNameIncomplete([
      entity({ canonical: "太祖", honorificForm: true, properNameForm: false, aliasCount: 0 })
    ]);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.kind).toBe("name_incomplete");
    expect(marks[0]?.confidence).toBe("high");
    expect(marks[0]?.detector).toEqual({ id: "name_incomplete", version: 1 });
  });

  it("称谓形式但有别名 → 不标（本名已在别名里，属已修的 A 类形态）", () => {
    const marks = detectNameIncomplete([
      entity({ canonical: "马二先生", honorificForm: true, aliasCount: 2 })
    ]);
    expect(marks).toHaveLength(0);
  });

  it("本名形态 + 零别名 → 不标", () => {
    const marks = detectNameIncomplete([entity({ canonical: "杜少卿", aliasCount: 0 })]);
    expect(marks).toHaveLength(0);
  });
});

describe("② detectNameAmbiguous（同人歧义）", () => {
  it("本名缺失 + 同姓有本名形态实体 → medium 标记（detector v2）", () => {
    const marks = detectNameAmbiguous([
      entity({ id: "e1", canonical: "太祖", honorificForm: true, properNameForm: false }),
      entity({ id: "e2", canonical: "太史公", type: "PERSON", properNameForm: true })
    ]);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.subjectId).toBe("e1");
    expect(marks[0]?.confidence).toBe("medium");
    expect(marks[0]?.detector).toEqual({ id: "name_ambiguous", version: 2 });
  });

  it("同姓无本名形态实体 → 不标", () => {
    const marks = detectNameAmbiguous([
      entity({ id: "e1", canonical: "周老爷", honorificForm: true, properNameForm: false }),
      entity({ id: "e2", canonical: "周大嫂", honorificForm: true, properNameForm: false })
    ]);
    expect(marks).toHaveLength(0);
  });

  it("有别名的称谓不进入②（② 是 ① 的子集）", () => {
    const marks = detectNameAmbiguous([
      entity({ id: "e1", canonical: "卫先生", honorificForm: true, aliasCount: 1 }),
      entity({ id: "e2", canonical: "卫体善", properNameForm: true })
    ]);
    expect(marks).toHaveLength(0);
  });

  it("v2：同姓本名池只认 PERSON —— 地理实体的同姓不构成歧义", () => {
    const marks = detectNameAmbiguous([
      // 仁宗皇帝（PERSON，称谓）与 仁和（LOCATION，本名形态）同姓「仁」
      entity({ id: "e1", canonical: "仁宗皇帝", honorificForm: true, properNameForm: false }),
      entity({ id: "e2", canonical: "仁和", type: "LOCATION", properNameForm: true })
    ]);
    expect(marks).toHaveLength(0);
  });

  it("v2：被标实体本身非 PERSON → 不标（即使池里有 PERSON）", () => {
    const marks = detectNameAmbiguous([
      entity({ id: "e1", canonical: "天香楼", type: "LOCATION", honorificForm: true, properNameForm: false }),
      entity({ id: "e2", canonical: "天香居士", properNameForm: true })
    ]);
    expect(marks).toHaveLength(0);
  });
});

describe("③ detectTypeSuspect（溯源矛盾）", () => {
  it("PERSON + 官职词表命中（official_title）→ medium 标记", () => {
    const marks = detectTypeSuspect([
      entity({ canonical: "范学台", gateRejection: "official_title" })
    ]);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.kind).toBe("type_suspect");
  });

  it("PERSON + 尊称词表命中（generic_appellation）→ 标记", () => {
    const marks = detectTypeSuspect([
      entity({ canonical: "老父台", gateRejection: "generic_appellation" })
    ]);
    expect(marks).toHaveLength(1);
  });

  it("PERSON + 其他拒绝原因（如列举式）→ 不标（与类型判定无关）", () => {
    const marks = detectTypeSuspect([
      entity({ canonical: "五经四书八股文", gateRejection: "enumeration_name" })
    ]);
    expect(marks).toHaveLength(0);
  });

  it("非 PERSON + 词表命中 → 不标；闸门放行 → 不标", () => {
    const marks = detectTypeSuspect([
      entity({ id: "e1", canonical: "知县", type: "LOCATION", gateRejection: "official_title" }),
      entity({ id: "e2", canonical: "杜少卿", gateRejection: null })
    ]);
    expect(marks).toHaveLength(0);
  });
});

describe("④ detectAliasSuspect（互斥共现）", () => {
  const splitPair: UncertaintyEntityInput[] = [
    entity({
      id             : "e1",
      canonical      : "严大位",
      mentionCount   : 8,
      paragraphIds   : ["p1", "p2", "p3"],
      chapterOrdinals: [4, 5, 6]
    }),
    entity({
      id             : "e2",
      canonical      : "严致中",
      mentionCount   : 6,
      paragraphIds   : ["p9", "p10"],
      chapterOrdinals: [5, 6]
    })
  ];

  it("同姓 + 从不共段 + 章节重叠 100% + 无边 → low 标记", () => {
    const marks = detectAliasSuspect(splitPair, []);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.confidence).toBe("low");
    expect(marks[0]?.subjectKey).toBe("严大位⇄严致中");
  });

  it("共段的亲属对 → 不标（修正案 4：共现是「两个人」的证据）", () => {
    const kin: UncertaintyEntityInput[] = [
      entity({ id: "e1", canonical: "秦老", mentionCount: 9, paragraphIds: ["p1"], chapterOrdinals: [1] }),
      entity({ id: "e2", canonical: "秦大汉", mentionCount: 7, paragraphIds: ["p1"], chapterOrdinals: [1] })
    ];
    expect(detectAliasSuspect(kin, [])).toHaveLength(0);
  });

  it("两者之间已有关系边 → 不标（管线已认定二人互动）", () => {
    const edge = relation({ sourceId: "e1", targetId: "e2" });
    expect(detectAliasSuspect(splitPair, [edge])).toHaveLength(0);
  });

  it("提及数低于阈值 → 不标（宁可少标）", () => {
    const sparse = splitPair.map((item) => ({
      ...item,
      mentionCount: ALIAS_SUSPECT_MIN_MENTIONS - 1
    }));
    expect(detectAliasSuspect(sparse, [])).toHaveLength(0);
  });

  it("不同姓 → 不标；非 PERSON → 不标", () => {
    const otherSurname = [
      splitPair[0],
      entity({ ...splitPair[1], canonical: "汤致中" })
    ].filter((item): item is UncertaintyEntityInput => item !== undefined);
    expect(detectAliasSuspect(otherSurname, [])).toHaveLength(0);

    const notPerson = splitPair.map((item) => ({ ...item, type: "LOCATION" }));
    expect(detectAliasSuspect(notPerson, [])).toHaveLength(0);
  });

  it("章节重叠率低于阈值 → 不标", () => {
    const disjoint: UncertaintyEntityInput[] = [
      entity({
        id             : "e1",
        canonical      : "严大位",
        mentionCount   : 8,
        paragraphIds   : ["p1"],
        chapterOrdinals: [1, 2, 3, 4]
      }),
      entity({
        id             : "e2",
        canonical      : "严致中",
        mentionCount   : 8,
        paragraphIds   : ["p9"],
        // 与左端 4 章只重叠 1 章：1/min(4,2)=0.5 边界 → 改用更低重叠
        chapterOrdinals: [30, 31]
      })
    ];
    // 0/min(4,2)=0 < ALIAS_SUSPECT_MIN_CHAPTER_OVERLAP
    expect(ALIAS_SUSPECT_MIN_CHAPTER_OVERLAP).toBeGreaterThan(0);
    expect(detectAliasSuspect(disjoint, [])).toHaveLength(0);
  });
});

describe("⑤ detectRelationSingleSource（关系单源）", () => {
  it("恰好 1 条证据 → high 标记；0 条或多条 → 不标", () => {
    const marks = detectRelationSingleSource([
      relation({ id: "r1", evidenceCount: 1 }),
      relation({ id: "r2", evidenceCount: 0 }),
      relation({ id: "r3", evidenceCount: 3 })
    ]);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.subjectId).toBe("r1");
    expect(marks[0]?.confidence).toBe("high");
  });

  it("ENDED 关系同样标记（有效期不影响证据薄厚）", () => {
    const marks = detectRelationSingleSource([relation({ status: "ENDED", evidenceCount: 1 })]);
    expect(marks).toHaveLength(1);
  });
});

describe("computeUncertainty（汇总 + 覆盖率）", () => {
  it("覆盖率按实体/关系去重统计，byKind 恒含全部五类", () => {
    const report = computeUncertainty({
      entities: [
        entity({
          id            : "e1",
          canonical     : "太祖",
          honorificForm : true,
          properNameForm: false,
          aliasCount    : 0
        }),
        // 同一实体同时命中 ①②，实体侧只应计 1 个「已表态」
        entity({ id: "e2", canonical: "太白", properNameForm: true, aliasCount: 1 })
      ],
      relations: [relation({ id: "r1", evidenceCount: 1 })]
    });

    expect(report.coverage.entityTotal).toBe(2);
    expect(report.coverage.relationTotal).toBe(1);
    expect(report.coverage.relationMarked).toBe(1);
    expect(report.coverage.byKind.map((entry) => entry.kind)).toEqual([
      "name_incomplete",
      "name_ambiguous",
      "type_suspect",
      "alias_suspect",
      "relation_single_source"
    ]);
    // 每条标记都必须带检测器身份与置信度（修正案 1）
    for (const mark of report.marks) {
      expect(mark.detector.id.length).toBeGreaterThan(0);
      expect(mark.detector.version).toBeGreaterThanOrEqual(1);
      expect(["high", "medium", "low"]).toContain(mark.confidence);
    }
  });

  it("空输入 → 空报告（不 throw）", () => {
    const report = computeUncertainty({ entities: [], relations: [] });
    expect(report.marks).toHaveLength(0);
    expect(report.coverage.entityTotal).toBe(0);
  });
});

describe("sampleMarksForAudit（自知准确率取样器）", () => {
  const pool = computeUncertainty({
    entities: [
      entity({ id: "e1", canonical: "太祖", honorificForm: true, properNameForm: false }),
      entity({ id: "e2", canonical: "范学台", gateRejection: "official_title" })
    ],
    relations: [
      relation({ id: "r1", evidenceCount: 1 }),
      relation({ id: "r2", evidenceCount: 1 })
    ]
  }).marks;

  it("同 seed 同样本（可复核），样本量受 count 约束", () => {
    const a = sampleMarksForAudit(pool, 2, 42);
    const b = sampleMarksForAudit(pool, 2, 42);
    expect(a.map((m) => m.subjectId + m.kind)).toEqual(b.map((m) => m.subjectId + m.kind));
    expect(a).toHaveLength(2);
  });

  it("count 超过池大小时返回全部；count=0 返回空", () => {
    expect(sampleMarksForAudit(pool, 999, 1)).toHaveLength(pool.length);
    expect(sampleMarksForAudit(pool, 0, 1)).toHaveLength(0);
  });

  it("取样结果与输入数组顺序无关（先排序再洗牌）", () => {
    const reversed = [...pool].reverse();
    const a = sampleMarksForAudit(pool, pool.length, 7).map((m) => m.subjectId + m.kind).sort();
    const b = sampleMarksForAudit(reversed, pool.length, 7).map((m) => m.subjectId + m.kind).sort();
    expect(a).toEqual(b);
  });
});

describe("groupMarksByKind（二期面板分组）", () => {
  const pool = computeUncertainty({
    entities: [
      entity({ id: "e1", canonical: "太祖", honorificForm: true, properNameForm: false }),
      entity({ id: "e2", canonical: "范学台", gateRejection: "official_title" })
    ],
    relations: [
      relation({ id: "r1", evidenceCount: 1, pairKey: "甲⇄乙[朋友]" }),
      relation({ id: "r2", evidenceCount: 1, pairKey: "丙⇄丁[朋友]" })
    ]
  }).marks;

  it("空类别不出现，组序恒为固定类别顺序", () => {
    const groups = groupMarksByKind(pool);
    // 本输入触发 ①③⑤（范学台命中官职词表 → ③）
    expect(groups.map((g) => g.kind)).toEqual([
      "name_incomplete",
      "type_suspect",
      "relation_single_source"
    ]);
    expect(groups[0]?.label.length).toBeGreaterThan(0);
  });

  it("组内先按置信度（high→low）再按对象键排序，输入顺序无关", () => {
    const shuffled = [...pool].reverse();
    const a = groupMarksByKind(pool).map((g) => g.marks.map((m) => m.subjectId).join());
    const b = groupMarksByKind(shuffled).map((g) => g.marks.map((m) => m.subjectId).join());
    expect(a).toEqual(b);
  });

  it("空输入 → 空分组", () => {
    expect(groupMarksByKind([])).toEqual([]);
  });
});

describe("groupMarksByKind（合成标记：同组混合置信度）", () => {
  // 真实检测器当前各自只发一种置信度，但函数是通用工具：
  // 未来检测器可能同组多置信度 —— 用合成标记把「组内置信度排序」钉死。
  const mixed = [
    {
      subjectType: "relationship" as const,
      subjectId  : "r2",
      subjectKey : "乙⇄丁[朋友]",
      kind       : "relation_single_source" as const,
      detector   : { id: "relation_single_source", version: 1 },
      confidence : "low" as const,
      detail     : "低置信样本"
    },
    {
      subjectType: "relationship" as const,
      subjectId  : "r1",
      subjectKey : "甲⇄丙[朋友]",
      kind       : "relation_single_source" as const,
      detector   : { id: "relation_single_source", version: 1 },
      confidence : "high" as const,
      detail     : "高置信样本"
    }
  ];

  it("同组内 high 排在 low 前（与输入顺序无关）", () => {
    const groups = groupMarksByKind(mixed);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.marks.map((m) => m.subjectId)).toEqual(["r1", "r2"]);
    const reversed = groupMarksByKind([...mixed].reverse());
    expect(reversed[0]?.marks.map((m) => m.subjectId)).toEqual(["r1", "r2"]);
  });
});

describe("⑤ v2：单源关系按共现段数分档（批 81）", () => {
  it("co<=1 → 文案写「真稀疏」", () => {
    const marks = detectRelationSingleSource([
      relation({ id: "r1", evidenceCount: 1, coOccurrenceParagraphs: 1 })
    ]);
    expect(marks[0]?.detail).toContain("真稀疏");
    expect(marks[0]?.detector).toEqual({ id: "relation_single_source", version: 2 });
  });

  it("co>=2 → 文案写「疑为证据漏抽」并给出另一处同场段数", () => {
    const marks = detectRelationSingleSource([
      relation({ id: "r1", evidenceCount: 1, coOccurrenceParagraphs: 20 })
    ]);
    expect(marks[0]?.detail).toContain("疑为证据漏抽");
    expect(marks[0]?.detail).toContain("19 段同场");
  });

  it("未提供共现段数 → 退回中性文案（不臆断）", () => {
    const marks = detectRelationSingleSource([relation({ id: "r1", evidenceCount: 1 })]);
    expect(marks[0]?.detail).toContain("无法交叉自证");
  });
});

describe("④ 暂停产出（修正案 5）", () => {
  it("computeUncertainty 不再产出 alias_suspect 标记（检测器函数仍保留）", () => {
    const report = computeUncertainty({
      entities: [
        // 这对若走 ④ 会被标记（同姓、从不共段、章节重叠），但 ④ 已暂停产出
        {
          id             : "e1",
          canonical      : "严大位",
          type           : "PERSON",
          aliasCount     : 0,
          honorificForm  : false,
          properNameForm : true,
          gateRejection  : null,
          mentionCount   : 8,
          paragraphIds   : ["p1"],
          chapterOrdinals: [1]
        },
        {
          id             : "e2",
          canonical      : "严致中",
          type           : "PERSON",
          aliasCount     : 0,
          honorificForm  : false,
          properNameForm : true,
          gateRejection  : null,
          mentionCount   : 8,
          paragraphIds   : ["p9"],
          chapterOrdinals: [1]
        }
      ],
      relations: []
    });
    expect(report.marks.filter((m) => m.kind === "alias_suspect")).toHaveLength(0);
    expect(report.coverage.byKind.find((k) => k.kind === "alias_suspect")?.count).toBe(0);
  });
});
