import "server-only";

import { eq } from "drizzle-orm";

import { SYMMETRIC_RELATION_CODES, resolveRelationCode } from "@/lib/relations";
import { normalizeName } from "@/lib/text";
import { getDatabase } from "@/server/db/client";
import {
  analysisCalls,
  analysisIssues,
  analysisRuns,
  chapters,
  paragraphs,
  books
} from "@/server/db/schema";
import {
  AiCallError,
  callWithRetry,
  getBudgetEnv,
  getModelSnapshot,
  type AiCompletionResult
} from "@/server/modules/ai/client";
import { FRONT_MATTER_ORDINAL } from "@/server/modules/importing/parse-text";

import { DEFAULT_GENRE_PACK, resolveWorkPack, type WorkPack } from "../genre-pack";
import {
  DictionaryResultSchema,
  SliceExtractionSchema,
  type EntityType,
  type ExtractedEntity,
  type ExtractedRelation,
  type SliceExtraction
} from "../schemas";


import { aggregateRelations, collapseByEntityTriple, type RelationObservation } from "./aggregate";
import { type CandidateName } from "./dictionary";
import { gateExtraction } from "./entity-gate";
import { buildGroundingIndex, groundEntities, groundRelations, type GroundingIndex } from "./grounding";
import { mergeEntities, type MergeCandidate } from "./merge";
import { buildMentionIndex, persistGraph, type PersistableRelation } from "./persist-graph";
import {
  DICTIONARY_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  MAX_ROLLING_NAMES,
  MAX_ROLLING_SUMMARY_CHARS,
  buildDictionaryUserPrompt,
  buildExtractionUserPrompt,
  type RollingContext
} from "./prompts";
import { repairTruncatedJson } from "./repair-json";
import { sliceChapter } from "./slice";
import { scanBookCandidates } from "./tokenizer";
import { voteRelations } from "./vote";

/**
 * 解析管线编排（P0 → P6）。
 *
 * 阶段划分与职责：
 * - **P0 词典**：全书分词预扫描 → 高频专名清单 →（可选）小模型分类过滤
 * - **P1 提取**：按重叠分片逐片调用模型，输出实体与关系
 * - **P2 grounding**：零 LLM 的字面证据校验，剔除幻觉
 * - **P3 二审**：⛔ **已于 2026-10-10 删除** —— 见下方「为什么没有 P3」
 * - **P4 投票**：关系码归一化、去重、对称合并、类型投票
 * - **P5 归并**：Union-Find 合并别名，输出「键 → 实体」映射
 * - **P6 聚合**：压缩为带有效期的关系记录
 *
 * 设计约束：
 * - 每一步的产出都会写入 `analysis_calls` / `analysis_issues`，
 *   使「为什么这条关系消失了」这类问题可以事后归因；
 * - 预算超限时**主动中止**而非静默截断，避免产出半成品图谱。
 *
 * ── 为什么没有 P3（2026-10-10 实测后删除）──
 * 原 P3 二审把**全部实体名**拼成一个清单**一次**调用，而提示词要求
 * 「对每个实体回答三件事」→ 输出体量 **O(名字数)**。实测《儒林外史》908 名、
 * 《红楼梦》1002 名，而 `maxTokens = 8192` → **输出 token 恰好撞上限 8192**
 * （两次运行都精确等于 8192）→ JSON 被截断 → `review_parse_failed`
 * → 函数**原样返回实体**。
 *
 * 也就是说：**P3 在真实语料上 100% 空转**（历史上从未成功过一次），
 * 只白付 1 次调用 + 8192 输出 token（占成本 1.7%～4.6%）。
 * 更严重的是架构文档一直把它算作「三层校验」的一层，而它从未生效。
 *
 * 因此这里**删除调用**，而不是留着一个永远失败的阶段：
 * - 对当前两本语料，产出**逐字节不变**（因为它本来就没改变任何实体）；
 * - 顺带把「3 个 LLM 调用点」变成 **2 个**（`dictionary` / `extract`），
 *   这个数字是控制流指纹的一部分（`verify/_wb_controlflow_diff.py`），
 *   改动它必须是一次被看见的动作。
 *
 * ⚠️ 若将来要让二审**真正生效**，正确做法是**分批**（把名字切成 N 份，
 * 每份 ≤ 数百名），但那是**改变图谱**的改动，必须与一次重跑 analyze 绑定、
 * 且**单独成批**（与 N1/N2/N16 混在一起会导致 F1 变化无法归因）。
 * 届时应连同 `ReviewResultSchema` / `buildReviewUserPrompt` / 题材包的
 * `reviewSystem` 一起恢复 —— 它们已随本次删除一并移除。
 */

/** 运行上下文（承载审计所需的 id 与统计）。 */
interface RunContext {
  runId           : string;
  bookId          : string;
  bookTitle       : string;
  chapterCount    : number;
  /** 累计成本（美元）；单价未知时该次调用不计入，但会留档告警。 */
  costUsd         : number;
  budgetUsd       : number;
  /** 累计 token 与调用次数，用于「单书 token 消耗落档」验收。 */
  tokensIn        : number;
  tokensOut       : number;
  /** 累计思考 token（`tokensOut` 的子集）；用于验证思考模式是否真的关掉了。 */
  reasoningTokens : number;
  callCount       : number;
  /** 单价缺失的模型名集合。 */
  unpricedModels  : Set<string>;
  /**
   * P0 词典调用是否失败（N20 质量闸门的**诊断**字段，不单独触发中止）。
   *
   * 词典失败只让「类型声明 + 噪声过滤」退化，图谱仍非空、仍可用 ——
   * 这是删除前的既有行为，故不因它单独中止。记进闸门 payload 是为了让
   * 「这次为什么整体不健康」可归因：N20 事故里词典那次调用也是 402。
   */
  dictionaryFailed: boolean;
  /**
   * P1 提取**失败的分片下标集合**（N20 质量闸门用）。
   *
   * ⚠️ 为什么必须在这里显式记，而不能事后从库里数：
   * `analysis_calls.error_kind` 只覆盖「HTTP 调用失败」那一类。解析失败
   * （`extract_output_not_json` / `extract_truncated`）走的是
   * `recordCall(..., null)` —— 调用成功、`error_kind` 为 **null**，
   * 失败只写在 `analysis_issues` 里。所以「按 errorKind 计数」会**整类漏掉
   * N5 那种静默丢尾部实体的失败**，而它们才是最常见的形态。
   * 用 Set 而非计数器：同一下标重复记录不会把失败率推高。
   */
  failedSlices    : Set<number>;
}

/** 带上来源章节的分片（P1 与 P6 都依赖它定位生命周期坐标）。 */
interface LocatedSlice {
  chapterOrdinal: number;
  text          : string;
}

/**
 * 关系 + 来源章节 + 来源分片序号。
 *
 * 该结构贯穿 P2 grounding → P6 聚合：
 * - `chapterOrdinal` 供 P6 计算关系有效期（否则 `endChapter` 恒为 null）；
 * - `sliceIndex` 供 P4 还原「分片归属」——投票必须按分片计数，
 *   若在此丢掉分片边界，上层就只能把全部关系当成同一片（v1 式的假投票）。
 */
