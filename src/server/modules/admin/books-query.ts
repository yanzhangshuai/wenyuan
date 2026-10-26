import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import {
  analysisCalls,
  analysisRuns,
  books,
  chapters,
  entities,
  entityAliases,
  relationships
} from "@/server/db/schema";
import { computeAnalysisPercent, isProgressStage } from "@/server/modules/admin/analysis-status";

/**
 * 后台书籍查询（只读）。
 *
 * ## 为什么用「分组聚合 + 内存合并」而不是关联子查询
 * drizzle 在 `sql` 模板里插入列引用时会**丢掉表限定**（`${books.id}` → `"id"`），
 * 于是 `(select count(*) from entities e where e.book_id = "id")` 里的 `"id"` 会解析到
 * **内层表**，计数恒为 0（批 94 实测踩到，且 tsc 与纯函数测试都发现不了）。
 * 改成「各表按 book_id 分组聚合 → 在内存里按键合并」，没有关联、没有歧义。
 *
 * 口径说明：
 * - 实体/关系计数按 `book_id` 直接统计，**不受切片影响**（与图谱页的裁剪视图不同）；
 * - 「最近一次解析」取 `analysis_runs.started_at` 最新的一条，成本为该 run 全部调用的累计值。
 */

/** 列表行。 */
export interface AdminBookRow {
  id            : string;
  title         : string;
  author        : string | null;
  status        : string;
  chapterCount  : number;
  entityCount   : number;
  relationCount : number;
  /** 最近一次解析的 runId（从未解析为 `null`）。 */
  lastRunId     : string | null;
  /** 最近一次解析的开始时间。 */
  lastRunAt     : Date | null;
  /** 最近一次解析的状态。 */
  lastRunStatus : string | null;
  /** 最近一次解析的成本（美元，字符串保留精度）。 */
  lastRunCostUsd: string | null;
  /** 最近一次解析的进度（列表里显示「解析中 62%」）。 */
  lastRunPercent: number;
}

/** 详情页：章节概要。 */
export interface AdminChapterRow {
  ordinal  : number;
  title    : string;
  charCount: number;
}

/** 详情页：解析运行记录。 */
export interface AdminRunRow {
  id           : string;
  status       : string;
  promptVersion: string;
  startedAt    : Date;
  finishedAt   : Date | null;
  costUsd      : string | null;
  callCount    : number;
}

/** 详情页数据。 */
export interface AdminBookDetail {
  book    : AdminBookRow;
  chapters: AdminChapterRow[];
  runs    : AdminRunRow[];
}

/**
 * 按 `book_id` 聚合计数。
 *
 * @param table `entities` 或 `relationships`
 * @returns bookId → 计数
 */
async function countByBook(
  table: typeof entities | typeof relationships
): Promise<Map<string, number>> {
  const db = getDatabase();
  const rows = await db
    .select({ bookId: table.bookId, count: sql<number>`count(*)::int` })
    .from(table)
    .groupBy(table.bookId);
  return new Map(rows.map((row) => [row.bookId, row.count]));
}

/**
 * 按 `run_id` 聚合调用数与成本。
 *
 * @returns runId → { calls, usd }
 */
async function costByRun(): Promise<Map<string, { calls: number; usd: string | null }>> {
  const db = getDatabase();
  const rows = await db
    .select({
      runId: analysisCalls.runId,
      calls: sql<number>`count(*)::int`,
      usd  : sql<string | null>`round(sum(${analysisCalls.costUsd}), 4)::text`
    })
    .from(analysisCalls)
    .groupBy(analysisCalls.runId);
  return new Map(rows.map((row) => [row.runId, { calls: row.calls, usd: row.usd }]));
}

/**
 * 列出全部作品（含计数与最近解析）。
 *
 * @returns 按创建时间倒序的作品行
 */
