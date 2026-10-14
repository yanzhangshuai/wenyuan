import { describe, expect, it } from "vitest";

import {
  CANDIDATE_RANK_KEYS,
  DISCOVERY_DEFAULTS,
  HEADING_DISCOVERY_DEFAULTS,
  auditDictionary,
  discoverHeadingCandidates,
  discoverNgrams,
  rankCandidates,
  selectByFreedom,
  selectNovelCandidates,
  stripChapterNumberPrefix,
  type NgramCandidate
} from "./discovery";

import { CLASSICAL_GENRE_PACK, type GenrePack } from ".";

/**
 * 造 `count` 个**互不相同**的 CJK 汉字。
 *
 * 用途：把语料撑到足够的 `N`（凝固度 = `log(N·f / (f左·f右))`，`N` 太小则什么都过不了闸），
 * 同时**不产生任何新候选** —— 每个字只出现一次 → 频次 1 → 被频次闸拦下。
 *
 * ⚠️ 偏移取 `0x9000`（CJK 统一表意文字区）是为了避开本文件用到的**所有**字。
 */
function uniqueHan(count: number, offset: number): string {
  let out = "";
  for (let i = 0; i < count; i += 1) {
    out += String.fromCharCode(offset + i);
  }
  return out;
}

/** 撑大 `N` 的填充（200 个互不相同的汉字，故自身不产生候选）。 */
const FILLER = uniqueHan(200, 0x9000);

/**
 * 主合成语料。每一段都为一个**具体的**断言服务（`N ≈ 306`）：
 *
 * | 片段 | 作用 |
 * | --- | --- |
 * | `一甲乙丙丁` / `二甲乙丙戊` / `三甲乙丙己` / `四甲乙丙庚` | `甲乙丙` ×4，左右邻字**各 4 种** → 自由度 `ln 4`（且 `甲乙` 的右邻字恒为 `丙` → 自由度 **0**） |
 * | `子丑寅子丑寅` | `子丑寅` ×2 → **频次恰为 2** 的 3-gram |
 * | `癸亥` | 频次 **1** → **频次闸**的反例 |
 * | `。，。，` | 含标点的 2-gram ×2 → **全 CJK 闸**的反例 |
 * | `未申未申` | 与 `。，` **统计量完全相同**的 CJK 对照（左/右各 2 种取值、频次 2） |
 * | `先生先生` | 停用词 ×2 → **泛称闸**的反例 |
 * | `初末初末` | 与 `先生` **统计量完全相同**的非停用词对照 |
 * | `午`×30 + `巳`×30 + `午巳` | `午巳` 频次 2 但两侧字各出现 31 次 → **凝固度 < 3**（凝固度闸的反例） |
 *
 * ⚠️ 为什么「全 CJK 闸」「泛称闸」必须用**同统计量的对照**而不是「放宽 `minCohesion` 后能看到它」：
 * 这两道闸是**无条件**的（不受任何阈值控制），所以放宽阈值**证明不了**「它本来能过前两道闸」。
 * 对照组才是真正的证据 —— 两个 gram 的频次与邻字分布**逐项相同**，
 * 唯一差别就是「含标点」/「在停用表里」。
 */
const BODY =
  [
    "一甲乙丙丁",
    "二甲乙丙戊",
    "三甲乙丙己",
    "四甲乙丙庚",
    "子丑寅子丑寅",
    "癸亥",
    "。，。，",
    "未申未申",
    "先生先生",
    "初末初末",
    "午".repeat(30) + "巳".repeat(30) + "午巳"
  ].join("") + FILLER;

/** 取某个 gram 的候选；不在候选里返回 undefined。 */
function find(candidates: readonly NgramCandidate[], gram: string): NgramCandidate | undefined {
  return candidates.find((candidate) => candidate.gram === gram);
}