type LocatedRelation = ExtractedRelation & { chapterOrdinal: number; sliceIndex: number };

/**
 * 实体 + 来源章节。
 *
 * 与 `LocatedRelation` 同源，理由也相同：P1 的每个分片都带 `chapterOrdinal`，
 * 而**提及必须限制在该实体被观测到的章节内**（缺陷 N1）。
 * 因此这个坐标要一路传到 P5（归并取并集）与 P6（落库时过滤），
 * 不能在 `sliceResults.flatMap` 压平分片时丢掉 ——
 * 丢掉之后上层就只能「按名字回查章节」，而那正是 v1 的缺陷模式。
 */
type LocatedEntity = ExtractedEntity & { chapterOrdinal: number };

/** P4 投票的输入单元：一个分片（已 grounding）的实体与关系。 */
interface VotableSlice {
  entities : ExtractedEntity[];
  relations: ExtractedRelation[];
}

/**
 * 单片注入提示词的锚点上限。取值来自题材包（`thresholds.sliceAnchorLimit`）。
 *
 * 取 60：足以覆盖单章内的主要人物，同时把词典段控制在千字量级，
 * 使单片 input 落在规划目标 4–6K token 区间内。
 */
const DEFAULT_SLICE_ANCHOR_LIMIT = DEFAULT_GENRE_PACK.thresholds.sliceAnchorLimit;

/**
 * N20 质量闸门：允许的 P1 分片失败率上限，以及触发它所需的最小失败片数。
 *
 * 取值依据（实测，而非拍脑袋）：健康运行的失败率极低 ——
 * 批次 9 / 11 儒林 **112 片 0 失败**；红楼 **318 片 2 失败**
 * （`extract_output_not_json` × 1 + `extract_truncated` × 1），即 0.6%。
 * 10% 相对该基线留了约 16 倍余量，不会被内容噪声误触发；
 * 而 N20 事故（余额耗尽）是 **100%**，任何合理阈值都拦得住。
 *
 * 为什么要一个绝对片数下限：小样本下「1/4 = 25%」纯属抖动，
 * 用绝对片数兜住「只有一两片时，不要因为单片失败就判死整次运行」。
 * 注意下限**只作用于失败率这条**：产出为空那条（见闸门处）无条件生效。
 */
const PERSIST_MAX_FAILURE_RATIO = 0.1;
const PERSIST_MIN_FAILURE_COUNT = 2;

/** 管线最终产出。 */
export interface PipelineResult {
  runId        : string;
  bookId       : string;
  entityCount  : number;
  relationCount: number;
  /** 各阶段累计 token 与成本，用于「单书 token 消耗落档」验收。 */
  cost         : {
    tokensIn       : number;
    tokensOut      : number;
    /** 思考 token（`tokensOut` 的子集），用于核对思考模式是否生效。 */
    reasoningTokens: number;
    usd            : number;
    callCount      : number;
  };
  issues: { code: string; count: number }[];
}

/**
 * 记录一次模型调用的审计行。
 *
 * `stage` 收窄为两个：P3 二审已于 2026-10-10 删除（文件头「为什么没有 P3」）。
 * ⚠️ 数据库的 `analysis_stage` 枚举**仍保留 `review`** —— 历史运行的
 * `analysis_calls` 里有 `review` 行，删枚举值会让旧数据无法读取。
 * 这里只表示「当前代码不可能再产生 review 行」。
 */
async function recordCall(
  context: RunContext,
  stage: "dictionary" | "extract",
  model: string,
  result: AiCompletionResult | null,
  errorKind: string | null
): Promise<void> {
  const db = getDatabase();
  const tokensIn = result?.usage.tokensIn ?? 0;
  const tokensOut = result?.usage.tokensOut ?? 0;
  const reasoningTokens = result?.usage.reasoningTokens ?? 0;

  if (result?.usage.costUsd === null) {
    context.unpricedModels.add(model);
  }
  context.costUsd += result?.usage.costUsd ?? 0;
  context.tokensIn += tokensIn;
  context.tokensOut += tokensOut;
  context.reasoningTokens += reasoningTokens;
  context.callCount += 1;

  await db.insert(analysisCalls).values({
    runId    : context.runId,
    stage,
    model,
    tokensIn,
    tokensOut,
    costUsd  : (result?.usage.costUsd ?? 0).toFixed(6),
    latencyMs: result?.latencyMs ?? 0,
    errorKind
  });
}

/** 记录一条问题留档。 */
async function recordIssue(
  context: RunContext,
  code: string,
  payload: unknown,
  chapterOrdinal: number | null = null
): Promise<void> {
  const db = getDatabase();
  await db.insert(analysisIssues).values({
    runId: context.runId,
    chapterOrdinal,
    code,
    payload
  });
}

/** 预算检查；超限时抛出以中止管线。 */
function assertWithinBudget(context: RunContext): void {
  if (context.costUsd > context.budgetUsd) {
    throw new Error(
      `解析预算超限：已用 $${context.costUsd.toFixed(4)}，上限 $${String(context.budgetUsd)}`
    );
  }
}

/** 把模型返回的文本解析为经过 schema 校验的对象。 */
function parseModelJson<T>(
  raw: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: unknown } }
): { data: T | null; repaired: boolean; errorKind: string | null } {
  const repair = repairTruncatedJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(repair.text);
  } catch {
    return { data: null, repaired: repair.repaired, errorKind: "output_not_json" };
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    return {
      data     : null,
      repaired : repair.repaired,
      errorKind: repair.repaired ? "truncated" : "schema_invalid"
    };
  }

  return { data: validated.data, repaired: repair.repaired, errorKind: null };
}

/** P0 产出：通过筛选的候选名 + 模型给出的类型声明。 */
interface DictionaryStageResult {
  candidates   : CandidateName[];
  /** 归一化键 → 模型判定的类型；供 P5 参与类型投票，避免这次调用白费。 */
  declaredTypes: Map<string, EntityType>;
}

