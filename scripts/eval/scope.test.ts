import { describe, expect, it } from "vitest";

import type { GoldSet } from "./goldset-schema";
import { evaluateAll } from "./metrics";
import {
  describeChapterRange,
  isPrecisionReadable,
  renderAnnotationNotes,
  runEval,
  scopeGraph,
  type EvalGraph,
  type LoadedGraph
} from "./scope";

/** 构造图谱。 */
function graph(
  entities: string[],
  relations: readonly [string, string, string, number?][]
): EvalGraph {
  return {
    entities : entities.map((canonical) => ({ canonical, aliases: [] })),
    relations: relations.map(([typeCode, source, target, startChapter]) => ({
      typeCode,
      sourceCanonical: source,
      targetCanonical: target,
      ...(startChapter === undefined ? {} : { startChapter })
    }))
  };
}

describe("scopeGraph —— 章节区间切片", () => {
  it("只保留区间内的实体", () => {
    const full = graph(["王冕", "秦老", "范进", "严监生"], []);
    const scoped = scopeGraph(full, new Set(["王冕", "秦老"]));

    expect(scoped.entities.map((entity) => entity.canonical)).toEqual(["王冕", "秦老"]);
  });

  it("关系要求**两端都在**区间内（任一端在外即丢弃）", () => {
    const full = graph(
      ["王冕", "秦老", "范进"],
      [
        ["朋友", "秦老", "王冕", 1],
        ["师生", "周进", "范进", 1],
        ["师生", "范进", "周进", 1]
      ]
    );
    const scoped = scopeGraph(full, new Set(["王冕", "秦老", "范进"]), 3);

    // 后两条都必须被丢弃。⚠️ 第二条只覆盖「**源**在外」，第三条才覆盖「**目标**在外」——
    // 只写第二条时，「关系只校验 source 端」这个变异**杀不掉**（变异测试实测确认过）。
    expect(scoped.relations).toEqual([
      { typeCode: "朋友", sourceCanonical: "秦老", targetCanonical: "王冕", startChapter: 1 }
    ]);
  });

  it("`startChapter` 超出金标上界的关系被丢弃（第 10 回的边不算第 1–3 回的输出）", () => {
    const full = graph(
      ["王冕", "秦老"],
      [
        ["朋友", "秦老", "王冕", 1],
        ["朋友", "秦老", "王冕", 10]
      ]
    );
    const scoped = scopeGraph(full, new Set(["王冕", "秦老"]), 3);

    expect(scoped.relations).toHaveLength(1);
    expect(scoped.relations[0]?.startChapter).toBe(1);
  });

  it("不传章节上界时不做章节过滤（向后兼容）", () => {
    const full = graph(["王冕", "秦老"], [["朋友", "秦老", "王冕", 10]]);

    expect(scopeGraph(full, new Set(["王冕", "秦老"])).relations).toHaveLength(1);
  });

  it("缺 `startChapter` 的关系不参与章节过滤（不因缺字段被误杀）", () => {
    const full = graph(["王冕", "秦老"], [["朋友", "秦老", "王冕"]]);

    expect(scopeGraph(full, new Set(["王冕", "秦老"]), 3).relations).toHaveLength(1);
  });

  it("名字按 `normalizeName` 比对（空白差异不影响切片）", () => {
    const full = graph(["王 冕"], []);
    const scoped = scopeGraph(full, new Set(["王冕"]));

    expect(scoped.entities).toHaveLength(1);
  });

  it("区间为空时切片为空（不得退回全量）", () => {
    const full = graph(["王冕", "秦老"], [["朋友", "秦老", "王冕", 1]]);
    const scoped = scopeGraph(full, new Set<string>());

    expect(scoped.entities).toEqual([]);
    expect(scoped.relations).toEqual([]);
  });
});

describe("isPrecisionReadable —— 精确率何时不可读", () => {
  it("金标远小于切片 → 不可读（当前样例金标就属于这种情况）", () => {
    // 实测：第 1–3 回切片 81 个实体，样例金标只列了 11 个 → 精确率被漏标主导
    expect(isPrecisionReadable(11, 81)).toBe(false);
  });

  it("金标覆盖切片一半以上 → 可读", () => {
    expect(isPrecisionReadable(60, 100)).toBe(true);
    expect(isPrecisionReadable(50, 100)).toBe(true);
  });
});

describe("runEval —— 切片是否真的接上了（接线回归护栏）", () => {
  const gold: GoldSet = {
    workTitle      : "儒林外史",
    chapterRange   : [1, 3],
    annotationNotes: [],
    entities       : [
      { canonical: "王冕", type: "PERSON", nameType: "NAMED", aliases: [] },
      { canonical: "秦老", type: "PERSON", nameType: "NAMED", aliases: [] }
    ],
    relations: [{ typeCode: "朋友", sourceCanonical: "秦老", targetCanonical: "王冕" }]
  };

  it("区间外实体不计入 FP；**若有人去掉这一步，本用例立刻变红**", () => {
    // 这条断言守的是「接线」而不是「算法」：`scopeGraph` 本身有独立用例，
    // 但若有人在 `runEval` 里不再调用它，只有本用例能发现 ——
    // 而那个回归正是本模块要修的 bug（精确率 0.85%）。
    const full = graph(
      ["王冕", "秦老", "范进", "严监生", "匡超人"],
      [["朋友", "秦老", "王冕", 1]]
    );
    const loaded: LoadedGraph = {
      workId           : "w",
      inScopeCanonicals: new Set(["王冕", "秦老"]),
      graph            : full
    };

    const { report, slice } = runEval(gold, loaded);

    expect(slice.entities).toBe(2);
    expect(slice.relations).toBe(1);
    expect(report.entity.tp).toBe(2);
    expect(report.entity.fp).toBe(0);
    expect(report.entity.precision).toBe(1);

    // 对照：不做切片直接比，区间外那 3 个实体全会变成 FP —— 这就是初版的成因。
    const raw = evaluateAll({ entities: gold.entities, relations: gold.relations }, full);
    expect(raw.entity.fp).toBe(3);
  });
});

