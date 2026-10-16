import type { KnowledgeField, KnowledgeTarget } from "./types";

/**
 * 触发集选择（设计文档 §3.5）——**纯函数**，零 IO，可单测、可 $0 预演。
 *
 * 成本与收益的分配原则：**搜索的价值 = 原文信息不足 × 外部资料存在**。
 *
 * | 对象 | 原文信息 | 外部资料 | 搜？ | 目的 |
 * |---|---|---|---|---|
 * | 称谓型实体（如 `太祖`） | 不足 | 部分有 | ✅ | **补本名** |
 * | `rich` 档（≥ 阈值提及） | 充足 | 丰富 | ✅ | 补**原文没有的维度**（籍贯/字号/原型） |
 * | `moderate` | 够用 | 少 | ❌（本期不搜） | — |
 * | `sparse`（< 10） | 不足 | 基本没有 | ❌ | 搜了白跑 |
 *
 * ⚠️ 明确不做：**全量逐实体搜索**（`sparse` 档数百个，网上没有资料，收益递减到零）。
 */

/** `rich` 档阈值：提及段落数 ≥ 此值才补维度。 */
export const RICH_MENTION_THRESHOLD = 30;

/** 触发集输入的实体（由读侧装配，纯数据）。 */
export interface KnowledgeTargetEntity {
  id           : string;
  canonical    : string;
  type         : string;
  mentionCount : number;
  aliasCount   : number;
  /** 读侧用 `isHonorificForm` 预计算（与不确定性层同一口径）。 */
  honorificForm: boolean;
}

export interface SelectKnowledgeTargetsInput {
  bookId               : string;
  bookTitle            : string;
  entities             : readonly KnowledgeTargetEntity[];
  /**
   * 已存在的知识键（`subjectKey|field`）——**含 `unresolvable`**：
   * 「查过了，查不到」也要落库，否则每次重跑都要重查。
   */
  existingKeys         : ReadonlySet<string>;
  richMentionThreshold?: number;
}

/** 知识键（幂等判断用）：`subjectKey|field`。 */
export function knowledgeKey(subjectKey: string, field: KnowledgeField): string {
  return `${subjectKey}|${field}`;
}

export function selectKnowledgeTargets(input: SelectKnowledgeTargetsInput): KnowledgeTarget[] {
  const richThreshold = input.richMentionThreshold ?? RICH_MENTION_THRESHOLD;
  const targets: KnowledgeTarget[] = [];

  for (const entity of input.entities) {
    if (entity.type !== "PERSON") continue;

    // 档位一：称谓型实体 → 补本名。
    if (entity.honorificForm && entity.aliasCount === 0) {
      const key = knowledgeKey(entity.canonical, "canonical_name");
      if (!input.existingKeys.has(key)) {
        targets.push({
          subjectType: "entity",
          subjectId  : entity.id,
          subjectKey : entity.canonical,
          bookId     : input.bookId,
          bookTitle  : input.bookTitle,
          field      : "canonical_name",
          reason     : `称谓型且零别名（提及 ${String(entity.mentionCount)} 段）→ 补本名`,
          query      : `${input.bookTitle} ${entity.canonical}`
        });
      }
      continue; // 已按「补本名」处理，不再叠加 rich 档
    }

    // 档位二：rich 档 → 补原文没有的维度。
    if (entity.mentionCount >= richThreshold) {
      const key = knowledgeKey(entity.canonical, "biography");
      if (!input.existingKeys.has(key)) {
        targets.push({
          subjectType: "entity",
          subjectId  : entity.id,
          subjectKey : entity.canonical,
          bookId     : input.bookId,
          bookTitle  : input.bookTitle,
          field      : "biography",
          reason     : `rich 档（提及 ${String(entity.mentionCount)} 段 ≥ ${String(richThreshold)}）→ 补籍贯/字号/原型`,
          query      : `${input.bookTitle} ${entity.canonical}`
        });
      }
    }
  }

  return targets;
}