describe("discoverNgrams · 两道闸（频次 + 凝固度）", () => {
  it("频次闸：出现 1 次的 n-gram 不进候选，出现 2 次的进", () => {
    const strict = discoverNgrams(BODY);
    const loose = discoverNgrams(BODY, { minFrequency: 1 });

    // `癸亥` 全篇只出现 1 次 → 默认（minFrequency = 2）下必须缺席。
    expect(find(strict, "癸亥")).toBeUndefined();
    // 但它的凝固度是够的（两个字各只出现 1 次 → cohesion = ln N ≈ 5.7）→
    // 降档后**必须出现**，这才证明「缺席的原因是频次闸」，而不是被别的闸顺手拦掉。
    expect(find(loose, "癸亥")).toBeDefined();
    // `子丑寅` 恰好出现 2 次 → 两档都在（边界值不被误杀）。
    expect(find(strict, "子丑寅")).toBeDefined();
  });

  it("凝固度闸：低凝固度的 2-gram 被拦下，放宽阈值后才出现", () => {
    const strict = discoverNgrams(BODY);
    const loose = discoverNgrams(BODY, { minCohesion: -100 });

    // `午巳` 频次 2，但 `午`/`巳` 各出现 31 次 → cohesion = log(N·2/(31·31)) ≈ -0.45 < 3。
    expect(find(strict, "午巳")).toBeUndefined();
    expect(find(loose, "午巳")).toBeDefined();
    // 闸只做减法：放宽后集合**严格变大**，且默认档是其子集。
    expect(loose.length).toBeGreaterThan(strict.length);
    const looseSet = new Set(loose.map((candidate) => candidate.gram));
    for (const candidate of strict) {
      expect(looseSet.has(candidate.gram)).toBe(true);
    }
  });

  it("全 CJK 闸：含标点的 n-gram 被拦下（同统计量的 CJK 对照则通过）", () => {
    const candidates = discoverNgrams(BODY);

    // 对照：`未申` 与 `。，` 频次都是 2、左右邻字都各 2 种 → 统计量逐项相同。
    expect(find(candidates, "未申")).toBeDefined();
    // 唯一差别是含标点 → 被 CJK 闸拦下。
    expect(find(candidates, "。，")).toBeUndefined();
    expect(candidates.every((candidate) => /^[\u4e00-\u9fff]+$/.test(candidate.gram))).toBe(true);
  });

  it("泛称闸：命中停用表的 n-gram 被拦下（同统计量的非停用词对照则通过）", () => {
    const candidates = discoverNgrams(BODY);

    // 对照：`初末` 与 `先生` 频次都是 2、左右邻字都各 2 种 → 统计量逐项相同。
    expect(find(candidates, "初末")).toBeDefined();
    // 唯一差别是 `先生` 在 `STOP_WORDS` 里（光杆泛称）→ 被泛称闸拦下。
    expect(find(candidates, "先生")).toBeUndefined();
  });

  it("泛称表取自**传入的**题材包（不是硬编码）", () => {
    const custom: GenrePack = {
      ...CLASSICAL_GENRE_PACK,
      lexicon: { ...CLASSICAL_GENRE_PACK.lexicon, stopWords: new Set(["初末"]) }
    };
    const candidates = discoverNgrams(BODY, { genrePack: custom });

    expect(find(candidates, "初末")).toBeUndefined();
    // 生产包里的 `先生` 在自定义包里不再是停用词 → 这次必须出现。
    expect(find(candidates, "先生")).toBeDefined();
  });
});

describe("discoverNgrams · 自由度", () => {
  it("自由度**不**在发现阶段过滤（原样带回，由 selectByFreedom 切片）", () => {
    const candidates = discoverNgrams(BODY);

    // **行为证据**：输出里存在 `freedom < 0.6` 的候选 —— 若发现阶段内部过滤了自由度，它们不可能在。
    const belowDefault = candidates.filter(
      (candidate) => candidate.freedom < DISCOVERY_DEFAULTS.minFreedom
    );
    expect(belowDefault.length).toBeGreaterThan(0);

    // **类型证据**：`minFreedom` 刻意**不在** `DiscoveryOptions` 里（旋钮在 `selectByFreedom` 上）。
    // `@ts-expect-error` 把「这个属性不该被接受」变成一次**编译期**断言：
    // 若日后有人把它加进选项，`tsc --noEmit` 会因「未使用的 ts-expect-error」而失败。
    // （运行期则顺带证明：未知选项被**忽略**，不抛错。）
    // @ts-expect-error minFreedom 不属于 DiscoveryOptions
    expect(() => discoverNgrams(BODY, { minFreedom: 0.99 })).not.toThrow();

    expect(DISCOVERY_DEFAULTS.minFreedom).toBe(0.6);
  });

  it("自由度口径是 min(左熵, 右熵)，**不是** max（非对称分布必须区分得出来）", () => {
    const bigram = find(discoverNgrams(BODY), "甲乙");

    expect(bigram).toBeDefined();
    // `甲乙` 的左邻字是 一/二/三/四（4 种 → 熵 ln4），右邻字恒为 丙（1 种 → 熵 0）。
    // 取 min → 0；取 max → ln4 ≈ 1.3863。两者差 1.3863，断言精确到 1e-10。
    expect(bigram?.freedom).toBeCloseTo(0, 10);
  });

  it("定理：所有候选满足 freedom ≤ ln(frequency)，且**边界取得到**", () => {
    const candidates = discoverNgrams(BODY);

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.freedom).toBeLessThanOrEqual(Math.log(candidate.frequency) + 1e-9);
    }
    // `甲乙丙`：freq 4，左右邻字各 4 种 → freedom = ln4 = ln(frequency) → **取等号**。
    // 没有这条，「≤」可能只是「远小于」而没测到边界那一侧。
    const boundary = candidates.filter(
      (candidate) => Math.abs(candidate.freedom - Math.log(candidate.frequency)) < 1e-9
    );
    expect(boundary.length).toBeGreaterThan(0);
  });
});

