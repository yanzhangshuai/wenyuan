"use client";

import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { AnalysisStatusSnapshot } from "@/server/modules/admin/analysis-status";

/**
 * 解析进度面板（Client Component）。
 *
 * 数据来自 `GET /api/admin/books/[id]/status`，2s 轮询。
 *
 * ## 为什么用轮询而不是 SSE
 * 一次解析 3–8 分钟、每 2s 一次请求，总共约 100–240 次小请求；
 * 换成 SSE 要处理连接保活、代理缓冲、重连补偿，收益不抵复杂度。
 *
 * ## 轮询何时停
 * - 进入终态（succeeded / failed / canceled）立刻停；
 * - `run === null`（子进程还没建出 run）时**继续等**，但有 3 分钟上限 ——
 *   否则入队失败会让面板永远转圈。
 */

/** 轮询间隔。 */
const POLL_INTERVAL_MS = 2000;

/** 等待 run 出现的上限（毫秒）。 */
const WAIT_FOR_RUN_MS = 3 * 60 * 1000;

/** 整个面板的轮询上限（毫秒），防止异常状态下无限请求。 */
const MAX_POLL_MS = 40 * 60 * 1000;

export interface AnalysisProgressPanelProps {
  bookId: string;
  /** 首屏快照（详情页由服务端传入，避免闪一下空白）。 */
  initial?: AnalysisStatusSnapshot | null;
  /** 进入终态时的回调（导入页用它切到结果态）。 */
  onSettled?: (snapshot: AnalysisStatusSnapshot) => void;
  className?: string;
}

