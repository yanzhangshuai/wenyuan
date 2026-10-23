// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { ANALYSIS_PROGRESS_STAGES } from "@/server/modules/analysis/progress";

// `server-only` 在非 RSC 环境会抛错；本测试直连服务端模块，显式置空。
vi.mock("server-only", () => ({}));

import { ANALYSIS_STAGE_LABELS, computeAnalysisPercent } from "./analysis-status";

/**
 * 进度口径的纯函数测试。
 *
 * 这些数字会直接显示给用户（「解析中 62%」），一旦口径漂移，
 * 用户看到的是「卡住不动」或「跳到 100 但没结果」。
 */

describe("computeAnalysisPercent", () => {
  it("没有 run 时为 0", () => {
    expect(computeAnalysisPercent(null, 0, 0)).toBe(0);
  });

  it("排队中为 0", () => {
    expect(computeAnalysisPercent("queued", 0, 0)).toBe(0);
  });

  it("词典阶段：不知道分母时给 1%，知道后给 2%", () => {
    expect(computeAnalysisPercent("dictionary", 0, 0)).toBe(1);
    expect(computeAnalysisPercent("dictionary", 0, 180)).toBe(2);
  });

  it("分片阶段按比例铺开到 95%", () => {
    expect(computeAnalysisPercent("extract", 0, 100)).toBe(2);
    expect(computeAnalysisPercent("extract", 50, 100)).toBe(49); // 2 + 0.5*93 = 48.5 → 49
    expect(computeAnalysisPercent("extract", 100, 100)).toBe(95);
  });

  it("分片阶段对异常输入收敛（不越界、不 NaN）", () => {
    expect(computeAnalysisPercent("extract", 0, 0)).toBe(2);
    expect(computeAnalysisPercent("extract", 999, 100)).toBe(95);
    expect(computeAnalysisPercent("extract", -5, 100)).toBe(2);
  });

  it("收尾阶段恒为 96%（P2/P4/P5/P6 都很快，不该让进度条卡住）", () => {
    for (const stage of ["grounding", "vote", "merge", "aggregate"] as const) {
      expect(computeAnalysisPercent(stage, 100, 100)).toBe(96);
    }
  });

  it("done 恒为 100", () => {
    expect(computeAnalysisPercent("done", 100, 100)).toBe(100);
  });

  it("单调不减：阶段推进时百分比不允许回退", () => {
    const sequence = [
      computeAnalysisPercent("queued", 0, 0),
      computeAnalysisPercent("dictionary", 0, 0),
      computeAnalysisPercent("dictionary", 0, 180),
      computeAnalysisPercent("extract", 0, 180),
      computeAnalysisPercent("extract", 90, 180),
      computeAnalysisPercent("extract", 180, 180),
      computeAnalysisPercent("grounding", 180, 180),
      computeAnalysisPercent("aggregate", 180, 180),
      computeAnalysisPercent("done", 180, 180)
    ];
    for (let i = 1; i < sequence.length; i += 1) {
      expect(sequence[i]).toBeGreaterThanOrEqual(sequence[i - 1] ?? 0);
    }
  });
});

describe("阶段文案", () => {
  it("每个阶段都必须有中文文案（新增阶段不补文案会在这里变红）", () => {
    for (const stage of ANALYSIS_PROGRESS_STAGES) {
      const label = ANALYSIS_STAGE_LABELS[stage];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("文案表的键集合与阶段常量完全一致（不允许多余键）", () => {
    expect(Object.keys(ANALYSIS_STAGE_LABELS).sort()).toEqual([...ANALYSIS_PROGRESS_STAGES].sort());
  });
});