describe("selectByFreedom", () => {
  it("是 ≥ 语义（阈值恰等于 freedom 时**保留**）", () => {
    const sample: NgramCandidate = { gram: "甲乙", frequency: 4, cohesion: 1, freedom: 0.6 };

    expect(selectByFreedom([sample], 0.6)).toHaveLength(1);
    expect(selectByFreedom([sample], 0.6 + 1e-9)).toHaveLength(0);
  });

  it("单调：阈值升高 → 结果是子集", () => {
    const candidates = discoverNgrams(BODY);
    const low = selectByFreedom(candidates, 0.4);
    const high = selectByFreedom(candidates, 0.8);

    expect(high.length).toBeLessThanOrEqual(low.length);
    const lowSet = new Set(low);
    for (const candidate of high) {
      expect(lowSet.has(candidate)).toBe(true);
    }
  });
});

describe("rankCandidates", () => {
  const candidates: readonly NgramCandidate[] = [
    { gram: "甲乙", frequency: 3, cohesion: 1, freedom: 0 },
    { gram: "甲乙丙", frequency: 4, cohesion: 1, freedom: 0 },
    { gram: "甲乙丙丁", frequency: 2, cohesion: 1, freedom: 0 }
  ];

  it("按频次降序", () => {
    const ranked = rankCandidates(candidates, "频次");
    expect(ranked.map((candidate) => candidate.gram)).toEqual(["甲乙丙", "甲乙", "甲乙丙丁"]);
  });

  it("按 频次×长度 降序（长度信号会翻转名次）", () => {
    const ranked = rankCandidates(candidates, "频次×长度");
    // 3×2 = 6 / 4×3 = 12 / 2×4 = 8 → 甲乙丙(12) > 甲乙丙丁(8) > 甲乙(6)
    expect(ranked.map((candidate) => candidate.gram)).toEqual(["甲乙丙", "甲乙丙丁", "甲乙"]);
  });

  it("不修改入参（返回新数组）", () => {
    const before = candidates.map((candidate) => candidate.gram);
    rankCandidates(candidates, "频次");
    expect(candidates.map((candidate) => candidate.gram)).toEqual(before);
  });

  it("凝固度/自由度**不是**可选排序键（批 28 实测它们是反信号）", () => {
    expect(CANDIDATE_RANK_KEYS.map((key) => key.name)).toEqual(["频次", "频次×长度"]);
    expect(() => rankCandidates(candidates, "凝固度")).toThrow(/未知的候选排序键/);
    expect(() => rankCandidates(candidates, "自由度")).toThrow(/未知的候选排序键/);
  });
});

