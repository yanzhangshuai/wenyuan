import { DEFAULT_GENRE_PACK } from "../genre-pack";

import type { CandidateName } from "./dictionary";

/**
 * 提示词集中定义。
 *
 * ## 这一层为什么值钱（对应缺陷一「token 消耗大」）
 *
 * v1 的问题 —— `extractor.ts` 每次调用都重新拼装一段冗长的「领域知识 + 全部关系类型
 * 说明 + 大量正反例」，每片约 35K token 且**内容完全不变**。这导致：
 * 1. 输入 token 被同一段静态文本反复计费；
 * 2. 长系统提示挤压了正文的可读长度，模型注意力被稀释。
 *
 * v3 的解法：
 * 1. 提示词极简 —— 只保留「任务 + 输出格式 + 候选词典」，静态部分压到千字以内；
 * 2. 利用前缀缓存 —— 系统提示在连续调用间保持**逐字节一致**（不含任何分片变量），
 *    使供应商的 prompt caching 能够命中；
 * 3. 关系码说明由**题材包自己的**关系目录程序化生成，杜绝手写清单与代码漂移。
 *
 * ## 搬迁说明
 *
 * 三段系统提示词的**文本**已搬进题材包（`genre-pack/classical/prompts.ts`）。
 * 本模块保留同名导出作为转发，使既有调用方与测试一行都不用改 ——
 * 搬迁是**逐字**的，行为零变更。
 *
 * ⚠️ `EXTRACTION_SYSTEM_PROMPT` 在进程内是**常量**，不得拼入分片相关内容。
 */

/** 提示词版本号；任何语义变更都必须递增，使 `analysis_runs.prompt_version` 可追溯。 */
export const PROMPT_VERSION = "2026-10-02.1";

/**
 * P1 提取的系统提示词（常量，可被前缀缓存命中）。
 *
 * 设计要点：
 * - 明确「只输出 JSON」，并要求逐字摘录证据，与 P2 grounding 的字面匹配约束对齐；
 * - 明确要求使用**候选词典中的写法**作为 canonical，降低同一人物的多种写法；
 * - 明示「不要输出代词与泛称」，减轻 P5 归并护栏的负担。
 */
export const EXTRACTION_SYSTEM_PROMPT = DEFAULT_GENRE_PACK.prompts.extractionSystem;

/**
 * 前序滚动上下文：用于把「上一片的既得结果」传给下一片，提升跨片一致性。
 *
 * 设计原因（对应缺陷二「解析准确率低」）：
 * 分片之间互不知情时，上一片已确立的人物在本片可能被写成另一种称呼，
 * 全部压力被推到 P5 归并；而 P5 只能按字面合并，无法恢复语义对应。
 * 传入「上一片出场名 + 累积摘要」后，模型倾向于复用既有写法，
 * 使同一人物在不同片保持同一 `canonical`。
 *
 * 体积约束：`priorNames` 与 `summary` 都必须经调用方裁剪，
 * 保持 user 消息体量可控（规划目标：单片 input 4–6K token）。
 */
export interface RollingContext {
  /** 上一片中出现过的实体名（用于写法复用）。 */
  priorNames: readonly string[];
  /** 对前序内容的压缩摘要（≤300 字）。 */
  summary   : string;
}

/** 滚动上下文的体积上限：摘要字符数。取值来自题材包（与规划「≤300 字摘要」对齐）。 */
export const MAX_ROLLING_SUMMARY_CHARS = DEFAULT_GENRE_PACK.prompts.maxRollingSummaryChars;

/** 滚动上下文中附带的名字数量上限。取值来自题材包。 */
export const MAX_ROLLING_NAMES = DEFAULT_GENRE_PACK.prompts.maxRollingNames;

/**
 * 构建 P1 提取的用户消息。
 *
 * @param sliceText 该分片的正文
 * @param candidates P0 词典候选名（可为空；应按相关度取 Top-N 而非全量）
 * @param context 前序滚动上下文（可省略）
 * @returns 用户消息文本
 *
 * 设计原因：
 * - 候选词典按「写法(频次)」附带，使模型优先复用已有写法，
 *   从而让不同分片输出同一人物的概率显著提高（减少后续归并压力）；
 * - 滚动上下文置于正文**之前**，使稳定的前缀（词典 + 上下文）在前、
 *   变化的正文在后，有利于供应商的 prompt cache 命中。
 */
export function buildExtractionUserPrompt(
  sliceText: string,
  candidates: readonly CandidateName[] = [],
  context?: RollingContext
): string {
  const sections: string[] = [];

  if (candidates.length > 0) {
    const dictionary = candidates
      .map((candidate) => `${candidate.surface}(${candidate.frequency})`)
      .join("\n");
    sections.push(`## 全书高频专名参考（供复用写法，不强制）\n${dictionary}`);
  }

  const contextBlock = renderRollingContext(context);
  if (contextBlock.length > 0) {
    sections.push(contextBlock);
  }

  sections.push(`## 待抽取文本\n${sliceText}`);

  return sections.join("\n\n");
}

/**
 * 渲染滚动上下文为提示词片段。
 *
 * @param context 滚动上下文；为空或无内容时返回空串
 * @returns 提示词片段
 */
export function renderRollingContext(context?: RollingContext): string {
  if (context === undefined) {
    return "";
  }

  const summary = context.summary.trim().slice(0, MAX_ROLLING_SUMMARY_CHARS);
  const names = [...new Set(context.priorNames.map((name) => name.trim()).filter((name) => name.length > 0))]
    .slice(0, MAX_ROLLING_NAMES);

  if (summary.length === 0 && names.length === 0) {
    return "";
  }

  const parts: string[] = ["## 前文上下文（仅用于保持人名写法一致，不要据此输出关系）"];
  if (summary.length > 0) {
    parts.push(`前情摘要：${summary}`);
  }
  if (names.length > 0) {
    parts.push(`前文已出场的人名：${names.join("、")}`);
  }
  return parts.join("\n");
}

/**
 * P0 词典分类的系统提示词。
 *
 * 用途：把预扫描出的高频名交给小模型判定「是否为可入图谱的实体」，
 * 而不是让提取阶段每片都重新判断一次 —— 这是省 token 的第二个来源。
 */
export const DICTIONARY_SYSTEM_PROMPT = DEFAULT_GENRE_PACK.prompts.dictionarySystem;

/**
 * 构建 P0 词典分类的用户消息。
 *
 * @param candidates 候选名列表
 * @returns 用户消息文本（每行一个候选名）
 */
export function buildDictionaryUserPrompt(candidates: readonly CandidateName[]): string {
  const names = candidates.map((candidate) => candidate.surface).join("\n");
  return `## 待判定词表\n${names}`;
}

/**
 * P3 二审的提示词 —— **已随 P3 删除（2026-10-10）**。
 *
 * 原设计（数据路径隔离：二审只看名字清单、不看原文）在纸面上是合理的，
 * 但实现要求「对每个实体回答三件事」，输出体量 O(名字数)，
 * 在 908 / 1002 个实体、`maxTokens = 8192` 的条件下**必然截断**，
 * 于是历史上从未成功过一次（实测见 `run.ts` 文件头「为什么没有 P3」）。
 *
 * 提示词文本本身已从题材包 `PromptKnowledge` 一并移除；
 * 若将来要用**分批**方案让二审真正生效，需要同时恢复
 * `reviewSystem` / `buildReviewUserPrompt` / `ReviewResultSchema` 三处。
 */
