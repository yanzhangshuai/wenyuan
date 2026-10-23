import "server-only";

import { eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { analysisRuns } from "@/server/db/schema";

import type { AnalysisProgress } from "./pipeline/run";

/**
 * 进度上报器（写 `analysis_runs` 的进度列）。
 *
 * 为什么放在服务端模块而不是脚本里：`scripts/analyze.ts` 与未来的其它执行器
 * 都要用同一套节流与单调规则；写在脚本里就等于把口径复制一份。
 *
 * ## 三条必须守住的规则
 * 1. **节流**：P1 每片都上报，180 片若每片一次 UPDATE 会变成 180 次写库。
 *    这里按「阶段变化立即写 / 同阶段 ≥1.2s 写一次」收敛，最后一个阶段强制写。
 * 2. **单调**：章与章并行执行，完成顺序不等于分片序号；`slicesDone` 只允许增大。
 *    否则进度条会来回跳。
 * 3. **不写 status**：`status` 由管线自己维护（succeeded/failed），
 *    进度器只碰 `stage / slices_done / slices_total`，避免两个写者争同一列。
 */

/** 同阶段内的最小写库间隔。 */
const MIN_INTERVAL_MS = 1200;

/**
 * 创建进度上报函数。
 *
 * 返回的函数可直接作为 `runPipeline({ onProgress })` 使用。
 * 内部状态是每次调用独立的，多个 run 并发也不会互相影响。
 */
export function createProgressReporter(): (progress: AnalysisProgress) => Promise<void> {
  let lastWrittenAt = 0;
  let lastStage = "";
  let lastDone = -1;

  return async (progress: AnalysisProgress): Promise<void> => {
    // 单调：完成数不允许回退（并行章的完成顺序是乱的）。
    if (progress.slicesDone < lastDone) return;

    const now = Date.now();
    const stageChanged = progress.stage !== lastStage;
    const isTerminal = progress.stage === "done";
    const elapsedEnough = now - lastWrittenAt >= MIN_INTERVAL_MS;

    if (!stageChanged && !isTerminal && !elapsedEnough) return;

    lastWrittenAt = now;
    lastStage = progress.stage;
    lastDone = progress.slicesDone;

    const db = getDatabase();
    await db
      .update(analysisRuns)
      .set({
        stage      : progress.stage,
        slicesDone : progress.slicesDone,
        slicesTotal: progress.slicesTotal
      })
      .where(eq(analysisRuns.id, progress.runId));
  };
}
