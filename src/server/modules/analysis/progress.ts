/**
 * 解析进度的**纯类型与常量**。
 *
 * 为什么单独成文件：`analysis-status.ts`（读侧）与 `analysis-progress.tsx`（UI）
 * 都只需要这几个定义，若直接从 `pipeline/run.ts` 取，会把整个管线（DB 客户端、
 * AI 客户端、分词器）拉进依赖图 —— 单测要为此付出启动成本，
 * 客户端组件更会因为误引服务端模块而直接构建失败。
 *
 * 本文件**不允许** import 任何模块。
 */

/**
 * 解析进度阶段。
 *
 * 与 `analysis_stage` 枚举的区别：多了 `queued`（尚未开始）与 `done`（全部完成），
 * 这两个是**运行生命周期**状态，不是 LLM 调用阶段，因此不塞进枚举。
 */
export const ANALYSIS_PROGRESS_STAGES = [
  "queued",
  "dictionary",
  "extract",
  "grounding",
  "vote",
  "merge",
  "aggregate",
  "done"
] as const;

export type AnalysisProgressStage = (typeof ANALYSIS_PROGRESS_STAGES)[number];

/** 一次进度快照。 */
export interface AnalysisProgress {
  /** 本次运行的 id（`analysis_runs.id`）。回调方据此定位要更新哪一行。 */
  runId      : string;
  stage      : AnalysisProgressStage;
  /** 已完成的 P1 分片数。 */
  slicesDone : number;
  /** 分片总数；`dictionary` 阶段结束前为 0（此时还不知道要切几片）。 */
  slicesTotal: number;
}
