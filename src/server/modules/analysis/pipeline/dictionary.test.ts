import { describe, expect, it } from "vitest";

import {
  collectCandidateNames,
  isAllowedPostag,
  isViableCandidate,
  renderCandidateDictionary
} from "./dictionary";

/** 构造分词结果。 */
function chapter(ordinal: number, words: string[], tag = "n") {
  return { chapterOrdinal: ordinal, words: words.map((word) => ({ word, tag })) };
}

/** 构造带词性码的分词结果（`tag` 与 `words` 一一对应）。 */
function taggedChapter(ordinal: number, entries: readonly [string, string][]) {
  return {
    chapterOrdinal: ordinal,
    words         : entries.map(([word, tag]) => ({ word, tag }))
  };
}

describe("isViableCandidate", () => {
  it("拒绝单字名", () => {
    expect(isViableCandidate("周", 6)).toBe(false);
  });

  it("拒绝超长词", () => {
    expect(isViableCandidate("一二三四五六七", 6)).toBe(false);
  });

  it("拒绝停用词", () => {
    expect(isViableCandidate("说道", 6)).toBe(false);
  });

  it("拒绝不含 CJK 的纯标点数字", () => {
    expect(isViableCandidate("123", 6)).toBe(false);
    expect(isViableCandidate("..", 6)).toBe(false);
  });

  it("接受正常人名", () => {
    expect(isViableCandidate("范进", 6)).toBe(true);
    expect(isViableCandidate("严监生", 6)).toBe(true);
  });
});

describe("isAllowedPostag", () => {
  it("放行人名（128）", () => {
    expect(isAllowedPostag("128")).toBe(true);
  });

  it("放行地名（64）、机构（32）、其他专名（16）", () => {
    expect(isAllowedPostag("64")).toBe(true);
    expect(isAllowedPostag("32")).toBe(true);
    expect(isAllowedPostag("16")).toBe(true);
  });

  it("拒绝泛称（A_N=1048576）与动词（D_V=4096）", () => {
    expect(isAllowedPostag("1048576")).toBe(false);
    expect(isAllowedPostag("4096")).toBe(false);
  });

  it("放行无词性标注的空串", () => {
    // 古典文本中大量专名退化为无标注词（实测「严监生」即无词性码），
    // 一刀切排除会漏召回真名，故放行并由长度/停用表兜底。
    expect(isAllowedPostag("")).toBe(true);
  });

  it("放行非数字词性码，避免误杀未知标注方案", () => {
    // 既有测试使用 "n" 这类 ASCII 词性，不应被词性码过滤误伤。
    expect(isAllowedPostag("n")).toBe(true);
  });
});

describe("collectCandidateNames 的词性准入", () => {
  it("排除未被停用表覆盖的高频泛称（纯靠词性码拦截）", () => {
    // 关键：这里刻意选用**不在 STOP_WORDS 里**的泛称「东西」（A_N 泛称），
    // 使断言只可能由词性准入拦截，而不是被停用表顺带拦掉 ——
    // 否则该用例会在「删除词性过滤」的变异下依然通过，沦为假绿。
    const candidates = collectCandidateNames(
      [
        taggedChapter(1, [
          ["东西", "1048576"],
          ["东西", "1048576"],
          ["东西", "1048576"],
          ["范进", "128"],
          ["范进", "128"],
          ["范进", "128"]
        ])
      ],
      { minFrequency: 3 }
    );
    expect(candidates.map((item) => item.normalized)).toEqual(["范进"]);
  });

  it("停用表独立生效（与词性无关）", () => {
    const candidates = collectCandidateNames(
      [
        taggedChapter(1, [
          ["先生", "128"],
          ["先生", "128"],
          ["先生", "128"],
          ["范进", "128"],
          ["范进", "128"],
          ["范进", "128"]
        ])
      ],
      { minFrequency: 3 }
    );
    // 「先生」即便被标为人名，也应被停用表拦下。
    expect(candidates.map((item) => item.normalized)).toEqual(["范进"]);
  });

  it("保留无词性标注的高频专名（严监生回归用例）", () => {
    // 真实语料中「严监生」被切成整词但**不带词性码**，
    // 若词性过滤一刀切排除空串，会导致该人物漏召回。
    const candidates = collectCandidateNames(
      [
        taggedChapter(1, [
          ["严监生", ""],
          ["严监生", ""],
          ["严监生", ""]
        ])
      ],
      { minFrequency: 3 }
    );
    expect(candidates.map((item) => item.normalized)).toEqual(["严监生"]);
  });

  it("排除被切成动词的高频片段", () => {
    const candidates = collectCandidateNames(
      [taggedChapter(1, [["踱进", "4096"], ["踱进", "4096"], ["踱进", "4096"], ["匡超人", "128"], ["匡超人", "128"], ["匡超人", "128"]])],
      { minFrequency: 3 }
    );
    expect(candidates.map((item) => item.normalized)).toEqual(["匡超人"]);
  });
});

describe("collectCandidateNames", () => {
  it("统计跨章频次", () => {
    const candidates = collectCandidateNames(
      [chapter(1, ["范进", "范进", "范进", "周进", "周进"]), chapter(2, ["范进", "周进"])],
      { minFrequency: 2 }
    );
    const fan = candidates.find((item) => item.normalized === "范进");
    const zhou = candidates.find((item) => item.normalized === "周进");
    expect(fan?.frequency).toBe(4);
    expect(zhou?.frequency).toBe(3);
  });

  it("默认阈值下过滤掉低频词", () => {
    const candidates = collectCandidateNames(
      [chapter(1, ["范进", "范进", "范进", "一次性"])],
      { minFrequency: 3 }
    );
    expect(candidates.map((item) => item.normalized)).toEqual(["范进"]);
  });

  it("归一化后合并不同写法，并记录首次出现章节", () => {
    const candidates = collectCandidateNames(
      [chapter(3, ["司马光"]), chapter(5, ["司马 光"]), chapter(5, ["司马光"])],
      { minFrequency: 3 }
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.normalized).toBe("司马光");
    expect(candidates[0]?.frequency).toBe(3);
    expect(candidates[0]?.firstChapter).toBe(3);
  });

  it("频次降序；频次相同时按首次出现章节升序", () => {
    const candidates = collectCandidateNames(
      [
        chapter(1, ["乙乙", "乙乙"]),
        chapter(2, ["甲甲", "甲甲"]),
        chapter(2, ["丙丙"])
      ],
      { minFrequency: 1 }
    );
    expect(candidates.map((item) => item.normalized)).toEqual(["乙乙", "甲甲", "丙丙"]);
  });

  it("遵守数量上限", () => {
    const words = Array.from({ length: 30 }, (_, index) => `名字${String(index)}`);
    const candidates = collectCandidateNames([chapter(1, words)], {
      limit       : 5,
      minFrequency: 1
    });
    expect(candidates).toHaveLength(5);
  });

  it("空输入返回空数组", () => {
    expect(collectCandidateNames([])).toEqual([]);
  });
});

describe("renderCandidateDictionary", () => {
  it("每行渲染为「写法(次数)」", () => {
    const text = renderCandidateDictionary([
      { surface: "范进", normalized: "范进", frequency: 12, firstChapter: 1 }
    ]);
    expect(text).toBe("范进(12)");
  });

  it("空清单返回空串", () => {
    expect(renderCandidateDictionary([])).toBe("");
  });
});
