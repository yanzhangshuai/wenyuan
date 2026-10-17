import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { books, entities, entityAliases, entityMentions } from "@/server/db/schema";
import { ensureEnvLoaded } from "@/server/env";
import { callWithRetry, getModelSnapshot } from "@/server/modules/ai/client";
import { isHonorificForm } from "@/server/modules/analysis/pipeline/name-form";

import { upsertExternalKnowledge, loadKnowledgeKeys } from "./repository";
import type { ExternalKnowledgeRecord } from "./repository";
import { SearchUnavailableError, resolveSearchProvider } from "./search-provider";
import { hashSnapshot as snapshotHashOf } from "./snapshot";
import { selectKnowledgeTargets } from "./targets";
import type { KnowledgeTargetEntity } from "./targets";
import { KNOWLEDGE_SYSTEM_PROMPT, buildKnowledgeUserPrompt, parseKnowledgeVerdict } from "./verdict";

/**
 * 判定层运行器（设计文档 §3.4「独立 Agent」的可复用入口）。
 *
 * 两种调用方式，**同一份实现**：
 * 1. `scripts/knowledge-agent.ts`（独立 CLI，`--book/--subject/--limit/--dry-run/--force`）；
 * 2. `scripts/analyze.ts --with-knowledge`（解析完成后的后置钩子）。
 *
 * ## 为什么钩子只做「流程编排」而不动数据路径
 * 后置钩子让「解析 + 补外部资料」在**用户视角是一条命令**，
 * 但数据仍分两处：图谱（原文的忠实投影）+ `external_knowledge`（外部标注，独立表、可删可退）。
 * 合并数据路径会同时失去成本可预测、$0 预演、可回退与**尺子有效性**（评测读图谱，
 * 一旦混入外部资料，实体 F1 就不再度量解析质量）。
 *
 * ## 未配置检索源时的行为
 * `requireProvider: true`（独立 CLI）→ 报错退出；
 * `requireProvider: false`（解析后钩子）→ **不报错**，返回 `skippedReason`
 * —— 解析本身已成功，增强步骤失败不得改变解析的成功语义。
 */

export interface KnowledgeRunOptions {
  bookId?         : string | null;
  bookTitle?      : string | null;
  subjects?       : string[] | null;
  limit?          : number | null;
  dryRun?         : boolean;
  force?          : boolean;
  /** 未配置检索源时是否视为错误（CLI 用 true；解析后钩子用 false）。 */
  requireProvider?: boolean;
}

export interface KnowledgeRunSummary {
  /** 非 null 表示本次**未实际执行**及原因。 */
  skippedReason: string | null;
  providerName : string | null;
  bookTitles   : string[];
  targets      : number;
  calls        : number;
  costUsd      : number;
  resolved     : number;
  disputed     : number;
  unresolvable : number;
  written      : number;
  /** 未检索（如快照缺失）而被跳过的对象数 —— **不计入 unresolvable**。 */
  skippedSearch: number;
}

const EMPTY: Omit<KnowledgeRunSummary, "skippedReason" | "providerName"> = {
  bookTitles   : [],
  targets      : 0,
  calls        : 0,
  costUsd      : 0,
  resolved     : 0,
  disputed     : 0,
  unresolvable : 0,
  written      : 0,
  skippedSearch: 0
};