/** P0：全书预扫描 + 可选的模型分类。 */
async function runDictionaryStage(
  context: RunContext,
  chapterTexts: readonly { ordinal: number; text: string }[],
  workPack: WorkPack
): Promise<DictionaryStageResult> {
  const snapshot = getModelSnapshot();
  const candidates = scanBookCandidates(chapterTexts, workPack);

  await recordIssue(context, "dictionary_scan", {
    scannedChapters: chapterTexts.length,
    candidateCount : candidates.length
  });

  if (candidates.length === 0) {
    return { candidates, declaredTypes: new Map() };
  }

  // 用模型剔除分词噪声（如「如今」「说道」）。词典分类只跑 1 次，成本可控。
  try {
    const result = await callWithRetry({
      model      : snapshot.extractModel,
      system     : DICTIONARY_SYSTEM_PROMPT,
      user       : buildDictionaryUserPrompt(candidates),
      temperature: 0,
      maxTokens  : 4096
    });
    await recordCall(context, "dictionary", snapshot.extractModel, result, null);

    const outcome = parseModelJson(result.text, DictionaryResultSchema);
    if (outcome.data === null) {
      await recordIssue(context, "dictionary_parse_failed", {
        errorKind: outcome.errorKind,
        repaired : outcome.repaired
      });
      context.dictionaryFailed = true;
      return { candidates, declaredTypes: new Map() };
    }

    const accepted = new Set(
      outcome.data.verdicts
        .filter((verdict) => verdict.accepted)
        .map((verdict) => normalizeName(verdict.name))
    );
    // 保留类型声明：P0 是全书维度判定，比逐分片提取更稳定。
    const declaredTypes = new Map<string, EntityType>();
    for (const verdict of outcome.data.verdicts) {
      if (!verdict.accepted) {
        continue;
      }
      declaredTypes.set(normalizeName(verdict.name), verdict.type);
    }
    return {
      candidates: candidates.filter((candidate) => accepted.has(candidate.normalized)),
      declaredTypes
    };
  } catch (error) {
    await recordCall(
      context,
      "dictionary",
      snapshot.extractModel,
      null,
      error instanceof AiCallError ? error.kind : "unknown"
    );
    await recordIssue(context, "dictionary_call_failed", {
      errorKind: error instanceof AiCallError ? error.kind : "unknown",
      message  : error instanceof Error ? error.message : String(error)
    });
    context.dictionaryFailed = true;
    // 词典失败不应阻断整条管线 —— 退化到未过滤的候选清单。
    return { candidates, declaredTypes: new Map() };
  }
}

/** P1 分片提取结果（含来源章节与分片序号）。 */
interface SliceExtractionResult {
  extraction    : SliceExtraction;
  chapterOrdinal: number;
  /** 分片在全书中从 0 开始的序号；P4 按此还原计票单元。 */
  sliceIndex    : number;
}

/**
 * P1：逐片提取（**保序 + 滚动上下文**）。
 *
 * 并发模型（重要设计决策）：
 * - `sliceChapter` 保证**一片不跨章**，因此滚动上下文的依赖链只在**章内**成立；
 * - 章与章之间并行（上限 `concurrency`），章内**严格按序**执行，
 *   每片以前一片的产出构造 `RollingContext`。
 *
 * 为什么不是「全分片并行」：规划 §5 要求 user 消息包含「前序滚动上下文
 * （≤300 字摘要 + 上片出场名）」，该上下文依赖前一片的**实际产出**，
 * 与无依赖的全并行互斥。把并行度收敛到「章」这一层，是在不牺牲
 * 跨片一致性的前提下保留吞吐的折中。
 *
 * @param context 运行上下文
 * @param chapterSlices 全书分片（按章、按章内序排列）
 * @param candidates P0 词典候选名
 * @param groundingIndex 全书 grounding 索引（闸门的别名作用域 = P2 grounding 的口径）
 * @returns 按分片序号对齐的提取结果
 */
async function runExtractionStage(
  context: RunContext,
  chapterSlices: readonly LocatedSlice[],
  candidates: readonly CandidateName[],
  groundingIndex: GroundingIndex
): Promise<SliceExtractionResult[]> {
  const snapshot = getModelSnapshot();
  const budget = getBudgetEnv();
  const results = new Array<SliceExtractionResult>(chapterSlices.length);

  // 按章分组（保持全书顺序），章内分片保序。
  const slicesByChapter = new Map<number, number[]>();
  for (const [index, slice] of chapterSlices.entries()) {
    const bucket = slicesByChapter.get(slice.chapterOrdinal) ?? [];
    bucket.push(index);
    slicesByChapter.set(slice.chapterOrdinal, bucket);
  }

  const chapterGroups = [...slicesByChapter.entries()].sort((left, right) => left[0] - right[0]);
  let cursor = 0;

  /** 处理一整章（章内保序，滚动上下文逐片传递）。 */
  const processChapter = async (indexes: readonly number[]): Promise<void> => {
    let rolling: RollingContext | undefined;

    for (const index of indexes) {
      const slice = chapterSlices[index];
      if (slice === undefined) {
        continue;
      }
      assertWithinBudget(context);
      // 显式传 index：章与章并行执行，results 的填充顺序不等于下标顺序，
      // 必须由调用方给出唯一确定的分片下标。
      rolling = await extractOneSlice(
        context,
        snapshot,
        index,
        slice,
        selectSliceAnchors(candidates, slice.text),
        rolling,
        results,
        groundingIndex
      );
    }
  };

  /** 消费一章。 */
  const worker = async (): Promise<void> => {
    for (;;) {
      const groupIndex = cursor;
      cursor += 1;
      const group = chapterGroups[groupIndex];
      if (group === undefined) {
        return;
      }
      await processChapter(group[1]);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(budget.concurrency, chapterGroups.length)) },
      () => worker()
    )
  );

  return results;
}

/**
 * 提取单个分片，把结果写入 `results[sliceIndex]`，并返回供下一片使用的滚动上下文。
 *
 * 失败路径同样返回上下文（沿用传入值），保证链条不因单片失败而中断。
 *
 * @param sliceIndex 该分片在全书分片数组中的下标
 * @returns 更新后的滚动上下文
 */
