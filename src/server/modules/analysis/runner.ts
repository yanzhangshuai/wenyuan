import "server-only";

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { desc, eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { analysisRuns, books } from "@/server/db/schema";
import { resolveSearchProvider } from "@/server/modules/knowledge/search-provider";

import { STALE_RUN_MS } from "./progress";

export { STALE_RUN_MS };

/**
 * 解析执行器：把「导入后自动解析」落成**独立子进程 + 进程内串行队列**。
 *
 * ## 为什么是子进程
 * 解析一次 3–8 分钟、$0.21–0.66。若在 Web 进程内 `void runPipeline()`：
 * - dev 热更新、服务重启、部署都会让任务停在 `running`；
 * - 无法限制并发（多个请求各自开跑，成本叠加、撞模型限流）；
 * - 任务异常会污染 Web 进程。
 *
 * 子进程把生命周期与 Web 解耦：Web 只负责「派活 + 收尸」。
 *
 * ## 为什么复用 `scripts/analyze.ts`
 * 那个脚本已经承载了「失败不落库」「预算超限中止」「N20 质量闸门」等既有语义，
 * 另写一份执行器等于把控制流复制一遍，必然漂移。
 *
 * ## 队列的边界（必须说清楚）
 * 队列在**进程内存**里：进程重启后队列丢失，正在跑的子进程仍会继续（它独立）。
 * 因此重启后可能出现「DB 里有一条 running，但没有队列」的状态 —— 由
 * `STALE_RUN_MS` 的惰性看门狗在读取状态时判定为失败，而不是靠定时器。
 */

/** 队列上限：超过就拒绝，避免一次拖入大量付费任务。 */
const MAX_QUEUE_LENGTH = 10;

/** 入队结果。 */
export interface EnqueueResult {
  /** 是否真的进了队列。 */
  queued  : boolean;
  /** 队列中的位置（1 表示下一个跑）；未入队为 0。 */
  position: number;
  /** 未入队的原因（`already_running` / `queue_full`）。 */
  reason  : "already_running" | "queue_full" | null;
}

/** 队列状态（模块级；dev 的 HMR 可能重置，见文件头）。 */
const queue: string[] = [];
let pumping = false;

/**
 * 把一本书排进解析队列。
 *
 * 去重口径：该作品存在 `status = running` 且未超时的 run → 直接返回 `already_running`。
 * 用 DB 而不是内存判断，是为了让「Web 重启后队列空了但 run 还在跑」也不会重复派活。
 */
export async function enqueueAnalysis(bookId: string): Promise<EnqueueResult> {
  const db = getDatabase();
  const [latest] = await db
    .select({ id: analysisRuns.id, status: analysisRuns.status, startedAt: analysisRuns.startedAt })
    .from(analysisRuns)
    .where(eq(analysisRuns.bookId, bookId))
    .orderBy(desc(analysisRuns.startedAt))
    .limit(1);

  if (
    latest !== undefined &&
    latest.status === "running" &&
    Date.now() - latest.startedAt.getTime() < STALE_RUN_MS
  ) {
    return { queued: false, position: 0, reason: "already_running" };
  }

  if (queue.length >= MAX_QUEUE_LENGTH) {
    return { queued: false, position: 0, reason: "queue_full" };
  }

  // 同一本书已经在队列里排队 → 不重复入队。
  if (queue.includes(bookId)) {
    return { queued: false, position: queue.indexOf(bookId) + 1, reason: "already_running" };
  }

  queue.push(bookId);
  const position = queue.length;

  // 入队即置 `parsing`：导入函数在结尾会把 `books.status` 写成 `ready`（表示文本已就绪），
  // 而子进程要 1–2 秒才建出 run。若不在这里改状态，这段时间页面会显示
  // 「这本书还没有解析记录」—— 明明刚导入并已排队。
  await db.update(books).set({ status: "parsing", updatedAt: new Date() }).where(eq(books.id, bookId));

  void pump();
  return { queued: true, position, reason: null };
}

/** 队列消费者：严格串行，一个跑完再跑下一个。 */
async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const bookId = queue.shift();
      if (bookId === undefined) return;
      await runChild(bookId);
    }
  } finally {
    pumping = false;
  }
}

/** 子进程日志目录（相对仓库根）。 */
const LOG_DIR = "logs";

/**
 * 解析 tsx 的可执行入口。
 *
 * 为什么不用 `pnpm analyze`：多一层 shell / pnpm 进程，退出码与信号会被吞；
 * 直接 `node cli.mjs` 的退出码就是解析脚本的退出码。
 */
function resolveTsxCli(): string | null {
  const candidate = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  return existsSync(candidate) ? candidate : null;
}

