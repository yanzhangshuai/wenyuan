import { describe, expect, it } from "vitest";

import type { NgramCandidate } from "./discovery";
import {
  PREFIX_HAZARD_RATIO,
  auditPack,
  normalizeEntries,
  planPackEntries,
  type PackAuditInput
} from "./pack-audit";

/** 造一个 `NgramCandidate`（只用到 `gram` 与 `frequency`）。 */
function candidate(gram: string, frequency: number): NgramCandidate {
  return { gram, frequency, cohesion: 9, freedom: 9 };
}

/** 最小语料：`王太守`/`王太太` 是**别人**的写法，`元武湖` 是 `玄武湖` 的一字异文。 */
const BODY = "王太守来见王太太。杜少卿叫了一声，便往元武湖去。元武湖上风光好。";
const HEADINGS = ["第一回　王孝廉村学识同科"];

function input(overrides: Partial<PackAuditInput> = {}): PackAuditInput {
  return {
    body      : BODY,
    headings  : HEADINGS,
    candidates: [
      candidate("王太", 63),
      candidate("王太守", 25),
      candidate("王太太", 20),
      candidate("杜少卿", 321),
      candidate("杜少卿叫", 6)
    ],
    ...overrides
  };
}

describe("normalizeEntries", () => {
  it("去重 + 归一化，丢掉空串", () => {
    expect(normalizeEntries(["范进", " 范进 ", "", "周进"])).toEqual(["范进", "周进"]);
  });
});

describe("auditPack · 审计 1：死条目（口径 = 正文 + 回目）", () => {
  const report = auditPack(["王太", "杜少卿", "王孝廉", "玄武湖"], input());

  it("🚨 原文 0 次 → 死条目", () => {
    expect(report.deadEntries).toEqual(["玄武湖"]);
  });

  it("🚨 回归反证：只在**回目**里出现的名字**不是**死条目（批 36 修掉的口径 bug）", () => {
    expect(report.headingOnlyEntries).toEqual(["王孝廉"]);
    expect(report.deadEntries).not.toContain("王孝廉");
  });

  it("正文里有的名字两桶都不进", () => {
    expect(report.deadEntries).not.toContain("王太");
    expect(report.headingOnlyEntries).not.toContain("王太");
  });
});

describe("auditPack · 审计 2：前缀隐患（频次比判据）", () => {
  const report = auditPack(["王太", "杜少卿"], input());

  it("🚨 频次比 ≥ 阈值 → 报（`王太 ⊂ 王太守` 0.40 / `王太 ⊂ 王太太` 0.32）", () => {
    const pairs = report.prefixHazards.map((hazard) => `${hazard.entry}⊂${hazard.shadowed}`);
    expect(pairs).toContain("王太⊂王太守");
    expect(pairs).toContain("王太⊂王太太");
  });

  it("🚨 回归反证：「名 + 动词」的**正常切分**不得被报成隐患（`杜少卿叫` 比 0.019）", () => {
    const pairs = report.prefixHazards.map((hazard) => `${hazard.entry}⊂${hazard.shadowed}`);
    expect(pairs).not.toContain("杜少卿⊂杜少卿叫");
  });

  it("比值如实记录（用于人工判断）", () => {
    const hit = report.prefixHazards.find((hazard) => hazard.shadowed === "王太守");
    expect(hit?.ratio).toBeCloseTo(25 / 63, 5);
    expect(hit?.ratio).toBeGreaterThanOrEqual(PREFIX_HAZARD_RATIO);
  });

  it("条目自己不在候选集里 → 算不出比值 → **宁可漏报**", () => {
    const narrow = auditPack(["王太"], input({ candidates: [candidate("王太守", 25)] }));
    expect(narrow.prefixHazards).toEqual([]);
  });
});

describe("auditPack · 审计 3：一字异文", () => {
  it("恰差一个字、且出现次数够 → 给建议", () => {
    const report = auditPack(["玄武湖"], input({ minVariantOccurrences: 1 }));
    expect(report.variantSuggestions).toEqual([
      { dead: "玄武湖", replacement: "元武湖", occurrences: 2 }
    ]);
  });

  it("⚠️ 出现次数不够 → 不给建议（默认阈值 2）", () => {
    const report = auditPack(["玄武湖"], input({ body: "往元武湖去。", minVariantOccurrences: 2 }));
    expect(report.variantSuggestions).toEqual([]);
  });

  it("⚠️ 差**两个**字 → 不给建议（`刘姥姥`/`刘老老` 就是这么漏掉的）", () => {
    const report = auditPack(["刘姥姥"], {
      body                 : "刘老老来了。刘老老又来了。",
      headings             : [],
      candidates           : [],
      minVariantOccurrences: 1
    });
    expect(report.variantSuggestions).toEqual([]);
  });
});

describe("planPackEntries", () => {
  const report = auditPack(["王太", "杜少卿", "玄武湖"], input({ minVariantOccurrences: 1 }));

  it("删死条目 + 删撤下条目 + 按映射补异文，且**保持原顺序**", () => {
    const plan = planPackEntries(["王太", "杜少卿", "玄武湖"], report, {
      withdrawals: ["王太"],
      variants   : { 玄武湖: "元武湖" }
    });
    expect(plan.kept).toEqual(["杜少卿"]);
    expect(plan.dropped).toEqual(["王太", "玄武湖"]);
    expect(plan.added).toEqual(["元武湖"]);
  });

  it("🚨 前缀隐患**不自动删**（提案不是决策）", () => {
    const plan = planPackEntries(["王太", "杜少卿"], report);
    expect(plan.kept).toContain("王太");
  });

  it("🚨 死条目**自动删**（行为中性：分词器从没见过它）", () => {
    const plan = planPackEntries(["杜少卿", "玄武湖"], report);
    expect(plan.kept).toEqual(["杜少卿"]);
    expect(plan.dropped).toEqual(["玄武湖"]);
  });

  it("替换写法已在表里 → 不重复补", () => {
    const plan = planPackEntries(["玄武湖", "元武湖"], report, { variants: { 玄武湖: "元武湖" } });
    expect(plan.added).toEqual([]);
  });

  it("撤下表里没有的条目不受影响", () => {
    const plan = planPackEntries(["杜少卿"], report, { withdrawals: ["不存在的人"] });
    expect(plan.kept).toEqual(["杜少卿"]);
    expect(plan.dropped).toEqual([]);
  });
});
