import { describe, expect, it } from "vitest";

import {
  CURATION_HEADING_TASK,
  CURATION_SYSTEM_PROMPT,
  DEFAULT_CURATION_BATCH_SIZE,
  applyCuration,
  emptyWorkPack,
  estimateCurationCost,
  failedCurationOutcome,
  mergeCurationOutcomes,
  parseCurationResponse,
  planCurationBatches,
  type CurationResult
} from "./curation";
import type { NgramCandidate } from "./discovery";
import type { WorkPack } from "./types";

/**
 * `curation.ts`（N12 tier ③ 的 LLM 半边，纯函数骨架）单测。
 *
 * ## 为什么这里没有「LLM 行为」的测试
 *
 * 本模块**故意**不碰网络：它只负责「怎么问」与「拿到答案后怎么验」。
 * 所以这里的输入是**手工构造的、有真实感的模型返回文本** —— 包括
 * 那些真实运行里一定会出现、但很难复现的坏形状（代码围栏、幻觉名字、
 * 放错桶、type 缺失）。这比「打一次真接口看运气」更能钉住行为，
 * 而且是 **$0、可重复**的。
 *
 * ⚠️ 这些用例**不能**证明「模型会答对」—— 那要等一次付费运行。
 * 它们证明的是**「模型答错时，我们会不会静默地用错」**。
 */

/** 造一个候选（统计量取值与断言无关，给个合法值即可）。 */
function candidate(gram: string, frequency = 10): NgramCandidate {
  return { gram, frequency, cohesion: 12, freedom: 1.5 };
}

/** 造一个基础作品包。 */
function basePack(entries: readonly (readonly [string, number])[] = []): WorkPack {
  return { id: "test-work", label: "《测试书》", properNouns: entries, properNounFrequency: 100_000 };
}

/** 一份有真实感的候选清单（含会被拒的联绵词与泛称）。 */
const CANDIDATES: readonly NgramCandidate[] = [
  candidate("范进", 120),
  candidate("周进", 98),
  candidate("杜少卿", 76),
  candidate("严监生", 55),
  candidate("怂恿", 40),
  candidate("如今", 300)
];

describe("planCurationBatches", () => {
  it("候选为空时返回空数组（不产生一次空调用）", () => {
    expect(planCurationBatches([])).toHaveLength(0);
  });

  it("按 batchSize 切分，最后一批可以不满", () => {
    // 5 条 / 每批 2 → 2 + 2 + 1（**故意取奇数**，否则「最后一批可以不满」根本没被验到）
    const odd = CANDIDATES.slice(0, 5);
    const batches = planCurationBatches(odd, 2);
    expect(batches).toHaveLength(3);
    expect(batches.map((batch) => batch.candidates.length)).toEqual([2, 2, 1]);
  });

  it("批号从 0 起、总批数正确", () => {
    const batches = planCurationBatches(CANDIDATES, 4);
    expect(batches.map((batch) => batch.index)).toEqual([0, 1]);
    expect(batches.every((batch) => batch.total === 2)).toBe(true);
  });

  it("batchSize 非正整数时抛错（不静默兜底，否则成本估算失真）", () => {
    expect(() => planCurationBatches(CANDIDATES, 0)).toThrow();
    expect(() => planCurationBatches(CANDIDATES, -1)).toThrow();
    expect(() => planCurationBatches(CANDIDATES, 2.5)).toThrow();
  });

  it("用户提示词逐条列出本批候选与频次", () => {
    const [first] = planCurationBatches(CANDIDATES, 3);
    expect(first).toBeDefined();
    expect(first?.user).toContain("范进(120)");
    expect(first?.user).toContain("周进(98)");
    expect(first?.user).toContain("杜少卿(76)");
    // 第二批的候选不得出现在第一批里
    expect(first?.user).not.toContain("如今(300)");
  });

  it("渲染口径是 `写法(次数)`（与 pipeline 的 renderCandidateDictionary 一致）", () => {
    const [first] = planCurationBatches([candidate("蘧公孙", 7)], 10);
    expect(first?.user).toContain("蘧公孙(7)");
  });

  it("系统提示词是常量，且明确要求两件事分开回答", () => {
    const batches = planCurationBatches(CANDIDATES, 3);
    expect(batches[0]?.system).toBe(CURATION_SYSTEM_PROMPT);
    expect(batches[1]?.system).toBe(CURATION_SYSTEM_PROMPT);
    expect(CURATION_SYSTEM_PROMPT).toContain("verdicts");
    expect(CURATION_SYSTEM_PROMPT).toContain("supplied");
    expect(CURATION_SYSTEM_PROMPT).toContain("宁可少补，不可编造");
  });

  it("默认批大小是导出的常量（调用方不必知道具体数）", () => {
    const batches = planCurationBatches([candidate("甲"), candidate("乙")]);
    expect(batches[0]?.candidates.length).toBeLessThanOrEqual(DEFAULT_CURATION_BATCH_SIZE);
  });
});

