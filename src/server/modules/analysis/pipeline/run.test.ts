// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { ExtractedRelation } from "../schemas";

import type { CandidateName } from "./dictionary";

/**
 * 编排层回归测试。
 *
 * 背景：本文件中的三个函数是从 `run.ts` 抽出的**纯逻辑**，
 * 之所以单独测试，是因为它们的缺陷正是「单元测试全绿但管线错」的典型：
 * - `groupRelationsBySlice` 修的是「投票被压成一片 → votes 恒为 1」；
 * - `advanceRollingContext` 承接「跨片写法一致性」；
 * - `selectSliceAnchors` 承接「锚点 Top-N 而非全量」的降本约束。
 *
 * 这些函数若被改错，`vote.ts` / `prompts.ts` 的单测**依然会全绿**，
 * 因此必须有本层测试兜住接线。
 */

// `run.ts` 顶部 `import "server-only"` 在非 RSC 环境会抛错，与 integration.test.ts 同一处理。
vi.mock("server-only", () => ({}));

const { advanceRollingContext, groupRelationsBySlice, selectAnalyzableChapters, selectSliceAnchors } =
  await import("./run");

/** 构造一条携带分片信息的 grounded 关系。 */
function locatedRelation(
  sliceIndex: number,
  chapterOrdinal: number,
  source: string,
  target: string,
  typeCode = "朋友"
): ExtractedRelation & { chapterOrdinal: number; sliceIndex: number } {
  return {
    typeCode,
    sourceCanonical: source,
    targetCanonical: target,
    quote          : `关于${source}与${target}的引文`,
    chapterOrdinal,
    sliceIndex
  };
}

/** 构造一个候选名。 */
function candidate(surface: string, frequency: number, firstChapter = 1): CandidateName {
  return { surface, normalized: surface.toLowerCase(), frequency, firstChapter };
}

describe("groupRelationsBySlice（P4 投票接线的关键修复）", () => {
  it("把关系按来源分片还原成多个投票单元，而不是压成一片", () => {
    const slices = groupRelationsBySlice(
      [
        locatedRelation(0, 1, "甲", "乙"),
        locatedRelation(1, 1, "甲", "乙")
      ],
      [0, 1]
    );

    // 修复前：run.ts 传单元素数组，两个分片合并观察不到 → votes 恒为 1。
    // 修复后：两个单元，voteRelations 能正确计票为 2。
    expect(slices).toHaveLength(2);
    expect(slices[0]?.relations).toHaveLength(1);
    expect(slices[1]?.relations).toHaveLength(1);
  });

  it("为空分片保留空单元，保证分片序号与全书记录对齐", () => {
    const slices = groupRelationsBySlice([locatedRelation(2, 1, "甲", "乙")], [0, 1, 2]);

    expect(slices).toHaveLength(3);
    expect(slices[0]?.relations).toEqual([]);
    expect(slices[1]?.relations).toEqual([]);
    expect(slices[2]?.relations).toHaveLength(1);
  });

  it("输出单元按分片序号升序，与输入顺序无关", () => {
    const slices = groupRelationsBySlice(
      [locatedRelation(2, 3, "丙", "丁"), locatedRelation(0, 1, "甲", "乙")],
      [0, 1, 2]
    );

    expect(slices.map((slice) => slice.relations.length)).toEqual([1, 0, 1]);
  });

  it("剥离分片元信息，不把 chapterOrdinal / sliceIndex 泄漏进关系", () => {
    const slices = groupRelationsBySlice([locatedRelation(0, 1, "甲", "乙")], [0]);
    const relation = slices[0]?.relations[0];

    expect(relation).toBeDefined();
    expect(Object.keys(relation ?? {})).not.toContain("sliceIndex");
    expect(Object.keys(relation ?? {})).not.toContain("chapterOrdinal");
  });
});