describe("auditDictionary", () => {
  /** 只造一个作品包，避免测试依赖真实作品包的内容。 */
  function packOf(entries: readonly string[]): WorkPackLike {
    return {
      id                 : "__test__",
      label              : "测试包",
      properNouns        : entries.map((entry) => [entry, 128] as const),
      properNounFrequency: 100_000
    };
  }

  /** 一份小语料：`甲乙丙` ×3，`丁戊己庚辛壬癸` 各 1 次。 */
  const BODY_FOR_AUDIT = "甲乙丙甲乙丙甲乙丙丁戊己庚辛壬癸";
  /**
   * 回目行 —— 刻意**不在** `BODY_FOR_AUDIT` 里（`parseChapters` 的实际形态：
   * 回目进 `chapter.title`、不进 `chapter.text`）。`子丑` 只在这里出现。
   */
  const HEADINGS_FOR_AUDIT: readonly string[] = ["第九回　子丑相逢"];
  /** 「不看回目」的**显式**口径（用来复现修复前的正文-only 读数）。 */
  const NO_HEADINGS: readonly string[] = [];
  /** 审计用的候选（放宽凝固度，让 `甲乙丙` 进来）。 */
  const AUDIT_CANDIDATES = (): readonly NgramCandidate[] =>
    discoverNgrams(BODY_FOR_AUDIT, { minCohesion: -100 });

  it("错收：正文与回目里都出现 0 次的词典条目进 deadEntries", () => {
    const audit = auditDictionary(
      BODY_FOR_AUDIT,
      packOf(["甲乙", "不存在"]),
      AUDIT_CANDIDATES(),
      HEADINGS_FOR_AUDIT
    );

    expect(audit.deadEntries).toEqual(["不存在"]);
    expect(audit.headingOnlyEntries).toEqual([]);
  });

  it("出现 ≥1 次的条目不进 deadEntries（子串口径：`甲` 在正文里出现 3 次）", () => {
    const audit = auditDictionary(
      BODY_FOR_AUDIT,
      packOf(["甲乙", "甲"]),
      AUDIT_CANDIDATES(),
      HEADINGS_FOR_AUDIT
    );

    expect(audit.deadEntries).toEqual([]);
    expect(audit.headingOnlyEntries).toEqual([]);
  });

  it("漏收：候选不在词典里 → 进 uncoveredCandidates", () => {
    const candidates = AUDIT_CANDIDATES();
    const audit = auditDictionary(BODY_FOR_AUDIT, packOf(["甲乙"]), candidates, NO_HEADINGS);

    expect(find(candidates, "甲乙丙")).toBeDefined();
    expect(audit.uncoveredCandidates).toContain("甲乙丙");
  });

  it("词典里已有的候选**不**进 uncoveredCandidates", () => {
    const candidates = AUDIT_CANDIDATES();
    const audit = auditDictionary(BODY_FOR_AUDIT, packOf(["甲乙丙"]), candidates, NO_HEADINGS);

    expect(find(candidates, "甲乙丙")).toBeDefined();
    expect(audit.uncoveredCandidates).not.toContain("甲乙丙");
  });

  it("条目先过 normalizeName 再比较（空白/全角形态不会被误判）", () => {
    // `甲　乙丙`（含全角空格）经 `normalizeName` 收敛到 `甲乙丙`。
    const audit = auditDictionary(
      BODY_FOR_AUDIT,
      packOf(["甲　乙丙"]),
      AUDIT_CANDIDATES(),
      NO_HEADINGS
    );

    expect(audit.deadEntries).toEqual([]);
    expect(audit.uncoveredCandidates).not.toContain("甲乙丙");
  });

  it("空词典 → 所有候选都算漏收（不做特殊处理）", () => {
    const candidates = AUDIT_CANDIDATES();
    const audit = auditDictionary(BODY_FOR_AUDIT, packOf([]), candidates, NO_HEADINGS);

    expect(audit.deadEntries).toEqual([]);
    expect(audit.headingOnlyEntries).toEqual([]);
    expect(audit.uncoveredCandidates).toHaveLength(candidates.length);
  });

  // —— 批 36：口径修复（「正文 0 次」≠「原文 0 次」）——

  it("⭐ 正文 0 次、回目里有的条目进 headingOnlyEntries（**不是** deadEntries）", () => {
    const audit = auditDictionary(
      BODY_FOR_AUDIT,
      packOf(["子丑"]),
      AUDIT_CANDIDATES(),
      HEADINGS_FOR_AUDIT
    );

    expect(audit.headingOnlyEntries).toEqual(["子丑"]);
    expect(audit.deadEntries).toEqual([]);
  });

  it("🚨 回归：同一条目在**修复前的口径**下会被报成死条目（证明这条修复真的在做事）", () => {
    // 这是本用例的**反作弊**面：如果实现退回成「只看 body」，下面第一行就会挂。
    const withHeadings = auditDictionary(
      BODY_FOR_AUDIT,
      packOf(["子丑"]),
      AUDIT_CANDIDATES(),
      HEADINGS_FOR_AUDIT
    );
    const withoutHeadings = auditDictionary(
      BODY_FOR_AUDIT,
      packOf(["子丑"]),
      AUDIT_CANDIDATES(),
      NO_HEADINGS
    );

    expect(withHeadings.deadEntries).toEqual([]);
    expect(withoutHeadings.deadEntries).toEqual(["子丑"]);
  });

  it("两个桶**互斥且并集 = 「正文 0 次」的条目集**（不许两边都进、也不许两边都不进）", () => {
    const pack = packOf(["甲乙", "子丑", "不存在"]);
    const audit = auditDictionary(BODY_FOR_AUDIT, pack, AUDIT_CANDIDATES(), HEADINGS_FOR_AUDIT);

    expect(audit.headingOnlyEntries).toEqual(["子丑"]);
    expect(audit.deadEntries).toEqual(["不存在"]);
    expect(audit.deadEntries).not.toContain("甲乙");
    expect(audit.headingOnlyEntries).not.toContain("甲乙");
  });

  it("回目里出现、正文里也出现的条目**两边都不进**（极性用例）", () => {
    const audit = auditDictionary(
      BODY_FOR_AUDIT,
      packOf(["甲乙"]),
      AUDIT_CANDIDATES(),
      ["第九回　甲乙相逢"]
    );

    expect(audit.deadEntries).toEqual([]);
    expect(audit.headingOnlyEntries).toEqual([]);
  });
});