describe("parseCurationResponse", () => {
  it("合法 JSON → 正确分入两个桶", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({
        verdicts: [
          { name: "范进", accepted: true, type: "PERSON" },
          { name: "如今", accepted: false }
        ],
        supplied: [{ name: "虞育德", type: "PERSON" }]
      }),
      CANDIDATES
    );
    expect(outcome.errorKind).toBeNull();
    expect(outcome.result?.accepted).toEqual([{ name: "范进", type: "PERSON" }]);
    expect(outcome.result?.supplied).toEqual([{ name: "虞育德", type: "PERSON" }]);
  });

  it("带 Markdown 代码围栏 → 标记 repaired 但仍解析成功", () => {
    const outcome = parseCurationResponse(
      '```json\n{"verdicts":[{"name":"范进","accepted":true,"type":"PERSON"}]}\n```',
      CANDIDATES
    );
    expect(outcome.repaired).toBe(true);
    expect(outcome.result?.accepted).toHaveLength(1);
  });

  it("非 JSON → not_json，且 result 为 null（不抛异常）", () => {
    const outcome = parseCurationResponse("我不知道该怎么回答。", CANDIDATES);
    expect(outcome.errorKind).toBe("not_json");
    expect(outcome.result).toBeNull();
  });

  it("JSON 合法但形状不对 → schema_invalid", () => {
    const outcome = parseCurationResponse("[1,2,3]", CANDIDATES);
    expect(outcome.errorKind).toBe("schema_invalid");
    expect(outcome.result).toBeNull();
  });

  it("🚨 幻觉护栏：候选表里没有的名字被丢弃并计数", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({
        verdicts: [
          { name: "范进", accepted: true, type: "PERSON" },
          { name: "王冕", accepted: true, type: "PERSON" }
        ]
      }),
      CANDIDATES
    );
    expect(outcome.result?.accepted).toEqual([{ name: "范进", type: "PERSON" }]);
    expect(outcome.diagnostics.unknownVerdicts).toEqual(["王冕"]);
  });

  it("accepted=false 的判定不进 accepted", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({
        verdicts: [
          { name: "怂恿", accepted: false },
          { name: "如今", accepted: false }
        ]
      }),
      CANDIDATES
    );
    expect(outcome.result?.accepted).toEqual([]);
    expect(outcome.diagnostics.unknownVerdicts).toEqual([]);
  });

  it("type 缺失 → 按 PERSON 兜底，并计入 invalidTypes（看得见，不静默）", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "范进", accepted: true }] }),
      CANDIDATES
    );
    expect(outcome.result?.accepted).toEqual([{ name: "范进", type: "PERSON" }]);
    expect(outcome.diagnostics.invalidTypes).toEqual(["范进"]);
  });

  it("type 非法 → PERSON 兜底并计入 invalidTypes", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "范进", accepted: true, type: "ANIMAL" }] }),
      CANDIDATES
    );
    expect(outcome.result?.accepted[0]?.type).toBe("PERSON");
    expect(outcome.diagnostics.invalidTypes).toEqual(["范进"]);
  });

  it("type 大小写不敏感（location → LOCATION）", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "杜少卿", accepted: true, type: "location" }] }),
      CANDIDATES
    );
    expect(outcome.result?.accepted[0]?.type).toBe("LOCATION");
    expect(outcome.diagnostics.invalidTypes).toEqual([]);
  });

  it("同一批内重复的 accepted 被去重", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({
        verdicts: [
          { name: "范进", accepted: true, type: "PERSON" },
          { name: "范进", accepted: true, type: "PERSON" }
        ]
      }),
      CANDIDATES
    );
    expect(outcome.result?.accepted).toHaveLength(1);
  });

  it("supplied 里的名字其实在候选表 → 放错桶，丢弃并计数", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({ supplied: [{ name: "范进", type: "PERSON" }] }),
      CANDIDATES
    );
    expect(outcome.result?.supplied).toEqual([]);
    expect(outcome.diagnostics.misplacedSupplied).toEqual(["范进"]);
  });

  it("supplied 内部重复 → 去重并计数", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({ supplied: [{ name: "虞育德", type: "PERSON" }, { name: "虞育德", type: "PERSON" }] }),
      CANDIDATES
    );
    expect(outcome.result?.supplied).toHaveLength(1);
    expect(outcome.diagnostics.duplicateSupplied).toEqual(["虞育德"]);
  });

  it("空对象 → 两个桶都空，且不算错误（模型可能只答一半）", () => {
    const outcome = parseCurationResponse("{}", CANDIDATES);
    expect(outcome.errorKind).toBeNull();
    expect(outcome.result).toEqual({ accepted: [], supplied: [] });
  });

  it("名字带空白 → 归一化后仍能命中候选表", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: " 范进 ", accepted: true, type: "PERSON" }] }),
      CANDIDATES
    );
    expect(outcome.result?.accepted).toEqual([{ name: "范进", type: "PERSON" }]);
    expect(outcome.diagnostics.unknownVerdicts).toEqual([]);
  });

  it("JSON 前后有解释文字 → 截取首尾花括号后仍解析（标记 repaired）", () => {
    const outcome = parseCurationResponse(
      '好的，结果如下：{"verdicts":[{"name":"范进","accepted":true,"type":"PERSON"}]} 以上。',
      CANDIDATES
    );
    expect(outcome.repaired).toBe(true);
    expect(outcome.result?.accepted).toHaveLength(1);
  });
});