describe("advanceRollingContext（P1 滚动上下文）", () => {
  it("首片无上下文时，用本片名字建立上下文", () => {
    const context = advanceRollingContext(undefined, ["范进", "周进"]);

    expect(context.priorNames).toEqual(["范进", "周进"]);
    expect(context.summary).toContain("范进");
  });

  it("累积前序名字，使上片人物在后续片仍可见", () => {
    const first = advanceRollingContext(undefined, ["范进"]);
    const second = advanceRollingContext(first, ["周进"]);

    expect(second.priorNames).toEqual(["范进", "周进"]);
  });

  it("名字去重，避免重复累积撑大提示词", () => {
    const first = advanceRollingContext(undefined, ["范进", "范进"]);
    const second = advanceRollingContext(first, ["范进"]);

    expect(second.priorNames).toEqual(["范进"]);
  });

  it("摘要被截断到上限，保证 user 消息体积可控", () => {
    const many = Array.from({ length: 200 }, (_, index) => `人物${String(index)}`);
    const context = advanceRollingContext(undefined, many);

    // MAX_ROLLING_SUMMARY_CHARS = 300
    expect(context.summary.length).toBeLessThanOrEqual(300);
    // MAX_ROLLING_NAMES = 40
    expect(context.priorNames.length).toBeLessThanOrEqual(40);
  });

  it("名字序列只保留最近的若干条（滑动窗口）", () => {
    const many = Array.from({ length: 100 }, (_, index) => `人物${String(index)}`);
    const context = advanceRollingContext(undefined, many);

    expect(context.priorNames).toHaveLength(40);
    // 保留的是末尾（最近）的名字。
    expect(context.priorNames.at(-1)).toBe("人物99");
  });
});

describe("selectSliceAnchors（锚点 Top-N 而非全量）", () => {
  const dictionary: CandidateName[] = [
    candidate("范进", 100),
    candidate("周进", 80),
    candidate("严监生", 60),
    candidate("王冕", 40),
    candidate("荀玫", 5)
  ];

  it("候选数不超过上限时原样返回", () => {
    const anchors = selectSliceAnchors(dictionary.slice(0, 3), "任意正文", 10);

    expect(anchors).toHaveLength(3);
  });

  it("优先选取在本片正文中字面出现的锚点", () => {
    const anchors = selectSliceAnchors(dictionary, "王冕正在放牛。", 2);

    expect(anchors.map((item) => item.surface)).toEqual(["王冕", "范进"]);
  });

  it("命中不足时用高频名补齐到上限", () => {
    const anchors = selectSliceAnchors(dictionary, "范进进学。", 3);

    expect(anchors).toHaveLength(3);
    // 首个是字面命中的「范进」，其余由频次降序补齐。
    expect(anchors[0]?.surface).toBe("范进");
    expect(anchors.map((item) => item.surface)).toEqual(["范进", "周进", "严监生"]);
  });

  it("结果确定性：同一输入恒定输出", () => {
    const first = selectSliceAnchors(dictionary, "范进与周进。", 3);
    const second = selectSliceAnchors(dictionary, "范进与周进。", 3);

    expect(first.map((item) => item.surface)).toEqual(second.map((item) => item.surface));
  });

  it("全量词典被压缩，避免逐片重复注入 200 条锚点", () => {
    const big = Array.from({ length: 200 }, (_, index) => candidate(`名${String(index)}`, 200 - index));
    const anchors = selectSliceAnchors(big, "名5在此。", 60);

    expect(anchors).toHaveLength(60);
  });
});

