/**
 * 自动生成的「作品包」质量指标（纯函数，零依赖）。
 *
 * ## 为什么需要它
 *
 * 自动生成的作品包原先只有一个 `draft` 标记 —— 那是**状态**，不是**质量**。
 * 用户看到「已生成 89 个专名 / 9 个别名组」无从判断好不好，
 * 只能等解析跑完（$0.2–0.66）看图谱像不像样。
 *
 * 这里的三项指标都是**从生成过程本身就能算出来的**，不额外调用模型：
 *
 * | 指标 | 低了说明什么 | 高了说明什么 |
 * | --- | --- | --- |
 * | 证据覆盖率 | 模型在编别名（片段里找不到出处） | 正常 |
 * | 进组率 | 漏并严重 —— 同一人被拆成多个实体的主因 | 可能过度合并 |
 * | 拒绝率 | 没在筛（把泛称都当人物） | 过度拒绝（把真人物筛掉了） |
 *
 * ## 阈值为什么这样定
 *
 * 全部按「**只有极端值才报警**」的原则定，不追求精确分档：
 * 当前只有两本书的实测样本，用窄阈值会大量误报，反而让用户学会忽略提示。
 * 等积累到 5 本以上再收紧（届时可以按同文体基线做偏离检测）。
 */

/** 指标等级。 */
export type MetricLevel = "good" | "warn" | "bad";

/** 一次生成的完整指标（存进 `book_packs.metrics`）。 */
export interface PackMetrics {
  /** 有原文片段支撑的别名 / 模型给出的全部别名。 */
  evidenceCoverage: number;
  /** 进了别名组的名字数 / 候选总数。 */
  groupRate: number;
  /** 被判「不是人物」的候选 / 候选总数。 */
  rejectRate: number;
  /** 候选总数（生成时的输入规模，用于判断「这本书是不是太小」）。 */
  candidateCount: number;
  /** 最终写入的专名数。 */
  properNounCount: number;
  /** 最终写入的别名组数。 */
  aliasGroupCount: number;
  /** 计算时间（ISO）。 */
  computedAt: string;
}

/** 计算所需的原始计数。 */
export interface PackMetricsInput {
  candidateCount  : number;
  properNounCount : number;
  aliasGroups     : readonly (readonly string[])[];
  /** 被保留的别名条数。 */
  keptAliases     : number;
  /** 因「证据片段里找不到」被砍掉的别名条数（= 疑似编造）。 */
  unsupportedAliases: number;
  /** 被判非人物的候选数。 */
  rejectedCount   : number;
}

/** 安全除法（分母为 0 时返回 0，不产生 NaN）。 */
function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

/**
 * 计算指标。
 *
 * @param input 生成过程的计数
 * @returns 指标（比例保留 4 位小数，避免存一堆浮点尾巴）
 */
export function computePackMetrics(input: PackMetricsInput): PackMetrics {
  const round = (value: number): number => Math.round(value * 10000) / 10000;
  const aliasTotal = input.keptAliases + input.unsupportedAliases;
  const groupedNames = input.aliasGroups.reduce((sum, group) => sum + group.length, 0);

  return {
    evidenceCoverage: round(ratio(input.keptAliases, aliasTotal)),
    groupRate       : round(ratio(groupedNames, input.candidateCount)),
    rejectRate      : round(ratio(input.rejectedCount, input.candidateCount)),
    candidateCount  : input.candidateCount,
    properNounCount : input.properNounCount,
    aliasGroupCount : input.aliasGroups.length,
    computedAt      : new Date().toISOString()
  };
}

/**
 * 给指标评级。
 *
 * 阈值原则：只对**极端值**报警。中间地带一律 good ——
 * 宁可漏报也不要让提示变成噪声。
 */
export function gradeMetrics(metrics: PackMetrics): {
  evidenceCoverage: MetricLevel;
  groupRate       : MetricLevel;
  rejectRate      : MetricLevel;
} {
  return {
    // 一半以上的别名在原文找不到出处 → 模型明显在编。
    evidenceCoverage:
      metrics.evidenceCoverage < 0.5 ? "bad" : metrics.evidenceCoverage < 0.75 ? "warn" : "good",
    // 进组率两头都可能有问题：太低是漏并（同一人拆成多实体），
    // 太高是过度合并（把不同的人并成一人，比漏并更难发现）。
    // 上限取 70%：实测红楼 10 回用全文校验后是 36%，属正常（古典小说一人多称）。
    groupRate:
      metrics.groupRate < 0.01
        ? "bad"
        : metrics.groupRate < 0.03 || metrics.groupRate > 0.7
          ? "warn"
          : "good",
    // 两头都可能有问题：拒太多说明把真人物筛掉了，拒太少说明没在筛。
    rejectRate:
      metrics.rejectRate > 0.8 || metrics.rejectRate < 0.05 ? "warn" : "good"
  };
}

/** 指标的中文名与说明（页面直接用）。 */
export const METRIC_LABELS: Record<"evidenceCoverage" | "groupRate" | "rejectRate", {
  label: string;
  hint : string;
}> = {
  evidenceCoverage: {
    label: "证据覆盖率",
    hint : "别名里能在原文片段找到出处的比例。低说明模型在编造写法。"
  },
  groupRate: {
    label: "进组率",
    hint : "进入别名组的人名占候选的比例。低说明漏并，同一人会被拆成多个实体。"
  },
  rejectRate: {
    label: "拒绝率",
    hint : "被判「不是人物」的候选占比。过高会筛掉真人物，过低说明没在筛泛称。"
  }
};
