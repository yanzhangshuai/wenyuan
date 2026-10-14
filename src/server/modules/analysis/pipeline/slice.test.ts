import { describe, expect, it } from "vitest";

import { DEFAULT_OVERLAP_CHARS, DEFAULT_TARGET_CHARS, sliceChapter } from "./slice";

/** 构造等长段落序列。 */
function makeParagraphs(count: number, charsPerParagraph: number) {
  return Array.from({ length: count }, (_, index) => ({
    ordinal: index + 1,
    text   : "甲".repeat(charsPerParagraph)
  }));
}

describe("sliceChapter", () => {
  it("空输入返回空数组", () => {
    expect(sliceChapter([])).toEqual([]);
  });

  it("总字数不超过目标时只产出一片，且覆盖全部段落", () => {
    const slices = sliceChapter(makeParagraphs(3, 100));
    expect(slices).toHaveLength(1);
    expect(slices[0]?.paragraphStart).toBe(1);
    expect(slices[0]?.paragraphEnd).toBe(3);
    expect(slices[0]?.charCount).toBe(300);
  });

  it("长章节切成多片，且相邻片存在重叠", () => {
    const slices = sliceChapter(makeParagraphs(40, 500), {
      targetChars : 2000,
      overlapChars: 400
    });
    expect(slices.length).toBeGreaterThan(1);

    let previousEnd = 0;
    for (const [position, slice] of slices.entries()) {
      expect(slice.index).toBe(position);
      if (position > 0) {
        // 重叠的判定：下一片起点不晚于上一片终点。
        expect(slice.paragraphStart).toBeLessThanOrEqual(previousEnd);
      }
      previousEnd = slice.paragraphEnd;
    }
  });

  it("片起点严格前进，保证循环终止", () => {
    // 单段字数远超目标，强制每片仅含一段，检验前进不变量。
    const slices = sliceChapter(makeParagraphs(20, 5000), {
      targetChars : 100,
      overlapChars: 50
    });
    let previousStart = 0;
    for (const [position, slice] of slices.entries()) {
      if (position > 0) {
        expect(slice.paragraphStart).toBeGreaterThan(previousStart);
      }
      previousStart = slice.paragraphStart;
    }
  });

  it("默认参数落在设计区间内（3000–4000 字 / 重叠 300–400 字）", () => {
    expect(DEFAULT_TARGET_CHARS).toBeGreaterThanOrEqual(3000);
    expect(DEFAULT_TARGET_CHARS).toBeLessThanOrEqual(4000);
    expect(DEFAULT_OVERLAP_CHARS).toBeGreaterThanOrEqual(300);
    expect(DEFAULT_OVERLAP_CHARS).toBeLessThanOrEqual(400);
  });
});