describe("P0 声明类型参与 P5 类型投票", () => {
  it("P0 声明优先于分片观测：全书维度判定不被局部误判覆盖", async () => {
    const { mergeEntities } = await import("./merge");

    // 分片提取把「某书院」标为 PERSON（局部误判），但 P0 全书维度判为 ORGANIZATION。
    // 修复前：pickType 只看分片观测 → PERSON；
    // 修复后：P0 有声明时以其为准 → ORGANIZATION。
    const merged = mergeEntities({
      entities     : [{ canonical: "某书院", type: "PERSON", aliases: [] }],
      nameFrequency: new Map([["某书院", 10]]),
      declaredTypes: new Map([["某书院", "ORGANIZATION"]])
    });

    expect(merged.entities[0]?.type).toBe("ORGANIZATION");
  });

  it("P0 无该键声明时退回分片观测的多数票", async () => {
    const { mergeEntities } = await import("./merge");

    const merged = mergeEntities({
      entities     : [{ canonical: "范进", type: "PERSON", aliases: [] }],
      nameFrequency: new Map([["范进", 10]]),
      declaredTypes: new Map([["周进", "PERSON"]])
    });

    expect(merged.entities[0]?.type).toBe("PERSON");
  });

  it("合并组内多个键的声明类型共同参与投票", async () => {
    const { mergeEntities } = await import("./merge");

    // 「京师」为规范名，「京城」是它的别名 → 两个键经 Union-Find 并入同一实体。
    // 声明类型对两个键各投一票，使 ORGANIZATION 方向的证据得以进入票池。
    const merged = mergeEntities({
      entities     : [{ canonical: "京师", type: "LOCATION", aliases: ["京城"] }],
      nameFrequency: new Map([
        ["京师", 20],
        ["京城", 5]
      ]),
      declaredTypes: new Map([
        ["京师", "LOCATION"],
        ["京城", "ORGANIZATION"]
      ])
    });

    expect(merged.entities).toHaveLength(1);
    // 票池：LOCATION ×2（分片 + P0 京师），ORGANIZATION ×1（P0 京城）→ LOCATION 胜出。
    expect(merged.entities[0]?.type).toBe("LOCATION");
  });

  it("缺省 declaredTypes 时行为与修复前一致（向后兼容）", async () => {
    const { mergeEntities } = await import("./merge");

    const merged = mergeEntities({
      entities     : [{ canonical: "范进", type: "PERSON", aliases: [] }],
      nameFrequency: new Map([["范进", 10]])
    });

    expect(merged.entities[0]?.type).toBe("PERSON");
  });

  it("多个声明类型时按票数决定", async () => {
    const { mergeEntities } = await import("./merge");

    const merged = mergeEntities({
      entities     : [{ canonical: "京师", type: "LOCATION", aliases: ["京城"] }],
      nameFrequency: new Map([
        ["京师", 20],
        ["京城", 5]
      ]),
      declaredTypes: new Map([
        ["京师", "LOCATION"],
        ["京城", "LOCATION"]
      ])
    });

    expect(merged.entities[0]?.type).toBe("LOCATION");
  });
});

describe("selectAnalyzableChapters —— 前置内容不参与解析", () => {
  it("丢掉前置内容（ordinal 0），保留全部真实章节", () => {
    const chapters = [
      { ordinal: 0, title: "前言" },
      { ordinal: 1, title: "第一回　说楔子敷陈大义" },
      { ordinal: 2, title: "第二回　王孝廉村学识同科" }
    ];

    expect(selectAnalyzableChapters(chapters).map((chapter) => chapter.ordinal)).toEqual([1, 2]);
  });

  it("**护栏**：没有前置内容时原样返回（不得误伤正常作品）", () => {
    const chapters = [
      { ordinal: 1, title: "第一回　说楔子敷陈大义" },
      { ordinal: 2, title: "第二回　王孝廉村学识同科" }
    ];

    expect(selectAnalyzableChapters(chapters)).toEqual(chapters);
  });

  it("**护栏**：整本塌成单章（ordinal 1）时**不得**被当成前置内容丢掉", () => {
    // 若这条失败，说明「全书无标题标记」的作品会被整本跳过 → 静默产出一张空图。
    const chapters = [{ ordinal: 1, title: "正文" }];

    expect(selectAnalyzableChapters(chapters)).toHaveLength(1);
  });
});