describe("mergeCurationOutcomes", () => {
  it("跨批去重（同一名字出现在两批候选里只留一条）", () => {
    const first = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "范进", accepted: true, type: "PERSON" }] }),
      CANDIDATES
    );
    const second = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "范进", accepted: true, type: "PERSON" }] }),
      CANDIDATES
    );
    const merged = mergeCurationOutcomes([first, second]);
    expect(merged.result.accepted).toHaveLength(1);
  });

  it("失败的批号被显式记录（空数组才代表全成功）", () => {
    const good = parseCurationResponse(JSON.stringify({ verdicts: [] }), CANDIDATES);
    const bad = parseCurationResponse("不是 JSON", CANDIDATES);
    const merged = mergeCurationOutcomes([good, bad], [1]);
    expect(merged.failedBatches).toEqual([1]);
    expect(merged.result.accepted).toEqual([]);
  });

  it("各批诊断被合并", () => {
    const first = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "王冕", accepted: true }] }),
      CANDIDATES
    );
    const second = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "倪霜峰", accepted: true }] }),
      CANDIDATES
    );
    const merged = mergeCurationOutcomes([first, second]);
    expect(merged.diagnostics.unknownVerdicts).toEqual(["王冕", "倪霜峰"]);
  });

  it("跨批时 supplied 与 accepted 冲突 → 计入 duplicateSupplied", () => {
    const first = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "范进", accepted: true, type: "PERSON" }] }),
      CANDIDATES
    );
    const second = parseCurationResponse(
      JSON.stringify({ supplied: [{ name: "范进", type: "PERSON" }] }),
      []
    );
    const merged = mergeCurationOutcomes([first, second]);
    expect(merged.result.accepted).toHaveLength(1);
    expect(merged.result.supplied).toHaveLength(0);
    expect(merged.diagnostics.duplicateSupplied).toEqual(["范进"]);
  });

  it("🚨 失败路径与成功路径的诊断**同形**（给诊断加字段时不会漏掉失败路径）", () => {
    // 批 37 实测：失败路径原先**手抄**了一份诊断字面量，加 `headingVerdicts` 时它漏了。
    // 抽成 `failedCurationOutcome()` 后，这条断言把「同形」钉死。
    const failed = failedCurationOutcome();
    const succeeded = parseCurationResponse("{}", []);
    expect(failed.errorKind).toBe("not_json");
    expect(failed.result).toBeNull();
    expect(Object.keys(failed.diagnostics).sort()).toEqual(Object.keys(succeeded.diagnostics).sort());
  });
});