/** 启动一次子进程解析，等它退出。 */
async function runChild(bookId: string): Promise<void> {
  const db = getDatabase();
  const tsxCli = resolveTsxCli();
  if (tsxCli === null) {
    await markLatestRunFailed(bookId, "找不到 tsx（node_modules/tsx/dist/cli.mjs）；请确认依赖已安装");
    return;
  }

  const logDirAbs = path.join(process.cwd(), LOG_DIR);
  mkdirSync(logDirAbs, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const logRel = path.join(LOG_DIR, `analyze-${bookId.slice(0, 8)}-${stamp}.log`);
  const logAbs = path.join(process.cwd(), logRel);
  const logStream = createWriteStream(logAbs, { flags: "a" });

  // 只留尾部 4KB 进库：完整日志在文件里，库里的目的是「不用登录服务器也能看到原因」。
  let tail = "";
  const appendTail = (chunk: string): void => {
    tail = (tail + chunk).slice(-4096);
  };

  try {
    /**
     * 是否顺带跑三期判定层（外部资料补全）。
     *
     * 判定口径**直接复用** `resolveSearchProvider`，不另写一份「有没有配 key」的判断：
     * 两处口径一旦分叉，就会出现「传了 flag 但 provider 为 null」的静默空转。
     *
     * 没配检索源时不传 flag —— 语义等价（脚本里也是 `requireProvider: false` 直接跳过），
     * 但能少一行「已跳过」噪声，日志里「有没有真跑过检索」也更干净。
     */
    const withKnowledge = resolveSearchProvider(process.env) !== null;
    const args = [tsxCli, "--conditions=react-server", "scripts/analyze.ts", bookId];
    if (withKnowledge) args.push("--with-knowledge");
    logStream.write(`[runner] withKnowledge=${String(withKnowledge)}\n`);

    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        args,
        {
          cwd        : process.cwd(),
          stdio      : ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env        : process.env
        }
      );
      child.stdout.on("data", (data: Buffer) => {
        const text = data.toString("utf8");
        appendTail(text);
        logStream.write(text);
      });
      child.stderr.on("data", (data: Buffer) => {
        const text = data.toString("utf8");
        appendTail(text);
        logStream.write(text);
      });
      child.on("error", reject);
      child.on("close", (exitCode) => {
        resolve(exitCode ?? 1);
      });
    });

    if (code === 0) {
      await db.update(books).set({ status: "ready", updatedAt: new Date() }).where(eq(books.id, bookId));
      await updateLatestRun(bookId, { logPath: logRel });
      return;
    }

    await db.update(books).set({ status: "failed", updatedAt: new Date() }).where(eq(books.id, bookId));
    await markLatestRunFailed(bookId, tail.trim().length > 0 ? tail.trim() : `解析子进程退出码 ${String(code)}`, logRel);
  } catch (error) {
    await markLatestRunFailed(
      bookId,
      error instanceof Error ? error.message : String(error),
      logRel
    );
  } finally {
    logStream.end();
  }
}

/** 更新该作品最近一次 run 的指定字段。 */
async function updateLatestRun(
  bookId: string,
  values: Partial<{ logPath: string; errorMessage: string | null }>
): Promise<void> {
  const db = getDatabase();
  const [latest] = await db
    .select({ id: analysisRuns.id })
    .from(analysisRuns)
    .where(eq(analysisRuns.bookId, bookId))
    .orderBy(desc(analysisRuns.startedAt))
    .limit(1);
  if (latest === undefined) return;
  await db.update(analysisRuns).set(values).where(eq(analysisRuns.id, latest.id));
}

/** 把最近一次 run 标记为失败（状态 + 原因 + 日志路径）。 */
async function markLatestRunFailed(
  bookId: string,
  message: string,
  logPath?: string
): Promise<void> {
  const db = getDatabase();
  const [latest] = await db
    .select({ id: analysisRuns.id, status: analysisRuns.status })
    .from(analysisRuns)
    .where(eq(analysisRuns.bookId, bookId))
    .orderBy(desc(analysisRuns.startedAt))
    .limit(1);

  if (latest === undefined) {
    await db.update(books).set({ status: "failed", updatedAt: new Date() }).where(eq(books.id, bookId));
    return;
  }

  // 管线自己已经写成 failed 时保留它写的原因，只补日志路径。
  await db
    .update(analysisRuns)
    .set({
      status      : "failed",
      finishedAt  : new Date(),
      errorMessage: message,
      ...(logPath === undefined ? {} : { logPath })
    })
    .where(eq(analysisRuns.id, latest.id));

  await db.update(books).set({ status: "failed", updatedAt: new Date() }).where(eq(books.id, bookId));
}