export async function listBooksForAdmin(): Promise<AdminBookRow[]> {
  const db = getDatabase();

  const [rows, entityCounts, relationCounts, runRows, runCosts] = await Promise.all([
    db
      .select({
        id          : books.id,
        title       : books.title,
        author      : books.author,
        status      : books.status,
        chapterCount: books.chapterCount,
        createdAt   : books.createdAt
      })
      .from(books)
      .orderBy(desc(books.createdAt)),
    countByBook(entities),
    countByBook(relationships),
    db
      .select({
        bookId     : analysisRuns.bookId,
        id         : analysisRuns.id,
        status     : analysisRuns.status,
        startedAt  : analysisRuns.startedAt,
        stage      : analysisRuns.stage,
        slicesDone : analysisRuns.slicesDone,
        slicesTotal: analysisRuns.slicesTotal
      })
      .from(analysisRuns)
      .orderBy(desc(analysisRuns.startedAt)),
    costByRun()
  ]);

  // run 数量很少（每本书几次），按开始时间倒序遍历后取每本书第一条即为「最近」。
  const latestRunByBook = new Map<string, (typeof runRows)[number]>();
  for (const run of runRows) {
    if (!latestRunByBook.has(run.bookId)) latestRunByBook.set(run.bookId, run);
  }

  return rows.map((row) => {
    const run = latestRunByBook.get(row.id);
    const cost = run === undefined ? undefined : runCosts.get(run.id);
    return {
      id            : row.id,
      title         : row.title,
      author        : row.author,
      status        : row.status,
      chapterCount  : row.chapterCount,
      entityCount   : entityCounts.get(row.id) ?? 0,
      relationCount : relationCounts.get(row.id) ?? 0,
      lastRunId     : run?.id ?? null,
      lastRunAt     : run?.startedAt ?? null,
      lastRunStatus : run?.status ?? null,
      lastRunCostUsd: cost?.usd ?? null,
      lastRunPercent:
        run === undefined
          ? 0
          : run.status === "succeeded"
            ? 100
            : computeAnalysisPercent(
                run.stage !== null && isProgressStage(run.stage) ? run.stage : null,
                run.slicesDone,
                run.slicesTotal
              )
    };
  });
}

/**
 * 读取单本作品详情。
 *
 * @param bookId 作品 id
 * @returns 详情；作品不存在时 `null`
 */
export async function loadBookDetail(bookId: string): Promise<AdminBookDetail | null> {
  const all = await listBooksForAdmin();
  const book = all.find((row) => row.id === bookId);
  if (book === undefined) return null;

  const db = getDatabase();
  const [chapterRows, runRows, runCosts] = await Promise.all([
    db
      .select({
        ordinal  : chapters.ordinal,
        title    : chapters.title,
        charCount: chapters.charCount
      })
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .orderBy(chapters.ordinal),
    db
      .select({
        id           : analysisRuns.id,
        status       : analysisRuns.status,
        promptVersion: analysisRuns.promptVersion,
        startedAt    : analysisRuns.startedAt,
        finishedAt   : analysisRuns.finishedAt
      })
      .from(analysisRuns)
      .where(eq(analysisRuns.bookId, bookId))
      .orderBy(desc(analysisRuns.startedAt)),
    costByRun()
  ]);

  return {
    book,
    chapters: chapterRows,
    runs    : runRows.map((run) => {
      const cost = runCosts.get(run.id);
      return {
        id           : run.id,
        status       : run.status,
        promptVersion: run.promptVersion,
        startedAt    : run.startedAt,
        finishedAt   : run.finishedAt,
        costUsd      : cost?.usd ?? null,
        callCount    : cost?.calls ?? 0
      };
    })
  };
}

/**
 * 别名体检：找出「别名特别多」的实体。
 *
 * ## 为什么这是个有效的错并信号
 *
 * 一个角色通常有 2–4 个称呼。别名数达到 6 以上时，大概率混进了：
 * - **泛称**（实测儒林的 `姑丈` 收了 7 个、红楼的 `二姨` 收了 12 个 —— 这两个根本不是个体）；
 * - **别人的称谓**（实测 `鲍廷玺` 的别名含 `姑丈人`/`姑太爷`）。
 *
 * 图上找错并几乎不可能（767 个节点），但按别名数排序，前十行就能看出问题。
 * 这也是「导出 CSV」的意外价值 —— 卡片只是把它做进了页面。
 */
export interface AliasAuditRow {
  entityId : string;
  canonical: string;
  type     : string;
  aliases  : string[];
}

/**
 * 读取别名最多的若干个实体。
 *
 * @param bookId 作品 id
 * @param limit 返回条数（默认 10）
 * @param minAliases 最低别名数（默认 5 —— 低于这个数基本都是正常的多称呼）
 */
export async function loadAliasAudit(
  bookId: string,
  limit = 10,
  minAliases = 5
): Promise<AliasAuditRow[]> {
  const db = getDatabase();
  const rows = await db
    .select({
      entityId : entities.id,
      canonical: entities.canonical,
      type     : entities.type,
      aliases  : sql<string[]>`array_agg(${entityAliases.alias} order by ${entityAliases.alias})`
    })
    .from(entities)
    .innerJoin(entityAliases, eq(entityAliases.entityId, entities.id))
    .where(eq(entities.bookId, bookId))
    .groupBy(entities.id, entities.canonical, entities.type)
    .having(sql`count(${entityAliases.alias}) >= ${minAliases}`)
    .orderBy(sql`count(${entityAliases.alias}) desc`)
    .limit(limit);

  return rows.map((row) => ({
    entityId : row.entityId,
    canonical: row.canonical,
    type     : row.type,
    aliases  : row.aliases
  }));
}
