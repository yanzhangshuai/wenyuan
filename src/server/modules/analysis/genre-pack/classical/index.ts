import { RELATION_TYPES } from "@/lib/relations";

import type { GenrePack } from "../types";

import {
  ADMIN_TAIL_CHARS,
  APPELLATION_WORDS,
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_MAX_NAME_LENGTH,
  DEFAULT_MIN_FREQUENCY,
  GATE_GENERIC_WORDS,
  MAX_ENTITY_NAME_LENGTH,
  OCCUPATION_SUFFIXES,
  OFFICE_SUFFIXES,
  RANK_PREFIX_CHARS,
  STOP_WORDS
} from "./lexicon";
import { buildPromptKnowledge } from "./prompts";

/**
 * 古典白话中文题材包（默认包）。
 *
 * ## 这个包的来源
 *
 * 它的每一项都是**逐字**从原来的硬编码位置搬过来的（词表在 `pipeline/dictionary.ts`
 * 与 `pipeline/entity-gate.ts`，提示词在 `pipeline/prompts.ts`）。
 * 搬迁的验收标准只有一条：**零行为变更**。
 *
 * ## 换题材包时**不得越界**的四条判据
 *
 * - **C1** 阶段数量与顺序不变；
 * - **C2** 阶段之间的输入输出契约不变；
 * - **C3** LLM 调用点的位置与数量不变（本包**不得**新增调用点）；
 * - **C4** 确定性阶段（P2/P4/P5/P6）保持零 LLM 纯函数。
 *
 * 用 C3 过一遍已知题材：水浒的绰号、三国的汉末官制与字号、西幻中文译本的音译用字，
 * 都只需加词表或加提示词规则，**没有一条需要新调用点**。
 * 只有「西幻**英文原文**」会越界 —— 那是分词层的语言边界，不是题材包能解决的。
 */
export const CLASSICAL_GENRE_PACK: GenrePack = {
  id   : "classical-chinese",
  label: "古典白话中文",

  lexicon: {
    maxEntityNameLength   : MAX_ENTITY_NAME_LENGTH,
    maxCandidateNameLength: DEFAULT_MAX_NAME_LENGTH,
    minCandidateFrequency : DEFAULT_MIN_FREQUENCY,
    candidateLimit        : DEFAULT_CANDIDATE_LIMIT,
    stopWords             : STOP_WORDS,
    gateGenericWords      : GATE_GENERIC_WORDS,
    officeSuffixes        : OFFICE_SUFFIXES,
    adminTailChars        : ADMIN_TAIL_CHARS,
    occupationSuffixes    : OCCUPATION_SUFFIXES,
    appellationWords      : APPELLATION_WORDS,
    rankPrefixChars       : RANK_PREFIX_CHARS
  },

  // 关系码说明由**本包自己的**目录生成，避免提示词与实际目录漂移。
  prompts: buildPromptKnowledge(RELATION_TYPES),

  thresholds: {
    sliceAnchorLimit: 60
  },

  // 直接引用 `@/lib/relations`：UI 也依赖它，因此**不搬移**，只在这里引用。
  relationTypes: RELATION_TYPES
};
