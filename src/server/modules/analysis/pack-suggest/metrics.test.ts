// @vitest-environment node
import { describe, expect, it } from "vitest";

import { METRIC_LABELS, computePackMetrics, gradeMetrics } from "./metrics";

/**
 * 生成质量指标的纯函数测试。
 *
 * 这些数字会直接决定页面上「红色警告」，阈值定错的代价是：
 * 要么天天误报（用户学会忽略），要么永远不报（等于没有）。
 */

const base = {
  candidateCount    : 200,
  properNounCount   : 90,
  aliasGroups       : [["甲", "甲一"], ["乙", "乙一", "乙二"]],
  keptAliases       : 3,
  unsupportedAliases: 1,
  rejectedCount     : 100
};

describe("computePackMetrics", () => {
  it("证据覆盖率 = 保留别名 / (保留 + 证据缺失)", () => {
    // 3 / (3 + 1) = 0.75
    expect(computePackMetrics(base).evidenceCoverage).toBe(0.75);
  });

  it("进组率 = 组内名字总数 / 候选数", () => {
    // 2 + 3 = 5；5 / 200 = 0.025
    expect(computePackMetrics(base).groupRate).toBe(0.025);
  });

  it("拒绝率 = 被判非人物 / 候选数", () => {
    expect(computePackMetrics(base).rejectRate).toBe(0.5);
  });

  it("分母为 0 时返回 0，不产生 NaN", () => {
    const metrics = computePackMetrics({
      candidateCount    : 0,
      properNounCount   : 0,
      aliasGroups       : [],
      keptAliases       : 0,
      unsupportedAliases: 0,
      rejectedCount     : 0
    });
    expect(metrics.evidenceCoverage).toBe(0);
    expect(metrics.groupRate).toBe(0);
    expect(metrics.rejectRate).toBe(0);
    expect(Number.isNaN(metrics.evidenceCoverage)).toBe(false);
  });

  it("比例保留 4 位小数（避免存一长串浮点尾巴）", () => {
    const metrics = computePackMetrics({
      candidateCount    : 3,
      properNounCount   : 1,
      aliasGroups       : [],
      keptAliases       : 1,
      unsupportedAliases: 2,
      rejectedCount     : 1
    });
    // 1/3 = 0.3333...
    expect(metrics.evidenceCoverage).toBe(0.3333);
  });

  it("记录候选/专名/组数，便于判断「这本书是不是太小」", () => {
    const metrics = computePackMetrics(base);
    expect(metrics.candidateCount).toBe(200);
    expect(metrics.properNounCount).toBe(90);
    expect(metrics.aliasGroupCount).toBe(2);
  });
});

describe("gradeMetrics（阈值：只对极端值报警）", () => {
  const withCoverage = (evidenceCoverage: number) =>
    gradeMetrics({ ...computePackMetrics(base), evidenceCoverage });

  it("证据覆盖率：<50% 红，50–75% 黄，≥75% 绿", () => {
    expect(withCoverage(0.3).evidenceCoverage).toBe("bad");
    expect(withCoverage(0.5).evidenceCoverage).toBe("warn");
    expect(withCoverage(0.75).evidenceCoverage).toBe("good");
  });

  const withGroupRate = (groupRate: number) => gradeMetrics({ ...computePackMetrics(base), groupRate });

  it("进组率：<1% 红（几乎没分组），1–3% 黄，3–70% 绿，>70% 黄（过度合并）", () => {
    expect(withGroupRate(0.005).groupRate).toBe("bad");
    expect(withGroupRate(0.02).groupRate).toBe("warn");
    expect(withGroupRate(0.03).groupRate).toBe("good");
    // 实测红楼 10 回全文校验后是 36% —— 古典小说一人多称，属正常，不该报警。
    expect(withGroupRate(0.36).groupRate).toBe("good");
    // 超过 70% 说明在把不同的人并成一人，比漏并更难发现。
    expect(withGroupRate(0.75).groupRate).toBe("warn");
  });

  const withRejectRate = (rejectRate: number) => gradeMetrics({ ...computePackMetrics(base), rejectRate });

  it("拒绝率：两头都可能是问题（>80% 或 <5% 黄）", () => {
    expect(withRejectRate(0.9).rejectRate).toBe("warn");
    expect(withRejectRate(0.02).rejectRate).toBe("warn");
    expect(withRejectRate(0.5).rejectRate).toBe("good");
  });
});

describe("METRIC_LABELS", () => {
  it("三项指标都有中文名与说明（新增指标不补文案会在这里变红）", () => {
    for (const key of ["evidenceCoverage", "groupRate", "rejectRate"] as const) {
      expect(METRIC_LABELS[key].label.length).toBeGreaterThan(0);
      expect(METRIC_LABELS[key].hint.length).toBeGreaterThan(10);
    }
  });
});