describe("applyCuration", () => {
  const result: CurationResult = {
    accepted: [
      { name: "范进", type: "PERSON" },
      { name: "高要县", type: "LOCATION" }
    ],
    supplied: [{ name: "虞育德", type: "PERSON" }]
  };

  it("追加 accepted，且原条目顺序不变", () => {
    const applied = applyCuration(basePack([["周进", 128]]), result);
    expect(applied.pack.properNouns).toEqual([
      ["周进", 128],
      ["范进", 128],
      ["高要县", 64]
    ]);
    expect(applied.summary.addedAccepted).toEqual(["范进", "高要县"]);
  });

  it("默认**不写** supplied（未经验证，必须显式打开）", () => {
    const applied = applyCuration(basePack(), result);
    expect(applied.summary.addedSupplied).toEqual([]);
    expect(applied.pack.properNouns).toHaveLength(2);
  });

  it("includeSupplied=true 时才写入 supplied", () => {
    const applied = applyCuration(basePack(), result, { includeSupplied: true });
    expect(applied.summary.addedSupplied).toEqual(["虞育德"]);
    expect(applied.pack.properNouns).toHaveLength(3);
  });

  it("词性码：PERSON → 128，非 PERSON → 64", () => {
    const applied = applyCuration(basePack(), result);
    const byName = new Map(applied.pack.properNouns);
    expect(byName.get("范进")).toBe(128);
    expect(byName.get("高要县")).toBe(64);
  });

  it("与既有条目重复 → 跳过并记录（不产生重复行）", () => {
    const applied = applyCuration(basePack([["范进", 128]]), result);
    expect(applied.summary.skippedExisting).toEqual(["范进"]);
    expect(applied.pack.properNouns.filter(([surface]) => surface === "范进")).toHaveLength(1);
  });

  it("不修改入参（返回新对象）", () => {
    const base = basePack([["周进", 128]]);
    applyCuration(base, result);
    expect(base.properNouns).toHaveLength(1);
  });

  it("保留 base 的 id / label / 词频", () => {
    const applied = applyCuration(basePack(), result);
    expect(applied.pack.id).toBe("test-work");
    expect(applied.pack.label).toBe("《测试书》");
    expect(applied.pack.properNounFrequency).toBe(100_000);
  });

  it("emptyWorkPack 产出零专名的合法包", () => {
    const empty = emptyWorkPack("new-book", "《新书》", 100_000);
    expect(empty.properNouns).toEqual([]);
    const applied = applyCuration(empty, result);
    expect(applied.summary.totalEntries).toBe(2);
  });
});

describe("estimateCurationCost", () => {
  it("调用次数 = ⌈候选数 / 批大小⌉", () => {
    expect(estimateCurationCost(0, 150).calls).toBe(0);
    expect(estimateCurationCost(1, 150).calls).toBe(1);
    expect(estimateCurationCost(150, 150).calls).toBe(1);
    expect(estimateCurationCost(151, 150).calls).toBe(2);
    expect(estimateCurationCost(12_900, 150).calls).toBe(86);
  });

  it("估算量级随候选数单调增长（用途是给出可比刻度，不是账单预测）", () => {
    const small = estimateCurationCost(300, 150);
    const large = estimateCurationCost(12_900, 150);
    expect(large.calls).toBeGreaterThan(small.calls);
    expect(large.approxOutputTokens).toBeGreaterThan(small.approxOutputTokens);
  });
});

/**
 * 批 37：**可选的【回目】输入块**（A 臂）。
 *
 * 为什么要单开一段：这条通道的**唯一**价值在于「名字逐字出现在给定文本里 → 可证伪」。
 * 所以测试要钉住的不是「有没有这个功能」，而是两条**方向性**不变量：
 * ① 不传回目时提示词**逐字节**退回旧行为（否则 A/B 对照不成立）；
 * ② 回目名字在**传/不传**两种情形下命运相反（这才是「这条通道在做事」的证据）。
 */
