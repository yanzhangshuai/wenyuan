import { describe, expect, it } from "vitest";

import type { EntityDeed } from "@/types/profile";

import { DENSITY_THRESHOLDS, classifyDensity, groupDeedsByChapter } from "./profile";

/**
 * 事迹时间线分组与信息量分档的契约测试。
 *
 * 为什么必须有：`groupDeedsByChapter` 的输入来自 SQL `ORDER BY`，
 * 而**分组结果在渲染层是不可见的** —— 分错了仍是一串有序文本，
 * 只是「第 15 回」的句子被挂到了「第 16 回」标题下。
 * 这类错误不会被任何冻结快照发现，只能靠针对性的单测钉住。
 */

/** 构造一条最小可用的事迹记录。 */
function deed(chapterOrdinal: number, paragraphOrdinal = 0, surface = "某人"): EntityDeed {
  return {
    chapterOrdinal,
    chapterTitle : `第${String(chapterOrdinal)}回`,
    paragraphOrdinal,
    surface,
    paragraphText: "……",
    startOffset  : 0,
    endOffset    : 2
  };
}

describe("groupDeedsByChapter", () => {
  it("空输入返回空时间线", () => {
    expect(groupDeedsByChapter([])).toEqual([]);
  });

  it("同一回的连续多条聚成一个组", () => {
    const timeline = groupDeedsByChapter([deed(15, 0), deed(15, 1), deed(15, 2)]);

    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.chapterOrdinal).toBe(15);
    expect(timeline[0]?.deeds).toHaveLength(3);
  });

  it("跨回时按出现顺序切组，且保持组内顺序", () => {
    const timeline = groupDeedsByChapter([
      deed(15, 0, "匡超人"),
      deed(15, 3, "匡迥"),
      deed(16, 0, "匡超人"),
      deed(17, 2, "匡超人")
    ]);

    expect(timeline.map((group) => group.chapterOrdinal)).toEqual([15, 16, 17]);
    expect(timeline[0]?.deeds.map((item) => item.surface)).toEqual(["匡超人", "匡迥"]);
    expect(timeline[1]?.deeds).toHaveLength(1);
  });

  it("回号有缺口时断开成两组，不补齐中间回", () => {
    // 「人物在第 19 回完全不出现」必须表现为时间线断开，
    // 而不是生成一个空的第 19 回 —— 空组会在 UI 上渲染成空壳。
    const timeline = groupDeedsByChapter([deed(18), deed(20)]);

    expect(timeline.map((group) => group.chapterOrdinal)).toEqual([18, 20]);
    expect(timeline.every((group) => group.deeds.length > 0)).toBe(true);
  });

  it("回号 0（前置内容）与回号 1 是不同的组", () => {
    // `FRONT_MATTER_ORDINAL = 0`；若用真值判断（`if (!chapterOrdinal)`）
    // 会把第 0 回与第 1 回错误合并 —— 这正是本用例要钉住的写法陷阱。
    const timeline = groupDeedsByChapter([deed(0), deed(1)]);

    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.chapterOrdinal).toBe(0);
    expect(timeline[1]?.chapterOrdinal).toBe(1);
  });

  it("组标题取自该回首条事迹的章节标题", () => {
    const timeline = groupDeedsByChapter([deed(3), deed(3)]);

    expect(timeline[0]?.chapterTitle).toBe("第3回");
  });
});

describe("classifyDensity", () => {
  it("阈值边界按「大于等于」判定", () => {
    expect(classifyDensity(DENSITY_THRESHOLDS.rich)).toBe("rich");
    expect(classifyDensity(DENSITY_THRESHOLDS.moderate)).toBe("moderate");
  });

  it("低于中档阈值归为 sparse", () => {
    expect(classifyDensity(DENSITY_THRESHOLDS.moderate - 1)).toBe("sparse");
    expect(classifyDensity(0)).toBe("sparse");
  });

  it("高于丰富阈值仍为 rich", () => {
    expect(classifyDensity(DENSITY_THRESHOLDS.rich + 500)).toBe("rich");
  });

  it("实测中位数落到 sparse —— 长尾是常态而非异常", () => {
    // 《儒林外史》实测提及中位数 2、《红楼梦》为 1。
    // 这个断言不是重复实现，而是把「过半实体信息量不足」这个**语料事实**
    // 固定在代码里：任何让 sparse 判定变严的改动都会在此暴露。
    expect(classifyDensity(1)).toBe("sparse");
    expect(classifyDensity(2)).toBe("sparse");
  });
});