async function extractOneSlice(
  context: RunContext,
  snapshot: ReturnType<typeof getModelSnapshot>,
  index: number,
  slice: LocatedSlice,
  candidates: readonly CandidateName[],
  rolling: RollingContext | undefined,
  results: SliceExtractionResult[],
  groundingIndex: GroundingIndex
): Promise<RollingContext> {
  const sliceIndex = index;

  try {
    const result = await callWithRetry({
      model      : snapshot.extractModel,
      system     : EXTRACTION_SYSTEM_PROMPT,
      user       : buildExtractionUserPrompt(slice.text, candidates, rolling),
      temperature: 0,
      maxTokens  : 8192
    });
    await recordCall(context, "extract", snapshot.extractModel, result, null);

    // M1 + M2（§3.23 五）：把「撞输出上限」的**真值**信号记下来。
    //
    // 背景：`result.truncated` 由 `ai/client.ts` 从 `finish_reason === "length"` 算出，
    // 但在此之前**没有任何消费方** —— 每次调用是否撞上限，在内存里存在过，**然后被扔掉**。
    //
    // 而下面的 `extract_truncated` 是**代理**，不是真值：它要求「repair 过 **且**
    // schema 仍失败」，与「撞上限」不是同一个量。实测（§3.23 三）：红楼 run `470a4a6f`
    // 真值 **1** 次、代理 **2** 次（**多算**）；反向则**漏算** —— 撞上限但被 repair
    // 救回且校验通过的，只会落成 `extract_json_repaired` 甚至**无声**。
    //
    // ⚠️ 这条留档**不改图谱**（只写 `analysis_issues`）→ 可用「图谱产出逐字节不变」验证。
    // 成本是**零**：信号已在 `AiCompletionResult` 里，只是没人读。
    if (result.truncated) {
      await recordIssue(
        context,
        "extract_hit_token_limit",
        {
          sliceIndex,
          finishReason: result.finishReason,
          tokensOut   : result.usage.tokensOut,
          outputChars : result.text.length,
          sliceChars  : slice.text.length
        },
        slice.chapterOrdinal
      );
    }

    const outcome = parseModelJson(result.text, SliceExtractionSchema);
    if (outcome.data === null) {
      await recordIssue(
        context,
        `extract_${outcome.errorKind ?? "unknown"}`,
        { sliceIndex },
        slice.chapterOrdinal
      );
      // N20 质量闸门的输入：这次失败必须被**显式**记住。
      // 注意这条路径的 `recordCall` 传的是 `errorKind = null`（HTTP 调用成功、
      // 只是 JSON 不合规），所以闸门绝不能靠「数 analysis_calls.error_kind」。
      context.failedSlices.add(sliceIndex);
      results[sliceIndex] = {
        extraction    : { entities: [], relations: [] },
        chapterOrdinal: slice.chapterOrdinal,
        sliceIndex
      };
      return advanceRollingContext(rolling, []);
    }

    if (outcome.repaired) {
      await recordIssue(context, "extract_json_repaired", { sliceIndex }, slice.chapterOrdinal);
    }

    // 实体准入闸门（治本位置：P1 输出**落库前**）。
    // 必须在这里拦，因为下游没有第二道闸门：
    // - P2 grounding 只校验「字面出现过」，而泛称当然出现过（「县」出现 225 次）；
    // - P3 二审只看名字清单，同样无法判定「县」不是实体。
    // 传入**全书** grounding 索引以启用「别名必须有字面证据」校验 ——
    // ⚠️ 作用域是**全书**，不是本片（批次 25 修正）：本片口径比 grounding 更严，
    // 会把「在本片之外、但在全书之内」的真别名永久删掉（68 条里 62 条为真）。
    // 闸门与 P2 共用**同一个**索引，因此作用域不可能漂移。
    const gated = gateExtraction(outcome.data, groundingIndex);
    if (gated.rejections.length > 0 || gated.droppedAliases.length > 0) {
      await recordIssue(
        context,
        "entity_gate_rejected",
        {
          sliceIndex,
          rejectedCount    : gated.rejections.length,
          droppedRelations : gated.droppedRelations,
          // 逐条留档：只记数量无法回答「某个实体/别名为什么没进图谱」。
          rejections       : gated.rejections,
          droppedAliasCount: gated.droppedAliases.length,
          droppedAliases   : gated.droppedAliases
        },
        slice.chapterOrdinal
      );
    }

    results[sliceIndex] = {
      extraction    : gated.extraction,
      chapterOrdinal: slice.chapterOrdinal,
      sliceIndex
    };
    // 滚动上下文用**过滤后**的名字：把被拒的泛称喂给下一片，
    // 等于在提示词里把噪声当成「上片出场名」再强化一次。
    return advanceRollingContext(
      rolling,
      gated.extraction.entities.map((entity) => entity.canonical)
    );
  } catch (error) {
    const errorKind = error instanceof AiCallError ? error.kind : "unknown";
    await recordCall(context, "extract", snapshot.extractModel, null, errorKind);
    // 留档必须带 `errorKind`：只看 `message` 无法区分「重试后仍空响应」
    // 与「内容不是合法 JSON」，而这两者的处置方向完全相反
    // （前者要加余额/换模型，后者要改提示词或修复工序）。
    // 首轮全量解析的 7 次 `extract_call_failed` 就因为缺这个字段，
    // 只能靠事后翻日志逐条猜。
    await recordIssue(
      context,
      "extract_call_failed",
      {
        sliceIndex,
        errorKind,
        message: error instanceof Error ? error.message : String(error)
      },
      slice.chapterOrdinal
    );
    // N20 质量闸门的输入（与解析失败那条并列，两条都必须记）。
    context.failedSlices.add(sliceIndex);
    results[sliceIndex] = {
      extraction    : { entities: [], relations: [] },
      chapterOrdinal: slice.chapterOrdinal,
      sliceIndex
    };
    return advanceRollingContext(rolling, []);
  }
}

/**
 * P3 二审 —— **已删除（2026-10-10）**。
 *
 * 原实现在真实语料上 100% 空转：把全部实体名拼成一个清单一次调用，
 * 输出体量 O(名字数)，而 `maxTokens = 8192` 装不下 908 / 1002 个实体的逐条判定
 * → 输出恰好撞上限 → 截断 → `review_parse_failed` → 原样返回实体。
 * 完整实测见文件头「为什么没有 P3」。
 *
 * 保留这段注释而不是留一个空函数，是为了让「这里曾经有个阶段」可被读到 ——
 * 否则下一个人只会看到 P2 直接接 P4，然后去别处找那个不存在的阶段。
 */

/** 管线输入。 */
export interface RunPipelineInput {
  bookId: string;
}

/**
 * 为单片挑选「相关锚点 Top-N」（零 LLM 成本）。
 *
 * 规划 §5 明确要求 user 消息只带**本片相关锚点 Top-N（非全量）**，
 * 而全量词典（默认上限 200 条）逐片重复注入会显著推高 input token，
 * 与本项目「降本」的首要目标直接冲突。
 *
 * 选择口径（确定性、可复现）：
 * 1. 先取**在本片正文中字面出现**的候选名 —— 这些才是本片真正相关的锚点，
 *    复用与 P2 grounding 相同的 `normalizeName` 口径，避免「全角/空格」误判；
 * 2. 若命中数不足 `limit`，用**全书高频名**补齐到 `limit`，
 *    以覆盖「本片以别称出现、字面未命中」的情况；
 * 3. 结果按输入顺序（已按频次降序）稳定截断，保证同一输入恒定输出。
 *
 * @param candidates P0 候选名（已按频次降序）
 * @param sliceText 本片正文
 * @param limit 注入提示词的名数上限
 * @returns 相关锚点列表
 */
export function selectSliceAnchors(
  candidates: readonly CandidateName[],
  sliceText: string,
  limit = DEFAULT_SLICE_ANCHOR_LIMIT
): CandidateName[] {
  if (candidates.length <= limit) {
    return [...candidates];
  }

  const normalizedSlice = normalizeName(sliceText);
  const relevant: CandidateName[] = [];

  for (const candidate of candidates) {
    if (candidate.normalized.length === 0) {
      continue;
    }
    if (normalizedSlice.includes(candidate.normalized)) {
      relevant.push(candidate);
      if (relevant.length >= limit) {
        return relevant;
      }
    }
  }

  // 补齐：按原顺序（频次降序）追加未命中的高频名，直至达到上限。
  const seen = new Set(relevant.map((candidate) => candidate.normalized));
  for (const candidate of candidates) {
    if (relevant.length >= limit) {
      break;
    }
    if (seen.has(candidate.normalized)) {
      continue;
    }
    relevant.push(candidate);
    seen.add(candidate.normalized);
  }

  return relevant;
}