describe("planCurationBatches · 【回目】输入块（批 37）", () => {
  const HEADINGS: readonly string[] = [
    "第一回　说楔子敷陈大义　借名流隐括全文",
    "第二回　王孝廉村学识同科"
  ];

  it("不传回目 → 提示词**逐字节**与旧行为一致（A/B 对照的前提）", () => {
    const [first] = planCurationBatches(CANDIDATES, 3);
    expect(first?.system).toBe(CURATION_SYSTEM_PROMPT);
    expect(first?.user).not.toContain("【回目】");
    // 显式传空数组也必须一样：「这本书没有回目」不该意外改变提示词。
    const [empty] = planCurationBatches(CANDIDATES, 3, []);
    expect(empty?.system).toBe(first?.system);
    expect(empty?.user).toBe(first?.user);
  });

  it("传回目 → 系统提示词追加任务 C，用户提示词带上回目原文", () => {
    const [first] = planCurationBatches(CANDIDATES, 3, HEADINGS);
    expect(first?.system).toContain(CURATION_HEADING_TASK);
    expect(first?.system).toContain("任务 C");
    expect(first?.system).not.toBe(CURATION_SYSTEM_PROMPT);
    expect(first?.user).toContain("【回目】");
    // 逐字保留原文 —— 这正是「可核对」的来源。
    for (const heading of HEADINGS) {
      expect(first?.user).toContain(heading);
    }
  });

  it("⚠️ 回目块**每批都有**（不是只放第一批）", () => {
    const batches = planCurationBatches(CANDIDATES, 2, HEADINGS);
    expect(batches).toHaveLength(3);
    expect(batches.every((batch) => batch.user.includes("【回目】"))).toBe(true);
    expect(batches.every((batch) => batch.system.includes("任务 C"))).toBe(true);
  });

  it("回目块不改候选本身（`candidates` 原样引用，顺序不变）", () => {
    const [first] = planCurationBatches(CANDIDATES, 3, HEADINGS);
    expect(first?.candidates.map((entry) => entry.gram)).toEqual(CANDIDATES.slice(0, 3).map((e) => e.gram));
  });
});

