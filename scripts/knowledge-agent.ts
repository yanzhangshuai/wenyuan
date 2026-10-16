import { eq, sql } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { books, entities, entityAliases, entityMentions } from "@/server/db/schema";
import { callWithRetry, getModelSnapshot } from "@/server/modules/ai/client";
import { isHonorificForm } from "@/server/modules/analysis/pipeline/name-form";
import { hashSnapshot, loadKnowledgeKeys, upsertExternalKnowledge } from "@/server/modules/knowledge/repository";
import type { ExternalKnowledgeRecord } from "@/server/modules/knowledge/repository";
import { resolveSearchProvider } from "@/server/modules/knowledge/search-provider";
import { selectKnowledgeTargets } from "@/server/modules/knowledge/targets";
import type { KnowledgeTargetEntity } from "@/server/modules/knowledge/targets";
import {
  KNOWLEDGE_SYSTEM_PROMPT,
  buildKnowledgeUserPrompt,
  parseKnowledgeVerdict
} from "@/server/modules/knowledge/verdict";

/**
 * 知识增强 Agent（设计文档 §3.4「独立 Agent」）—— **离线、可回退、与解析管线解耦**。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/knowledge-agent.ts --book 儒林外史 --dry-run
 *   SEARCH_FIXTURE_DIR=knowledge-snapshots ... scripts/knowledge-agent.ts --book 儒林外史 --limit 5
 *
 * 环境变量（二选一）：
 *   SEARCH_API_URL + SEARCH_API_KEY   → HTTP JSON 检索（Serper/Tavily/Bing API/自建）
 *   SEARCH_FIXTURE_DIR                → 离线快照检索（测试 / 无网环境）
 *
 * 🚨 三条铁律：**不写图谱表**（只写 `external_knowledge`）· **不进评测口径** · **UI 分区**。
 * 🚨 未配置检索源时**显式报错退出**，绝不静默降级为「用模型记忆猜」——
 *    参数知识幻觉大且查不出出处（设计文档 §5.4 已否决）。
 */

interface CliOptions {
  bookTitle: string | null;
  limit    : number | null;
  dryRun   : boolean;
  /** 只跑指定规范名（试点/复核用）。 */
  subjects : string[] | null;
  /** 忽略缓存强制重跑（判定口径变更后必须能重跑，否则旧结论永远洗不掉）。 */
  force    : boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { bookTitle: null, limit: null, dryRun: false, subjects: null, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--book") options.bookTitle = argv[i + 1] ?? null;
    if (arg === "--limit") options.limit = Number(argv[i + 1] ?? "0") || null;
    if (arg === "--dry-run") options.dryRun = true;
    if (arg === "--force") options.force = true;
    if (arg === "--subject") {
      const list = (argv[i + 1] ?? "").split(",").map((name) => name.trim()).filter((name) => name.length > 0);
      options.subjects = list.length > 0 ? list : null;
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const provider = resolveSearchProvider(process.env);
  if (provider === null && !options.dryRun) {
    console.error("[knowledge-agent] 未配置检索源：请设置 SEARCH_API_URL + SEARCH_API_KEY（真实检索）");
    console.error("                   或 SEARCH_FIXTURE_DIR（离线快照）。不配置时不做任何检索。");
    process.exitCode = 2;
    return;
  }
  console.log(`[knowledge-agent] 检索器 = ${provider === null ? "(dry-run 未解析)" : provider.name}`);

  const db = getDatabase();
  const bookRows =
    options.bookTitle === null
      ? await db.select({ id: books.id, title: books.title }).from(books)
      : await db
          .select({ id: books.id, title: books.title })
          .from(books)
          .where(eq(books.title, options.bookTitle));
  if (bookRows.length === 0) {
    console.error(`[knowledge-agent] 找不到作品「${options.bookTitle ?? "(全部)"}」`);
    process.exitCode = 2;
    return;
  }

  let totalTargets = 0;
  let totalCalls = 0;
  let totalCost = 0;
  let resolved = 0;
  let disputed = 0;
  let unresolvable = 0;

  for (const book of bookRows) {
    const entityRows = await db
      .select({
        id       : entities.id,
        canonical: entities.canonical,
        type     : entities.type
      })
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

    // 提及数是触发档位的依据：按实体聚合，不把全量提及行拉进内存。
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

    const existingKeys = options.force ? new Set<string>() : await loadKnowledgeKeys(book.id);
    let targets = selectKnowledgeTargets({
      bookId   : book.id,
      bookTitle: book.title,
      entities : targetEntities,
      existingKeys
    });
    if (options.subjects !== null) {
      const wanted = new Set(options.subjects);
      targets = targets.filter((target) => wanted.has(target.subjectKey));
    }
    if (options.limit !== null) targets = targets.slice(0, options.limit);
    totalTargets += targets.length;

    console.log(`\n=== ${book.title}：触发 ${targets.length} 个对象（已跳过 ${existingKeys.size} 条已缓存） ===`);
    if (options.dryRun) {
      for (const target of targets.slice(0, 20)) {
        console.log(`   [${target.field}] ${target.subjectKey} — ${target.reason}`);
      }
      if (targets.length > 20) console.log(`   …其余 ${targets.length - 20} 个省略`);
      continue;
    }

    const snapshot = getModelSnapshot();
    const records: ExternalKnowledgeRecord[] = [];
    const searcher = provider;
    if (searcher === null) {
      console.error("[knowledge-agent] 内部错误：非 dry-run 分支下检索器为空");
      process.exitCode = 2;
      return;
    }
    for (const target of targets) {
      const result = await searcher.search(target.query, { limit: 5 });
      let verdict = parseKnowledgeVerdict("", result.hits);
      if (result.hits.length > 0) {
        const completion = await callWithRetry({
          model      : snapshot.extractModel,
          system     : KNOWLEDGE_SYSTEM_PROMPT,
          user       : buildKnowledgeUserPrompt(target, result.hits),
          temperature: 0,
          maxTokens  : 700
        });
        totalCalls += 1;
        totalCost += completion.usage.costUsd ?? 0;
        verdict = parseKnowledgeVerdict(completion.text, result.hits);
      }
      if (verdict.resolution === "resolved") resolved += 1;
      else if (verdict.resolution === "disputed") disputed += 1;
      else unresolvable += 1;

      records.push({
        bookId      : target.bookId,
        subjectType : target.subjectType,
        subjectKey  : target.subjectKey,
        field       : target.field,
        value       : verdict.value,
        resolution  : verdict.resolution,
        sourceUrls  : verdict.sourceUrls,
        snapshotHash: hashSnapshot(result.hits),
        confidence  : verdict.confidence,
        fetchedAt   : new Date()
      });
      console.log(
        `   ${target.subjectKey} [${target.field}] → ${verdict.resolution}/${verdict.confidence}` +
          `（命中 ${String(result.hits.length)}）${verdict.value === null ? "" : `：${verdict.value.slice(0, 40)}`}`
      );
    }
    const written = await upsertExternalKnowledge(records);
    console.log(`   [落库] ${String(written)} 条 → external_knowledge（图谱表未改动）`);
  }

  console.log(
    `\n[knowledge-agent] 汇总：触发 ${String(totalTargets)} · 模型调用 ${String(totalCalls)} 次 · ` +
      `成本 $${totalCost.toFixed(4)} · resolved ${String(resolved)} / disputed ${String(disputed)} / unresolvable ${String(unresolvable)}`
  );
}

await main();