/**
 * 推进滚动上下文：把当前片的产出合并进上一片传下来的上下文。
 *
 * 合并策略（刻意保持轻量，以控制 user 消息体积）：
 * - `priorNames`：保留上一片的名字（去重），并追加本片新出现的名字 ——
 *   保证「同一人物在后续片仍看得到」，同时把总量压到 `MAX_ROLLING_NAMES`；
 * - `summary`：不调用模型生成摘要（否则每片多一次调用，与降本目标冲突），
 *   改为用「已出场人名序列」做**确定性压缩**，并截断到 `MAX_ROLLING_SUMMARY_CHARS`。
 *
 * 这是对规划「≤300 字摘要」的**零成本实现**：摘要不追求语义概括，
 * 只承担「提示前文出现过哪些人」的锚点作用，从而在不增加 token 调用的前提下
 * 提升跨片写法一致性。
 *
 * @param previous 上一片上下文（可省略）
 * @param names 本片抽出的规范名
 * @returns 供下一片使用的上下文
 */
export function advanceRollingContext(
  previous: RollingContext | undefined,
  names: readonly string[]
): RollingContext {
  const merged = [...(previous?.priorNames ?? []), ...names]
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const priorNames = [...new Set(merged)].slice(-MAX_ROLLING_NAMES);

  const digest = previous?.summary.trim() ?? "";
  const appended = priorNames.join("、");
  const summary = (digest.length > 0 ? `${digest}｜${appended}` : appended).slice(
    -MAX_ROLLING_SUMMARY_CHARS
  );

  return { priorNames, summary };
}

/**
 * 把 grounded 关系按来源分片还原成投票单元。
 *
 * 为什么需要这一步：
 * `voteRelations` 的 `votes` 语义是「该关系在多少个分片中被观测到」。
 * 若把全书关系压成一个单元传入，每条关系的 `votes` 恒为 1，
 * 分片共识信息**在产生的那一刻就丢了**，且无法在 `analysis_issues` 中区分
 * 「只被一片提到」与「被多片共同印证」。
 *
 * 诚实说明：`votes` 目前不直接影响落库结果（P6 自行重排观测）。
 * 本函数的作用是**恢复计票语义并使其可观察**（供 `vote_summary` 留档），
 * 为后续「按共识度过滤低置信关系」提供数据基础。
 *
 * 实体只挂在**产出该分片的关系所在的那个单元**上：投票阶段并不消费
 * `entities`（实体类型决策在 P5 完成），这里保持其为空数组，
 * 避免把全部实体重复挂到每个分片、造成不必要的内存占用。
 *
 * @param relations grounded 后的关系（携带 `sliceIndex`）
 * @param sliceIndexes 全书分片序号（决定输出单元的数量与顺序）
 * @returns 按 `sliceIndex` 升序排列的投票单元数组
 */
export function groupRelationsBySlice(
  relations: readonly LocatedRelation[],
  sliceIndexes: readonly number[]
): VotableSlice[] {
  const buckets = new Map<number, ExtractedRelation[]>();
  for (const sliceIndex of sliceIndexes) {
    buckets.set(sliceIndex, []);
  }

  for (const { sliceIndex, chapterOrdinal: _chapterOrdinal, ...relation } of relations) {
    const bucket = buckets.get(sliceIndex);
    if (bucket === undefined) {
      // 理论上不可达：关系必来自某个已登记的分片。留档而非静默丢弃。
      buckets.set(sliceIndex, [relation]);
      continue;
    }
    bucket.push(relation);
  }

  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, sliceRelations]) => ({ entities: [], relations: sliceRelations }));
}

/**
 * 从作品的**全部**章节中挑出参与解析的那些。
 *
 * 前置内容（出版方导读 / 封面 / 版权页，`ordinal === 0`）不是叙事正文：
 * 实测《儒林外史》的「前言」是一篇 1154 字的出版方导读，讲的是《水浒》《三国》
 * 与作者吴敬梓的生平 —— 抽出来的 16 个「实体」全是现实世界名词，
 * 对人物关系图而言 100% 是噪声，还要白付一遍 token。
 *
 * 安全性：`ordinal === 0` 只在**确实切出了真实章节**时才会出现
 * （见 `parse-text.ts` 的 `hasRealChapter`）。全书没有标题标记时，
 * 整本正文仍是 `ordinal === 1`，不会被误跳过 —— 这条兜底有独立用例守着。
 *
 * 单独抽成函数是为了能被单测钉住：删掉这一个 filter，管线的其它测试**全绿**。
 *
 * @param chapters 已落库的章节（含前置内容）
 * @returns 参与解析的章节
 */
export function selectAnalyzableChapters<T extends { ordinal: number }>(
  chapters: readonly T[]
): T[] {
  return chapters.filter((chapter) => chapter.ordinal !== FRONT_MATTER_ORDINAL);
}

/**
 * 执行完整解析管线。
 *
 * @param input 作品 ID
 * @returns 运行摘要（含成本落档）
 * @throws 预算超限或数据库写入失败时抛出
 */