describe("describeChapterRange —— 金标区间的单位是否对得上", () => {
  /** 《儒林外史》的真实形态：前置内容 + 56 回。 */
  const realChapters = [
    { ordinal: 0, title: "前言" },
    { ordinal: 1, title: "第一回　说楔子敷陈大义　借名流隐括全文" },
    { ordinal: 2, title: "第二回　王孝廉村学识同科　周蒙师暮年登上第" },
    { ordinal: 3, title: "第三回　周学道校士拔真才　胡屠户行凶闹捷报" },
    { ordinal: 4, title: "第四回　荐亡斋和尚契官司　打秋风乡绅遭横事" }
  ];

  it("[1,3] 解析为第 1–3 回，**不含**前置内容", () => {
    const summary = describeChapterRange(realChapters, 1, 3);

    expect(summary.chapters.map((chapter) => chapter.ordinal)).toEqual([1, 2, 3]);
    expect(summary.chapters[0]?.title).toContain("第一回");
    expect(summary.chapters[2]?.title).toContain("第三回");
    // 前置内容必须落在区间外 —— 否则第 1–3 回会实际变成「前言 + 第一回 + 第二回」。
    expect(summary.chapters.map((chapter) => chapter.title)).not.toContain("前言");
    expect(summary.unnumbered).toEqual([]);
  });

  it("**回归护栏**：区间内混入前置内容时点名报出（旧数据形态：前言占了 ordinal 1）", () => {
    // 这正是修复前的库内形态 —— 前置内容占 1，于是 [1,3] 取到的是它而不是第三回。
    const brokenChapters = [
      { ordinal: 1, title: "前言" },
      { ordinal: 2, title: "第一回　说楔子敷陈大义　借名流隐括全文" },
      { ordinal: 3, title: "第二回　王孝廉村学识同科　周蒙师暮年登上第" }
    ];
    const summary = describeChapterRange(brokenChapters, 1, 3);

    expect(summary.unnumbered.map((chapter) => chapter.title)).toEqual(["前言"]);
    // 且区间里**根本没有第三回** —— 这才是「整章漏掉范进中举」的直接证据。
    expect(summary.chapters.map((chapter) => chapter.title).some((t) => t.includes("第三回"))).toBe(
      false
    );
  });

  it("区间越界（该作品没有这些回）时返回空列表，而不是静默给全量", () => {
    const summary = describeChapterRange(realChapters, 90, 95);

    expect(summary.chapters).toEqual([]);
    expect(summary.unnumbered).toEqual([]);
  });

  it("按 ordinal 升序返回，与传入顺序无关", () => {
    const shuffled = [
      { ordinal: 3, title: "第三回　周学道校士拔真才" },
      { ordinal: 1, title: "第一回　说楔子敷陈大义" },
      { ordinal: 2, title: "第二回　王孝廉村学识同科" }
    ];

    expect(describeChapterRange(shuffled, 1, 3).chapters.map((c) => c.ordinal)).toEqual([1, 2, 3]);
  });

  it("整本塌成单章（无标题标记）时会被点名 —— 区间没落在编号章节上", () => {
    const summary = describeChapterRange([{ ordinal: 1, title: "正文" }], 1, 1);

    expect(summary.unnumbered.map((chapter) => chapter.title)).toEqual(["正文"]);
  });
});

describe("renderAnnotationNotes —— 金标说明必须被打出来（而不是躺在 JSON 里）", () => {
  it("逐条编号渲染，并显式标注「不参与指标计算」", () => {
    const lines = renderAnnotationNotes(["第一条：已删除 `诸暨村`（原文 0 次）", "第二条：已更正 `同僚` → `师生`"]);

    expect(lines[0]).toBe("");
    expect(lines[1]).toContain("不参与指标计算");
    expect(lines[1]).toContain("2 条");
    expect(lines[2]).toContain("1. 第一条");
    expect(lines[3]).toContain("2. 第二条");
  });

  it("**护栏**：没有说明时返回空数组（不得凭空造出一行标题）", () => {
    expect(renderAnnotationNotes([])).toEqual([]);
    // 只有空白的条目同样视为「没有说明」—— 否则会出现「金标标注说明（1 条）」下面什么都没有。
    expect(renderAnnotationNotes(["", "   ", "\n"])).toEqual([]);
  });

  it("逐条断言而非整段比对：条目数变化时失败信息指向具体条目", () => {
    const lines = renderAnnotationNotes(["A", "B", "C"]);

    expect(lines).toHaveLength(5); // 空行 + 标题 + 3 条
    expect(lines[4]).toBe("  3. C");
  });
});