export async function runKnowledgeAgent(options: KnowledgeRunOptions = {}): Promise<KnowledgeRunSummary> {
  // 🚨 必须先加载 `.env` 再读检索源配置：`getServerEnv()` 是惰性的（首次连库才触发），
  // 而这里要**先**判断检索源、**后**才连库 —— 否则写在 `.env` 里的 SEARCH_API_KEY 读不到，
  // 会报出误导性的「未配置检索源」（批 92 实测）。
  ensureEnvLoaded();

  const provider = resolveSearchProvider(process.env);
  if (provider === null && options.dryRun !== true) {
    const reason = "未配置检索源（SEARCH_API_URL + SEARCH_API_KEY 或 SEARCH_FIXTURE_DIR）";
    if (options.requireProvider === true) {
      throw new Error(`[knowledge-agent] ${reason}`);
    }
    return { ...EMPTY, skippedReason: reason, providerName: null };
  }

  const db = getDatabase();
  const bookRows =
    options.bookId !== null && options.bookId !== undefined
      ? await db.select({ id: books.id, title: books.title }).from(books).where(eq(books.id, options.bookId))
      : options.bookTitle !== null && options.bookTitle !== undefined
        ? await db.select({ id: books.id, title: books.title }).from(books).where(eq(books.title, options.bookTitle))
        : await db.select({ id: books.id, title: books.title }).from(books);

  const summary: KnowledgeRunSummary = {
    ...EMPTY,
    skippedReason: null,
    providerName : provider === null ? null : provider.name,
    bookTitles   : bookRows.map((row) => row.title)
  };

  for (const book of bookRows) {
    const entityRows = await db
      .select({ id: entities.id, canonical: entities.canonical, type: entities.type })
      .from(entities)
      .where(eq(entities.bookId, book.id));

    const aliasRows = await db
      .select({ entityId: entityAliases.entityId })
      .from(entityAliases)
      .where(eq(entityAliases.bookId, book.id));
    const aliasCounts = new Map<string, number>();
    for (const row of aliasRows) {
      aliasCounts.set(row.entityId, (aliasCounts.get(row.entityId) ?? 0) + 1);
    }

    const mentionRows = await db
      .select({ entityId: entityMentions.entityId, n: sql<number>`count(*)::int` })
      .from(entityMentions)
      .innerJoin(entities, eq(entityMentions.entityId, entities.id))
      .where(eq(entities.bookId, book.id))
      .groupBy(entityMentions.entityId);
    const mentionCounts = new Map<string, number>();
    for (const row of mentionRows) {
      mentionCounts.set(row.entityId, row.n);
    }

    const targetEntities: KnowledgeTargetEntity[] = entityRows.map((row) => ({
      id           : row.id,
      canonical    : row.canonical,
      type         : row.type,
      mentionCount : mentionCounts.get(row.id) ?? 0,
      aliasCount   : aliasCounts.get(row.id) ?? 0,
      honorificForm: isHonorificForm(row.canonical)
    }));

    const existingKeys = options.force === true ? new Set<string>() : await loadKnowledgeKeys(book.id);
    let targets = selectKnowledgeTargets({
      bookId   : book.id,
      bookTitle: book.title,
      entities : targetEntities,
      existingKeys
    });
    if (options.subjects !== null && options.subjects !== undefined) {
      const wanted = new Set(options.subjects);
      targets = targets.filter((target) => wanted.has(target.subjectKey));
    }
    if (options.limit !== null && options.limit !== undefined) {
      targets = targets.slice(0, options.limit);
    }
    summary.targets += targets.length;

    console.log(`\n=== ${book.title}：触发 ${String(targets.length)} 个对象（已跳过 ${String(existingKeys.size)} 条已缓存） ===`);
    if (options.dryRun === true) {
      for (const target of targets.slice(0, 20)) {
        console.log(`   [${target.field}] ${target.subjectKey} — ${target.reason}`);
      }
      if (targets.length > 20) console.log(`   …其余 ${String(targets.length - 20)} 个省略`);
      continue;
    }

    const searcher = provider;
    if (searcher === null) {
      // dry-run 分支才会到这里；非 dry-run 已在函数入口处理。
      continue;
    }

    const snapshot = getModelSnapshot();
    const records: ExternalKnowledgeRecord[] = [];
    for (const target of targets) {
      let result;
      try {
        result = await searcher.search(target.query, { limit: 5 });
      } catch (error) {
        if (error instanceof SearchUnavailableError) {
          // 未检索 → 跳过且**不落库**（否则会把「没搜过」记成「查不到」，污染缓存）。
          summary.skippedSearch += 1;
          console.log(`   ${target.subjectKey} [${target.field}] → 跳过（未检索）`);
          continue;
        }
        throw error;
      }
      let verdict = parseKnowledgeVerdict("", result.hits);
      if (result.hits.length > 0) {
        const completion = await callWithRetry({
          model      : snapshot.extractModel,
          system     : KNOWLEDGE_SYSTEM_PROMPT,
          user       : buildKnowledgeUserPrompt(target, result.hits),
          temperature: 0,
          maxTokens  : 700
        });
        summary.calls += 1;
        summary.costUsd += completion.usage.costUsd ?? 0;
        verdict = parseKnowledgeVerdict(completion.text, result.hits);
      }
      if (verdict.resolution === "resolved") summary.resolved += 1;
      else if (verdict.resolution === "disputed") summary.disputed += 1;
      else summary.unresolvable += 1;

      records.push({
        bookId      : target.bookId,
        subjectType : target.subjectType,
        subjectKey  : target.subjectKey,
        field       : target.field,
        value       : verdict.value,
        resolution  : verdict.resolution,
        sourceUrls  : verdict.sourceUrls,
        snapshotHash: snapshotHashOf(result.hits),
        confidence  : verdict.confidence,
        fetchedAt   : new Date()
      });
      console.log(
        `   ${target.subjectKey} [${target.field}] → ${verdict.resolution}/${verdict.confidence}` +
          `（命中 ${String(result.hits.length)}）${verdict.value === null ? "" : `：${verdict.value.slice(0, 40)}`}`
      );
    }
    summary.written += await upsertExternalKnowledge(records);
    console.log(`   [落库] ${String(records.length)} 条 → external_knowledge（图谱表未改动）`);
  }

  return summary;
}