export async function runPipeline(input: RunPipelineInput): Promise<PipelineResult> {
  const db = getDatabase();
  const budget = getBudgetEnv();
  const snapshot = getModelSnapshot();

  // 读取章节与段落（这是唯一的原文来源；管线不直接读文件）。
  const storedChapters = await db
    .select({ id: chapters.id, ordinal: chapters.ordinal, title: chapters.title })
    .from(chapters)
    .where(eq(chapters.bookId, input.bookId))
    .orderBy(chapters.ordinal);

  // 前置内容（出版方导读 / 封面 / 版权页）**不参与解析**。
  // 它不是叙事正文：实测《儒林外史》的「前言」是一篇 1154 字的出版方导读，
  // 讲的是《水浒》《三国》《红楼梦》与作者吴敬梓的生平 —— 抽出来的 16 个「实体」
  // 全是现实世界名词，对人物关系图而言 100% 是噪声，还要白付一遍 token。
  const chapterRows = selectAnalyzableChapters(storedChapters);

  if (chapterRows.length === 0) {
    throw new Error(`作品 ${input.bookId} 没有可解析的章节，请先执行 pnpm import:book`);
  }

  const [run] = await db
    .insert(analysisRuns)
    .values({
      bookId       : input.bookId,
      status       : "running",
      modelSnapshot: snapshot,
      promptVersion: (await import("./prompts")).PROMPT_VERSION,
      skillSnapshot: null
    })
    .returning({ id: analysisRuns.id });

  if (run === undefined) {
    throw new Error("解析运行记录创建失败");
  }

  const context: RunContext = {
    runId           : run.id,
    bookId          : input.bookId,
    bookTitle       : "",
    chapterCount    : chapterRows.length,
    costUsd         : 0,
    budgetUsd       : budget.budgetUsd,
    tokensIn        : 0,
    tokensOut       : 0,
    reasoningTokens : 0,
    callCount       : 0,
    unpricedModels  : new Set<string>(),
    // N20 质量闸门的两个输入，在管线开始前清零。
    dictionaryFailed: false,
    failedSlices    : new Set<number>()
  };

  // 作品包解析：按 `books.title` 选专名词典。
  //
  // 为什么必须**留档**：未注册作品的兜底是「零专名」，只表现为分词质量下降
  // （实测基线整词率 75.7%，配对的词典可到 97.4%），**不会报错**。
  // 不留档的话，「第二本书人名切不准」就会被归因成分词库不行，
  // 而真正的原因是「这本书还没注册作品包」。
  // 详见 `genre-pack/registry.ts`。
  const [bookRow] = await db
    .select({ title: books.title })
    .from(books)
    .where(eq(books.id, input.bookId))
    .limit(1);

  context.bookTitle = bookRow?.title ?? "";
  const workPackResolution = resolveWorkPack(context.bookTitle);
  const workPack = workPackResolution.pack;

  await recordIssue(context, "work_pack_resolved", {
    bookTitle   : context.bookTitle,
    packId      : workPack.id,
    packLabel   : workPack.label,
    matched     : workPackResolution.matched,
    matchedAlias: workPackResolution.matchedAlias,
    properNouns : workPack.properNouns.length,
    // 批次 43：声明的别名组数。与 `properNouns` 同理 —— 「这份图谱是哪版包产出的」
    // 必须可追溯，否则「同一 prompt_version、不同知识」无法区分。
    aliasGroups : workPack.aliasGroups?.length ?? 0
  });

  try {
    // 载入全文（用于 grounding 索引与分片）。
    const paragraphRows = await db
      .select({
        chapterId: paragraphs.chapterId,
        ordinal  : paragraphs.ordinal,
        text     : paragraphs.text
      })
      .from(paragraphs)
      .innerJoin(chapters, eq(paragraphs.chapterId, chapters.id))
      .where(eq(chapters.bookId, input.bookId));

    const byChapter = new Map<string, { ordinal: number; text: string }[]>();
    for (const row of paragraphRows) {
      const bucket = byChapter.get(row.chapterId) ?? [];
      bucket.push({ ordinal: row.ordinal, text: row.text });
      byChapter.set(row.chapterId, bucket);
    }

    const chapterTexts: { ordinal: number; text: string }[] = [];
    const allSlices: LocatedSlice[] = [];
    const fullTexts: string[] = [];

    for (const chapter of chapterRows) {
      const bucket = (byChapter.get(chapter.id) ?? []).sort((a, b) => a.ordinal - b.ordinal);
      const joined = bucket.map((item) => item.text).join("\n");
      chapterTexts.push({ ordinal: chapter.ordinal, text: joined });
      fullTexts.push(joined);

      for (const slice of sliceChapter(bucket)) {
        allSlices.push({ chapterOrdinal: chapter.ordinal, text: slice.text });
      }
    }

    // 全书 grounding 索引：**在 P1 之前**构建，因为闸门的别名作用域也要用它
    // （批次 25：闸门与 P2 共用同一索引 → 作用域不可能漂移）。纯函数、零 LLM 成本。
    const groundingIndex = buildGroundingIndex(fullTexts);

    // P0：词典预扫描（叠加该作品自己的专名词典）。
    const dictionary = await runDictionaryStage(context, chapterTexts, workPack);
    const candidates = dictionary.candidates;

    // P1：逐片提取。
    const sliceResults = await runExtractionStage(context, allSlices, candidates, groundingIndex);

    // P2：grounding（零 LLM）。
    // 关系上直接携带来源章节 —— P6 计算有效期必须看到「同一关系的多次观测」，
    // 若在此丢掉章节，上层就只能靠名字回查（v1 的缺陷模式）。
    // 同时保留 `sliceIndex`：P4 的投票语义是**按分片计票**，一旦在这里把分片压平，
    // 投票就退化成「一片内的重复计数」，跨片共识无法体现。
    // 实体同样要带上来源章节 —— 提及的作用域判据（N1）。
    // ⚠️ 这里**必须**逐片 map，不能先 flatMap 再统一补章节：
    // 压平之后就无法知道某个实体来自哪一片了。
    const rawEntities: LocatedEntity[] = sliceResults.flatMap((item) =>
      item.extraction.entities.map((entity) => ({
        ...entity,
        chapterOrdinal: item.chapterOrdinal
      }))
    );
    const rawRelations: LocatedRelation[] = sliceResults.flatMap((item) =>
      item.extraction.relations.map((relation) => ({
        ...relation,
        chapterOrdinal: item.chapterOrdinal,
        sliceIndex    : item.sliceIndex
      }))
    );

    const entityGrounding = groundEntities(rawEntities, groundingIndex);
    const relationGrounding = groundRelations(rawRelations, groundingIndex);

    await recordIssue(context, "grounding_summary", {
      droppedEntities : entityGrounding.droppedEntities.length,
      droppedAliases  : entityGrounding.droppedAliases,
      droppedRelations: relationGrounding.droppedRelations.length
    });

    // P3 已删除（2026-10-10）：实体从 grounding 直接进入 P4/P5。
    // 删除的理由与实测见文件头「为什么没有 P3」—— 简言之，它 100% 空转，
    // 删掉它对产出**逐字节无影响**，却省下一次调用与 8192 个输出 token。

    // P4：关系投票与归一化。
    // 关键：把关系**按来源分片分组**后再投票。
    // `voteRelations` 的计票口径是「出现在多少个分片中」，
    // 因此传入的必须是「每片一个单元」，而不是把全书压成一片 ——
    // 后者会让 votes 恒为 1，使「重叠分片重复观测 → 投票降噪」的机制完全失效。
    // P4：关系投票与归一化。
    // 注意（重要）：按分片计票恢复了 `votes` 的**真实语义**，但 `votes`
    // 目前**尚未参与任何落库决策** —— 它只影响 `voted.relations` 的排序，
    // 而 P6 会自行重排观测顺序。因此本步骤的产出必须落档，
    // 否则「投票」既不可观察、也无法用于后续的准确率迭代。
    // 详见下方 `vote_summary` 留档。
    const votableSlices = groupRelationsBySlice(
      relationGrounding.kept,
      sliceResults.map((item) => item.sliceIndex)
    );
    const voted = voteRelations(votableSlices, SYMMETRIC_RELATION_CODES);
    if (voted.unknownCodes.length > 0) {
      await recordIssue(context, "unknown_relation_code", { codes: voted.unknownCodes });
    }
    await recordIssue(context, "vote_summary", {
      slices    : votableSlices.length,
      relations : voted.relations.length,
      // 多片共识的关系数（votes ≥ 2）—— 这是「投票提升置信度」的直接证据。
      multiSlice: voted.relations.filter((item) => item.votes >= 2).length,
      maxVotes  : voted.relations.reduce((peak, item) => Math.max(peak, item.votes), 0)
    });

    // P5：实体归并。
    const nameFrequency = new Map<string, number>();
    for (const candidate of candidates) {
      nameFrequency.set(candidate.normalized, candidate.frequency);
    }
    // 补充词典未覆盖的名字（模型发现但预扫描遗漏的）。
    for (const entity of entityGrounding.kept) {
      const key = normalizeName(entity.canonical);
      nameFrequency.set(key, nameFrequency.get(key) ?? 1);
    }

    const mergeInput: MergeCandidate[] = entityGrounding.kept.map((entity) => ({
      canonical       : entity.canonical,
      type            : entity.type,
      aliases         : entity.aliases,
      nameType        : entity.nameType,
      // 观测章节 → P5 取并集 → P6 用它把提及限制在该实体真正出现过的回内（N1）。
      observedChapters: [entity.chapterOrdinal]
    }));
    // P0 的声明类型并入类型投票 —— 否则「全书维度分类」的信息会在 P5 被丢弃，
    // 实体类型退化为「先出现的分片说了算」。
    const merged = mergeEntities({
      entities           : mergeInput,
      nameFrequency,
      declaredTypes      : dictionary.declaredTypes,
      // 批次 43：作品包声明的「同一人/别名组」。P1 逐片抽取是**局部视角**，
      // 同一人被抽成多个实体后会在冲突护栏处**永久碎片化** —— 声明组是这条缺口的解药。
      declaredAliasGroups: workPack.aliasGroups ?? []
    });

    await recordIssue(context, "merge_summary", {
      before                 : mergeInput.length,
      after                  : merged.entities.length,
      rejectedAlias          : merged.rejectedAliases.length,
      // 冲突别名数（被 ≥2 个实体声称而无区分度）：这是「错并级联」被切断的直接证据。
      conflictingAliases     : merged.conflictingAliases.length,
      // 🔑 冲突别名的**名字**（不只是数量）：`merge` 是**唯一**会因「冲突」丢弃别名的阶段，
      // 而原先这里只记长度 → 「到底哪个别名被当成冲突丢了」无从归因。
      // 这是 §8「名字级留档只做了一半」在 P5 侧的补全点（`entity-gate` 早已记名字）。
      // 图谱中性：只写 `analysis_issues.payload`，不碰 `entities` / `relationships`。
      conflictingAliasNames  : merged.conflictingAliases,
      // 🔑 冲突别名的**声称者**（`别名 → [规范名]`）：批次 26B。
      // 为什么名字还不够：`merge` 的冲突判定用的是**丢弃之前**算出的 `aliasOwners`，
      // 而那个输入**从不落库** → 「上游改动会怎样改变 P5 的丢弃集合」在库内**无法回答**。
      // 批次 25 正是因此吃了亏（A 放行的 20/21 条桥接别名被吃掉 8/1 条，却算不出是哪几条）。
      // 有了它，P5 才能像闸门一样做 **$0 确定性预演**。
      // 图谱中性：只写 `analysis_issues.payload`，不碰 `entities` / `relationships`。
      conflictingAliasOwners : merged.conflictingAliasOwners,
      // N18 行政后缀白名单实际发生的归并次数（「同地双份」被消掉的直接证据）。
      // 为 0 有两种含义：① 本作品没有这类重复；② 被类型/兄弟数判据挡住了 ——
      // 两者在 PRF 里长得一样，所以必须留档，否则规则静默失效也没人知道。
      administrativeMerges   : merged.administrativeMerges,
      // R3 书名号实际发生的归并次数（`庄子` + `《庄子》` 这类「同一部作品的两种写法」）。
      // 为 0 同样有两种含义：① 本作品没有这类重复；② 被**类型护栏**（只并 CONCEPT）挡住 ——
      // 两者在 PRF 里无法区分，所以必须留档。
      bookTitleMerges        : merged.bookTitleMerges,
      // 批次 43：声明式别名组**真正生效的组数**（命中 ≥2 个组才算生效）。
      // 为 0 有两种含义：① 作品包没声明；② 声明的组全都已是同一实体 —— 两者在 PRF 里一样。
      declaredAliasMerges    : merged.declaredAliasMerges,
      declaredTypes          : dictionary.declaredTypes.size,
      // 不变量：生产路径下每个实体都必须有观测章节，否则 N1 的过滤会**静默失效**
      // （空数组 = 不施加限制）。这个数从 0 变成非 0 就是「章节坐标在传递链上断了」的信号，
      // 而它在 PRF 数字里完全看不见。
      entitiesWithoutChapters: merged.entities.filter((item) => item.observedChapters.length === 0).length
    });

    // P6：关系聚合。
    // 每个 grounded 观测各生成一条记录，P6 据此推导 startChapter / endChapter / 类型切换。
    const observations: RelationObservation[] = [];
    for (const item of relationGrounding.kept) {
      const code = resolveRelationCode(item.typeCode);
      if (code === null) {
        continue;
      }
      const sourceKey = normalizeName(item.sourceCanonical);
      const targetKey = normalizeName(item.targetCanonical);
      if (sourceKey.length === 0 || targetKey.length === 0 || sourceKey === targetKey) {
        continue;
      }
      // 两端必须都已归并成实体，否则关系无处可挂。
      if (
        !merged.keyToEntityIndex.has(sourceKey) ||
        !merged.keyToEntityIndex.has(targetKey)
      ) {
        continue;
      }
      observations.push({
        typeCode       : code,
        sourceKey,
        targetKey,
        chapterOrdinal : item.chapterOrdinal,
        sourceCanonical: item.sourceCanonical,
        targetCanonical: item.targetCanonical
      });
    }
    const aggregated = aggregateRelations(observations, SYMMETRIC_RELATION_CODES);

    // 修复 N16：把去重提前到 P6，且用与落库**同一个键**（实体三元组）。
    // 此前的口径不一致 —— P6 按**归一化键三元组**分组，而唯一索引
    // `relationships_triple_uq` 建在**实体 id** 上 → 键不同但实体相同的两条
    // 在落库时被 `.onConflictDoNothing()` 静默吞掉，且不写任何 issue。
    // 实测丢 12 条（儒林，3.2%）/ 60 条（红楼，9.1%），审计与金标里完全不可见。
    //
    // 批次 30 补两条：`SYMMETRIC_RELATION_CODES` 必须传下去 —— 折叠键要与上游
    // `aggregateRelations` **同一个口径**（对称码按无序对），否则 N21 复发；
    // 折叠函数同时会剔除**归并后自环**（N22），并单独报数。
    const collapsed = collapseByEntityTriple(
      aggregated,
      merged.keyToEntityIndex,
      SYMMETRIC_RELATION_CODES
    );

    // 把 P6 的生命周期字段与 P4 的证据引用合流，得到最终待落库的关系。
    // 两者用同一个 identity 对齐，因此这里是一次 O(n) 的哈希查找而非字符串匹配。
    // 折叠后一个实体三元组可能对应多个键级身份键 → 证据取**并集**（去重）。
    const quotesByIdentity = new Map(voted.relations.map((item) => [item.identity, item.quotes]));
    const persistableRelations: PersistableRelation[] = collapsed.relations.map((item) => ({
      typeCode : item.typeCode,
      sourceKey: item.sourceKey,
      targetKey: item.targetKey,
      quotes   : [
        ...new Set(item.mergedIdentities.flatMap((identity) => quotesByIdentity.get(identity) ?? []))
      ],
      startChapter: item.startChapter,
      endChapter  : item.endChapter,
      status      : item.status
    }));

    if (context.unpricedModels.size > 0) {
      await recordIssue(context, "model_price_missing", {
        models: [...context.unpricedModels]
      });
    }

    // ── N20 质量闸门：**在任何破坏性写入之前**决定这次运行配不配落库 ──
    //
    // 事故形态（2026-10-10 16:22，两本生产图谱被清空）：余额耗尽 → P1 全 402
    // → 管线「照常跑完」→ `persistGraph` 先删后建、写进空集 → 图谱归零，
    // 而 `status` 仍是 `succeeded`、成本 $0、issues 0 —— 四层留档全都没报错。
    //
    // 因此必须检查两件**互补**的事，缺一不可：
    //   ① `extract_failure_ratio`：拦住「大部分片失败、但剩下的仍凑出一张像样
    //      图谱」这种更隐蔽的形态 —— 它会用一张残缺图谱**静默替换**掉旧的好图谱，
    //      而这类运行的成本、issues 与状态看起来全都正常；
    //   ② `empty_entities`：拦住 N20 本尊。它与失败率**无关**（哪怕一片都没失败，
    //      只要最终实体数为 0，落库就等于删库），因此无条件生效。
    // 两条各自独立成立即中止，并各自在 issue 里留下名字 —— 事后能指认是哪条。
    const totalSlices = allSlices.length;
    const failedSlices = context.failedSlices.size;
    const failureRatio = totalSlices > 0 ? failedSlices / totalSlices : 0;

    const abortReasons: string[] = [];
    if (failedSlices >= PERSIST_MIN_FAILURE_COUNT && failureRatio > PERSIST_MAX_FAILURE_RATIO) {
      abortReasons.push("extract_failure_ratio");
    }
    if (merged.entities.length === 0) {
      abortReasons.push("empty_entities");
    }

    if (abortReasons.length > 0) {
      // 先留档、再抛。抛出去之后下面的 `catch` 会把 status 写成 `failed`，
      // 但那条路径**不写任何解释** —— 只留一个失败状态，事后无法归因。
      await recordIssue(context, "persist_skipped_low_quality", {
        reasons     : abortReasons,
        totalSlices,
        failedSlices,
        failureRatio: Number(failureRatio.toFixed(4)),
        threshold   : {
          maxFailureRatio: PERSIST_MAX_FAILURE_RATIO,
          minFailureCount: PERSIST_MIN_FAILURE_COUNT
        },
        entityCount     : merged.entities.length,
        relationCount   : persistableRelations.length,
        // 词典失败只作诊断、不单独触发中止（理由见 `RunContext.dictionaryFailed`）。
        dictionaryFailed: context.dictionaryFailed
      });

      throw new Error(
        "解析质量闸门：拒绝落库以保护该作品既有图谱（" +
          `${abortReasons.join(" + ")}；失败分片 ${String(failedSlices)}/${String(totalSlices)}` +
          `，实体 ${String(merged.entities.length)}）。既有图谱未被修改。`
      );
    }

    // 落库：整体替换该作品的图谱数据。
    const mentionKeys = [
      ...new Set(merged.entities.flatMap((entity) => [normalizeName(entity.canonical), ...entity.memberKeys]))
    ];
    const mentionIndex = await buildMentionIndex(input.bookId, mentionKeys);

    const persisted = await persistGraph(
      {
        bookId          : input.bookId,
        runId           : context.runId,
        entities        : merged.entities,
        relations       : persistableRelations,
        keyToEntityIndex: merged.keyToEntityIndex
      },
      mentionIndex
    );

    // 提及作用域留档（N1 的验收口径）。
    // 无条件记录 —— 与 `grounding_summary` / `vote_summary` 等同口径。
    // 「丢弃数为 0」在真实语料上**是异常**（说明过滤没生效），因此这个 0 也必须留档。
    await recordIssue(context, "mention_scope_filtered", {
      dropped : persisted.mentionScopeDropped,
      entities: persisted.mentionScopeDrops.length,
      // 逐条明细只留前 50 —— 完整清单可以从库里按需重算，issue 只负责「看得见」。
      detail  : persisted.mentionScopeDrops.slice(0, 50)
    });

    // 关系口径留档（N16；批次 30 追加 N22 的剔除项）。
    //
    // ⚠️ **必须在 `persistGraph` 之后记录**，而且必须同时留这些数 ——
    //    因为「聚合数 vs 落库数」这条检查**很容易变成恒真**：
    //    N16 修好后 P6 的输出就是最终集合，只报 `relations`（= 待落库条数）
    //    再与落库数比较，两边同源，**永远相等** —— 那就是本仓库反复出现的
    //    「数字看起来有、其实没测到」。留齐各项才能写出**非恒真**的等式：
    //
    //        aggregated − collapsedByEntityTriple − droppedSelfLoops
    //            === relations === persistedRelations
    //
    //    ⚠️ 批次 30 起等式**多了 `droppedSelfLoops` 一项**（N22 的归并后自环）。
    //    把它单列而不是并进 `collapsedByEntityTriple`，是因为并进去之后
    //    **等式照样成立**（丢 1 条时两个计数一增一减相抵）→
    //    「自环被剔了几条」会在留档里**静默消失**。
    //
    //    其中 `persistedRelations` 是**事后从 DB 数出来的**插入数
    //    （`persist-graph.ts` 里 `relationCount` 只在真正 insert 成功时 +1），
    //    不是「我们打算插入几条」。它一旦小于 `relations`，
    //    就说明 `onConflictDoNothing()` 又开始静默吞行了。
    await recordIssue(context, "aggregate_summary", {
      aggregated             : aggregated.length,
      collapsedByEntityTriple: collapsed.collapsedCount,
      droppedSelfLoops       : collapsed.droppedSelfLoops,
      relations              : persistableRelations.length,
      persistedRelations     : persisted.relationCount,
      endedRelations         : persistableRelations.filter((item) => item.status === "ENDED").length
    });

    // 汇总各阶段问题数量，供 CLI 与验收报告展示。
    const issueRows = await db
      .select({ code: analysisIssues.code })
      .from(analysisIssues)
      .where(eq(analysisIssues.runId, context.runId));
    const issueCounts = new Map<string, number>();
    for (const row of issueRows) {
      issueCounts.set(row.code, (issueCounts.get(row.code) ?? 0) + 1);
    }

    await db
      .update(analysisRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(analysisRuns.id, context.runId));

    return {
      runId        : context.runId,
      bookId       : input.bookId,
      entityCount  : persisted.entityCount,
      relationCount: persisted.relationCount,
      cost         : {
        tokensIn       : context.tokensIn,
        tokensOut      : context.tokensOut,
        reasoningTokens: context.reasoningTokens,
        usd            : context.costUsd,
        callCount      : context.callCount
      },
      issues: [...issueCounts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((left, right) => right.count - left.count)
    };
  } catch (error) {
    await db
      .update(analysisRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(analysisRuns.id, context.runId));
    throw error;
  }
}

/** 类型再导出，便于评测脚本消费。 */
export type { EntityType, ExtractedEntity, ExtractedRelation };
