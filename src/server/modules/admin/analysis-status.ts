import "server-only";

import { desc, eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { analysisRuns, books } from "@/server/db/schema";
import {
  ANALYSIS_PROGRESS_STAGES,
  STALE_RUN_MS,
  type AnalysisProgressStage
} from "@/server/modules/analysis/progress";
import { resolveSearchProvider } from "@/server/modules/knowledge/search-provider";

/**
 * 后台「解析进度」查询。
 *
 * 数据源是 `analysis_runs` 的进度列（由子进程内的 `createProgressReporter` 写入），
 * 不额外建表：一次运行只有一条进度，分表只会多一次 join 与一套生命周期。
 */

/** 阶段中文名（UI 直接消费；键集合由契约测试钉住 `ANALYSIS_PROGRESS_STAGES`）。 */
export const ANALYSIS_STAGE_LABELS: Record<AnalysisProgressStage, string> = {
  queued     : "排队中",
  dictionary : "词典分析",
  extract    : "分片提取",
  grounding  : "证据校验",
  vote       : "关系投票",
  merge      : "实体归并",
  aggregate  : "关系聚合",
  done       : "完成"
};

/**
 * 计算百分比（纯函数，可单测）。
 *
 * 分段口径：
 * - `dictionary` 阶段还不知道分片总数 → 给 2% 的「已启动」信号；
 * - `extract` 占 2%–95%：它是唯一的长阶段（占成本 93.7%），进度条必须主要由它驱动；
 * - 之后的 P2/P4/P5/P6 都很快，合起来 95%–100%。
 *
 * 为什么不留到「done 才 100%」：P2 之后若停在 95% 不动，用户会以为卡住。
 *
 * @param stage 当前阶段
 * @param done 已完成分片数
 * @param total 分片总数
 * @returns 0–100 的整数
 */
export function computeAnalysisPercent(
  stage: AnalysisProgressStage | null,
  done: number,
  total: number
): number {
  if (stage === null) return 0;
  if (stage === "done") return 100;
  if (stage === "queued") return 0;
  if (stage === "dictionary") return total > 0 ? 2 : 1;
  if (stage === "extract") {
    if (total <= 0) return 2;
    const ratio = Math.min(1, Math.max(0, done / total));
    return Math.round(2 + ratio * 93);
  }
  // grounding / vote / merge / aggregate
  return 96;
}

/** 进度快照。 */
export interface AnalysisStatusSnapshot {
  bookStatus: string;
  /**
   * 是否配置了检索源。
   *
   * 用途：解析完成后面板要告诉用户「外部资料可能还在补」，而不是让他以为
   * 一个空的知识区就是最终结果。判定口径与执行器一致（同一个 `resolveSearchProvider`）。
   */
  knowledgeEnabled: boolean;
  run       : {
    id          : string;
    status      : string;
    stage       : AnalysisProgressStage | null;
    stageLabel  : string;
    slicesDone  : number;
    slicesTotal : number;
    percent     : number;
    startedAt   : string;
    finishedAt  : string | null;
    errorMessage: string | null;
    logPath     : string | null;
    /** 是否已被惰性看门狗判定为「卡死」。 */
    stale       : boolean;
  } | null;
}

/**
 * 读取某作品最近一次解析的进度快照。
 *
 * **惰性看门狗**：`running` 且 `started_at` 超过 `STALE_RUN_MS` 时，就地标记为
 * `failed` 再返回。为什么不用定时器：定时器只活在当前进程里，Web 一重启就没了；
 * 而「读的时候判一次」在任何一个进程里都成立。
 *
 * @param bookId 作品 ID
 * @returns 快照；作品不存在时返回 `null`
 */
export async function loadAnalysisStatus(bookId: string): Promise<AnalysisStatusSnapshot | null> {
  const db = getDatabase();

  const [bookRow] = await db
    .select({ status: books.status })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  if (bookRow === undefined) return null;

  const [run] = await db
    .select()
    .from(analysisRuns)
    .where(eq(analysisRuns.bookId, bookId))
    .orderBy(desc(analysisRuns.startedAt))
    .limit(1);

  const knowledgeEnabled = resolveSearchProvider(process.env) !== null;

  if (run === undefined) {
    return { bookStatus: bookRow.status, knowledgeEnabled, run: null };
  }

  let status = run.status;
  let errorMessage = run.errorMessage;
  let stale = false;

  if (status === "running" && Date.now() - run.startedAt.getTime() > STALE_RUN_MS) {
    stale = true;
    status = "failed";
    errorMessage = "解析超时（超过 30 分钟无完成记录），已标记失败。可能是服务重启中断，请重试。";
    await db
      .update(analysisRuns)
      .set({ status: "failed", finishedAt: new Date(), errorMessage })
      .where(eq(analysisRuns.id, run.id));
    await db.update(books).set({ status: "failed", updatedAt: new Date() }).where(eq(books.id, bookId));
  }

  const stage = isProgressStage(run.stage) ? run.stage : null;

  return {
    bookStatus: bookRow.status,
    knowledgeEnabled,
    run       : {
      id          : run.id,
      status,
      stage,
      stageLabel  : stage === null ? "—" : ANALYSIS_STAGE_LABELS[stage],
      slicesDone  : run.slicesDone,
      slicesTotal : run.slicesTotal,
      percent     : status === "succeeded" ? 100 : computeAnalysisPercent(stage, run.slicesDone, run.slicesTotal),
      startedAt   : run.startedAt.toISOString(),
      finishedAt  : run.finishedAt === null ? null : run.finishedAt.toISOString(),
      errorMessage,
      logPath     : run.logPath,
      stale
    }
  };
}

/** 类型守卫：库里存的是 `text`，读出来必须收敛回已知阶段。 */
export function isProgressStage(value: string | null): value is AnalysisProgressStage {
  if (value === null) return false;
  return (ANALYSIS_PROGRESS_STAGES as readonly string[]).includes(value);
}