describe("stripChapterNumberPrefix · 章号前缀剥离", () => {
  it("剥中文数字 + 全角空格的古典回目（儒林形态）", () => {
    expect(stripChapterNumberPrefix("第一回　说楔子敷陈大义　借名流隐括全文")).toBe(
      "说楔子敷陈大义　借名流隐括全文"
    );
    expect(stripChapterNumberPrefix("第五十五回　添四客述往思来")).toBe("添四客述往思来");
  });

  it("剥阿拉伯数字 + 半角空格的现代章目（红楼形态）", () => {
    expect(stripChapterNumberPrefix("第1章 甄士隐梦幻识通灵 贾雨村风尘怀闺秀")).toBe(
      "甄士隐梦幻识通灵 贾雨村风尘怀闺秀"
    );
    expect(stripChapterNumberPrefix("第 12 章 某标题")).toBe("某标题");
  });

  it("剥卷帙形态", () => {
    expect(stripChapterNumberPrefix("卷三 某标题")).toBe("某标题");
  });

  it("⚠️ 只剥**行首** —— 正文里的「第一回」是内容，剥不得", () => {
    // 这条是**极性**用例：若实现写成 `replace(/第.../)`（无 `^` 锚），
    // 下面第一行会被误伤。
    expect(stripChapterNumberPrefix("甲乙第一回丙丁")).toBe("甲乙第一回丙丁");
    expect(stripChapterNumberPrefix("说楔子第一回敷陈大义")).toBe("说楔子第一回敷陈大义");
  });

  it("无前缀时原样返回", () => {
    expect(stripChapterNumberPrefix("楔子")).toBe("楔子");
    expect(stripChapterNumberPrefix("")).toBe("");
  });
});