describe("parseCurationResponse · 回目护栏（批 37）", () => {
  const HEADINGS: readonly string[] = [
    "第一回　说楔子敷陈大义　借名流隐括全文",
    "第二回　王孝廉村学识同科"
  ];

  it("🚨 传了回目 → 回目里的名字**可收**（逐字在给定文本里 = 可证伪，所以算 accepted）", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "王孝廉", accepted: true, type: "PERSON" }] }),
      CANDIDATES,
      HEADINGS
    );
    expect(outcome.result?.accepted).toEqual([{ name: "王孝廉", type: "PERSON" }]);
    expect(outcome.diagnostics.headingVerdicts).toEqual(["王孝廉"]);
    expect(outcome.diagnostics.unknownVerdicts).toEqual([]);
  });

  it("🚨 回归反证：**不传**回目时，同一个名字被当幻觉丢弃（证明这条通道真的在做事）", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "王孝廉", accepted: true, type: "PERSON" }] }),
      CANDIDATES
    );
    expect(outcome.result?.accepted).toEqual([]);
    expect(outcome.diagnostics.unknownVerdicts).toEqual(["王孝廉"]);
    expect(outcome.diagnostics.headingVerdicts).toEqual([]);
  });

  it("回目护栏**不是**「什么都能过」：回目里没有的名字照样被丢", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({
        verdicts: [
          { name: "王孝廉", accepted: true, type: "PERSON" },
          { name: "史太君", accepted: true, type: "PERSON" }
        ]
      }),
      CANDIDATES,
      HEADINGS
    );
    expect(outcome.result?.accepted.map((entry) => entry.name)).toEqual(["王孝廉"]);
    expect(outcome.diagnostics.unknownVerdicts).toEqual(["史太君"]);
  });

  it("回目来源只记**回目来源**；正文候选来源不记（极性用例）", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "范进", accepted: true, type: "PERSON" }] }),
      CANDIDATES,
      HEADINGS
    );
    expect(outcome.result?.accepted).toEqual([{ name: "范进", type: "PERSON" }]);
    expect(outcome.diagnostics.headingVerdicts).toEqual([]);
  });

  it("回目名字若走 supplied → 判「放错桶」（它本来就该走 verdicts）", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({ supplied: [{ name: "王孝廉", type: "PERSON" }] }),
      CANDIDATES,
      HEADINGS
    );
    expect(outcome.result?.supplied).toEqual([]);
    expect(outcome.diagnostics.misplacedSupplied).toEqual(["王孝廉"]);
  });

  it("accepted=false 的回目名字不进任何桶（护栏宽了，但否决权还在）", () => {
    const outcome = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "王孝廉", accepted: false }] }),
      CANDIDATES,
      HEADINGS
    );
    expect(outcome.result?.accepted).toEqual([]);
    expect(outcome.diagnostics.headingVerdicts).toEqual([]);
    expect(outcome.diagnostics.unknownVerdicts).toEqual([]);
  });

  it("跨批合并会把各批的回目来源并起来", () => {
    const first = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "王孝廉", accepted: true, type: "PERSON" }] }),
      CANDIDATES,
      HEADINGS
    );
    const merged = mergeCurationOutcomes([first]);
    expect(merged.diagnostics.headingVerdicts).toEqual(["王孝廉"]);
  });

  it("🚨 归因口径：在**全书正文候选**里、只是不在本批 150 条里 → **不算**回目来源", () => {
    const raw = JSON.stringify({ verdicts: [{ name: "王孝廉", accepted: true, type: "PERSON" }] });

    // ⚠️ 不给 `bodyUniverse` → 退化为「本批候选」口径 → **误算成回目独有**。
    //    这正是批 37 付费跑实测到的高估（读数 138 条），把它钉在这里当**反向自证**。
    const wrongCalibre = parseCurationResponse(raw, CANDIDATES, HEADINGS);
    expect(wrongCalibre.diagnostics.headingVerdicts).toEqual(["王孝廉"]);

    // 给了全书正文候选 → 正确归因为**正文来源**（收下，但不计回目账）
    const rightCalibre = parseCurationResponse(raw, CANDIDATES, HEADINGS, [candidate("王孝廉", 7)]);
    expect(rightCalibre.result?.accepted).toEqual([{ name: "王孝廉", type: "PERSON" }]);
    expect(rightCalibre.diagnostics.headingVerdicts).toEqual([]);
  });

  it("⚠️ `bodyUniverse` **只影响归因、不影响护栏**：不在本批、也不在回目的名字仍被丢", () => {
    // 这是**刻意的**两个集合（护栏 = 本批候选 ∪ 回目候选；归因 = 全书正文候选）。
    // 本批「不扩护栏」是为了与批 33 的读数可比 —— 见 §3.47 的「新发现」。
    const outcome = parseCurationResponse(
      JSON.stringify({ verdicts: [{ name: "娄焕文", accepted: true, type: "PERSON" }] }),
      CANDIDATES,
      HEADINGS,
      [candidate("娄焕文", 12)]
    );
    expect(outcome.result?.accepted).toEqual([]);
    expect(outcome.diagnostics.unknownVerdicts).toEqual(["娄焕文"]);
  });
});

describe("estimateCurationCost · 回目块（批 37）", () => {
  it("⚠️ 回目块的 token 必须**乘调用次数**（每批都发），否则低估一个数量级", () => {
    const withoutHeadings = estimateCurationCost(300, 150, 0);
    const withHeadings = estimateCurationCost(300, 150, 1180);
    // 调用次数不受回目影响（回目不切批）
    expect(withHeadings.calls).toBe(withoutHeadings.calls);
    // 差额必须是「调用次数 × 每批回目 token」，不是只加一次
    const perCall = Math.ceil(1180 * 1.3);
    expect(withHeadings.approxInputTokens - withoutHeadings.approxInputTokens).toBe(
      withoutHeadings.calls * perCall
    );
  });

  it("不传回目字数 → 与旧行为一致（默认参数不改读数）", () => {
    expect(estimateCurationCost(300, 150).approxInputTokens).toBe(
      estimateCurationCost(300, 150, 0).approxInputTokens
    );
  });
});