/** 把毫秒格式化成「N 分 M 秒」。 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${String(seconds)} 秒`;
  return `${String(minutes)} 分 ${String(seconds)} 秒`;
}

export function AnalysisProgressPanel({
  bookId,
  initial = null,
  onSettled,
  className
}: AnalysisProgressPanelProps) {
  const [snapshot, setSnapshot] = useState<AnalysisStatusSnapshot | null>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  /** 已通知过的 runId：避免每次轮询都触发一次 onSettled。 */
  const notifiedRunId = useRef<string | null>(null);

  const fetchStatus = useCallback(async (): Promise<AnalysisStatusSnapshot | null> => {
    try {
      const response = await fetch(`/api/admin/books/${bookId}/status`, { cache: "no-store" });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        ok?      : boolean;
        snapshot?: AnalysisStatusSnapshot;
      };
      if (payload.ok !== true || payload.snapshot === undefined) return null;
      setSnapshot(payload.snapshot);
      return payload.snapshot;
    } catch {
      // 轮询失败静默重试：短暂网络抖动不该把面板打成错误态。
      return null;
    }
  }, [bookId]);

  // 首次挂载就拉一次：导入页没有 initial，靠这一次把 run 拉出来。
  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const run = snapshot?.run ?? null;
  const isTerminal = run !== null && run.status !== "running";

  // 轮询主循环：终态即停；run 未出现时最多等 WAIT_FOR_RUN_MS。
  useEffect(() => {
    if (isTerminal) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed > MAX_POLL_MS) return;
      void fetchStatus();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [fetchStatus, isTerminal]);

  // 计时器：只为了显示「已用 1 分 12 秒」，不影响数据。
  useEffect(() => {
    if (isTerminal) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [isTerminal]);

  // 进入终态时通知外部（同一个 run 只通知一次）。
  useEffect(() => {
    if (snapshot === null || run === null) return;
    if (run.status === "running") return;
    if (notifiedRunId.current === run.id) return;
    notifiedRunId.current = run.id;
    onSettled?.(snapshot);
  }, [onSettled, run, snapshot]);

  async function handleRetry(): Promise<void> {
    setIsRetrying(true);
    setRetryError("");
    try {
      const response = await fetch(`/api/admin/books/${bookId}/analyze`, { method: "POST" });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok !== true) {
        setRetryError(payload.message ?? "重新解析失败");
        return;
      }
      // 重置成「等待子进程启动」态：bookStatus 必须是 pending，
      // 否则面板会因为「没有 run + 不是 pending」立刻退回「未解析」。
      setSnapshot({ bookStatus: "pending", run: null });
    } catch {
      setRetryError("网络异常，重新解析未提交");
    } finally {
      setIsRetrying(false);
    }
  }

  // run 还没建出来：要么刚入队等子进程启动，要么这本书从来没解析过。
  if (run === null) {
    const waitingForRun = snapshot === null || snapshot.bookStatus === "pending" || snapshot.bookStatus === "parsing";
    if (!waitingForRun) {
      return (
        <div className={cn("rounded-lg border border-dashed p-4", className)}>
          <p className="text-sm font-medium">这本书还没有解析记录</p>
          <p className="text-muted-foreground mt-1 text-xs">
            解析会调用模型抽取人物与关系，一次约 $0.21–0.66。
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 gap-2"
            onClick={() => {
              void handleRetry();
            }}
            disabled={isRetrying}
          >
            <RefreshCw className={cn("h-4 w-4", isRetrying && "animate-spin")} />
            开始解析
          </Button>
          {retryError ? <p className="text-destructive mt-2 text-xs">{retryError}</p> : null}
        </div>
      );
    }

    const waitedTooLong = now - mountedAt > WAIT_FOR_RUN_MS;
    return (
      <div className={cn("rounded-lg border p-4", className)}>
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          <span>{waitedTooLong ? "解析尚未启动（等待超时）" : "解析任务已排队，正在启动…"}</span>
        </div>
        {waitedTooLong ? (
          <p className="text-muted-foreground mt-2 text-xs">
            子进程可能启动失败。请查看服务器日志，或点击下方重试。
          </p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="mt-3 gap-2"
          onClick={() => {
            void handleRetry();
          }}
          disabled={isRetrying}
        >
          <RefreshCw className={cn("h-4 w-4", isRetrying && "animate-spin")} />
          重新解析
        </Button>
        {retryError ? <p className="text-destructive mt-2 text-xs">{retryError}</p> : null}
      </div>
    );
  }

  const elapsed = formatElapsed((run.finishedAt === null ? now : Date.parse(run.finishedAt)) - Date.parse(run.startedAt));

  if (run.status === "succeeded") {
    return (
      <div className={cn("rounded-lg border p-4", className)}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          解析完成
          <span className="text-muted-foreground font-normal">用时 {elapsed}</span>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          共 {run.slicesTotal} 个分片。图谱已更新，可打开详情查看实体与关系。
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={`/admin/books/${bookId}`}>查看书籍详情 →</Link>
        </Button>
      </div>
    );
  }

  if (run.status === "failed" || run.status === "canceled") {
    return (
      <div className={cn("border-destructive/40 bg-destructive/5 rounded-lg border p-4", className)}>
        <div className="text-destructive flex items-center gap-2 text-sm font-medium">
          <XCircle className="h-4 w-4" />
          {run.status === "canceled" ? "解析已取消" : "解析失败"}
        </div>
        {run.errorMessage === null ? null : (
          <pre className="text-muted-foreground mt-2 max-h-32 overflow-auto text-xs whitespace-pre-wrap">
            {run.errorMessage}
          </pre>
        )}
        {run.logPath === null ? null : (
          <p className="text-muted-foreground mt-2 text-xs">完整日志：{run.logPath}</p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-3 gap-2"
          onClick={() => {
            void handleRetry();
          }}
          disabled={isRetrying}
        >
          <RefreshCw className={cn("h-4 w-4", isRetrying && "animate-spin")} />
          重试解析
        </Button>
        {retryError ? <p className="text-destructive mt-2 text-xs">{retryError}</p> : null}
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border p-4", className)}>
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Loader2 className="text-primary h-4 w-4 animate-spin" />
          {run.stageLabel}
        </span>
        <span className="text-muted-foreground tabular-nums">{run.percent}%</span>
      </div>
      <Progress value={run.percent} className="mt-2" />
      <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs tabular-nums">
        <span>
          {run.slicesTotal > 0
            ? `已处理 ${String(run.slicesDone)} / ${String(run.slicesTotal)} 片`
            : "正在切分章节…"}
        </span>
        <span>已用 {elapsed}</span>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        解析是付费任务，请保持页面打开或稍后回到书籍列表查看进度。
      </p>
    </div>
  );
}