describe("discoverHeadingCandidates · 回目通道", () => {
  it("🔑 `F = 1`：只出现**一次**的字串也是候选（正文通道拿不到）", () => {
    // 单个回目行 → 每个字串都只出现 1 次。
    const headings = ["第一回　甲乙丙丁"];

    // 正文通道：频次闸 F ≥ 2 → **一条都没有**。
    expect(discoverNgrams("甲乙丙丁")).toEqual([]);

    // 回目通道：F = 1 → 6 条（2 字 3 条 + 3 字 2 条 + 4 字 1 条）。
    const grams = discoverHeadingCandidates(headings).map((candidate) => candidate.gram);
    expect([...grams].sort()).toEqual(
      ["甲乙", "乙丙", "丙丁", "甲乙丙", "乙丙丁", "甲乙丙丁"].sort()
    );
  });

  it("⚠️ 章号样板不进候选（剥离真的生效）", () => {
    const grams = new Set(
      discoverHeadingCandidates(["第一回　甲乙丙丁", "第二回　甲乙戊己"]).map(
        (candidate) => candidate.gram
      )
    );

    expect(grams.has("第一回")).toBe(false);
    expect(grams.has("第一")).toBe(false);
    expect(grams.has("一回")).toBe(false);
    expect(grams.has("甲乙丙丁")).toBe(true);
  });

  it("⚠️ 章号**不在行首**时不剥（与上一条互为反例）", () => {
    const grams = new Set(
      discoverHeadingCandidates(["甲乙第一回丙丁"]).map((candidate) => candidate.gram)
    );

    expect(grams.has("第一回")).toBe(true);
  });

  it("🚨 自由度恒为 0 —— 正的自由度闸会把回目清空（这是「必须 F=1」的机制）", () => {
    const candidates = discoverHeadingCandidates(["第一回　甲乙丙丁"]);

    expect(candidates.every((candidate) => candidate.freedom === 0)).toBe(true);
    expect(selectByFreedom(candidates, DISCOVERY_DEFAULTS.minFreedom)).toEqual([]);
    expect(selectByFreedom(candidates, 0)).toHaveLength(candidates.length);
  });

  it("泛称停用表仍然生效（回目通道不豁免停用词）", () => {
    const grams = new Set(
      discoverHeadingCandidates(["第一回　先生先生"]).map((candidate) => candidate.gram)
    );

    expect(grams.has("先生")).toBe(false);
  });

  it("默认闸门就是 `HEADING_DISCOVERY_DEFAULTS`（不是正文那套）", () => {
    expect(HEADING_DISCOVERY_DEFAULTS.minFrequency).toBe(1);
    expect(HEADING_DISCOVERY_DEFAULTS.minCohesion).toBe(Number.NEGATIVE_INFINITY);
    // 用默认值跑，与显式传入默认值跑，结果必须逐条相同。
    const withDefault = discoverHeadingCandidates(["第一回　甲乙丙丁"]).map((c) => c.gram);
    const explicit = discoverHeadingCandidates(["第一回　甲乙丙丁"], {
      maxN        : HEADING_DISCOVERY_DEFAULTS.maxN,
      minFrequency: HEADING_DISCOVERY_DEFAULTS.minFrequency,
      minCohesion : HEADING_DISCOVERY_DEFAULTS.minCohesion
    }).map((c) => c.gram);
    expect(withDefault).toEqual(explicit);
  });

  it("空标题列表 → 无候选（不抛错）", () => {
    expect(discoverHeadingCandidates([])).toEqual([]);
  });
});

describe("selectNovelCandidates · 通道差集", () => {
  /** 造一个最小候选。 */
  const cand = (gram: string, frequency = 1): NgramCandidate => ({
    gram,
    frequency,
    cohesion: 0,
    freedom : 0
  });

  it("取「不在已知集合里」的部分，且**保持原顺序**", () => {
    const novel = selectNovelCandidates(
      [cand("甲"), cand("乙"), cand("丙"), cand("丁")],
      [cand("乙"), cand("丁")]
    );

    expect(novel.map((candidate) => candidate.gram)).toEqual(["甲", "丙"]);
  });

  it("已知集合为空 → 原样返回（不复制元素，但也不改内容）", () => {
    const input = [cand("甲"), cand("乙")];
    const novel = selectNovelCandidates(input, []);

    expect(novel.map((candidate) => candidate.gram)).toEqual(["甲", "乙"]);
  });

  it("⚠️ 按**字面**比较，不看统计量（频次不同也算同一条）", () => {
    // 这是刻意的：回目候选与正文候选的统计量**不可比**（不同语料、不同闸门），
    // 所以差集只能按 `gram` 字面算。若哪天有人改成按频次比较，这条会红。
    const novel = selectNovelCandidates([cand("甲", 1)], [cand("甲", 999)]);

    expect(novel).toEqual([]);
  });

  it("不修改入参", () => {
    const input = [cand("甲"), cand("乙")];
    const known = [cand("甲")];
    selectNovelCandidates(input, known);

    expect(input).toHaveLength(2);
    expect(known).toHaveLength(1);
  });
});

/** `packOf` 的返回类型别名（与 `WorkPack` 同形，避免多引一个 import）。 */
type WorkPackLike = Parameters<typeof auditDictionary>[1];