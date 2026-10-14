import { z } from "zod";

import { ENTITY_TYPES } from "@/lib/entities";

/**
 * 模型输出契约（Zod schema）。
 *
 * 定位：这是「外部输入」的唯一收口 —— 大模型返回的 JSON 一律经此处校验，
 * 禁止用 `as` 断言绕过（见 `type-external-input-zod`）。
 *
 * 设计原则：
 * - 字段名与 v1 goldset（`scripts/goldset/schema.ts`）对齐，保证评测口径可直接复用；
 * - 所有集合字段给默认值，模型漏字段不应导致整片作废；
 * - 关系证据只要求 `quote`，坐标由服务端在原文中唯一匹配落定（P2 grounding）。
 */

/** 实体类型：取值来自 `@/lib/entities` 的单一数据源。 */
export const EntityTypeSchema = z.enum(ENTITY_TYPES);

/** 名字类型：与 v1 goldset `NameTypeEnum` 一致。 */
export const NameTypeSchema = z.enum(["NAMED", "TITLE_ONLY"]);

/** 候选实体。 */
export const ExtractedEntitySchema = z.object({
  canonical: z.string().min(1),
  type     : EntityTypeSchema,
  nameType : NameTypeSchema.default("NAMED"),
  aliases  : z.array(z.string().min(1)).default([])
});

/** 候选关系。 */
export const ExtractedRelationSchema = z.object({
  /** 关系码；取值必须落在 `RELATION_TYPES` 闭集内，越界由 P1 后处理判为问题。 */
  typeCode       : z.string().min(1),
  sourceCanonical: z.string().min(1),
  targetCanonical: z.string().min(1),
  /** 支撑该关系的原文引用；P2 会用它做字面匹配。 */
  quote          : z.string().min(1)
});

/** 单片提取结果。 */
export const SliceExtractionSchema = z.object({
  entities : z.array(ExtractedEntitySchema).default([]),
  relations: z.array(ExtractedRelationSchema).default([])
});

/** 词典预扫描的分类结果（P0 阶段由小模型返回）。 */
export const DictionaryVerdictSchema = z.object({
  name    : z.string().min(1),
  /** 是否认定为可入图谱的实体名。 */
  accepted: z.boolean(),
  type    : EntityTypeSchema.default("PERSON")
});

export const DictionaryResultSchema = z.object({
  verdicts: z.array(DictionaryVerdictSchema).default([])
});

// 二审（P3）的 `ReviewVerdictSchema` / `ReviewResultSchema` 已随 P3 删除
// （2026-10-10）。删除理由见 `pipeline/run.ts` 文件头「为什么没有 P3」：
// 它要求逐实体输出判定，体量 O(名字数)，在 maxTokens=8192 下必然截断，
// 历史上从未成功过一次。若将来改用分批方案，需连同提示词一起恢复。

// 实体类型不在本文件重新定义，直接转发共享层的单一数据源，
// 避免 `z.infer` 与 `@/lib/entities` 产生两个名义不同、实质相同的类型。
export type { EntityType } from "@/lib/entities";
export type NameType = z.infer<typeof NameTypeSchema>;
export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;
export type ExtractedRelation = z.infer<typeof ExtractedRelationSchema>;
export type SliceExtraction = z.infer<typeof SliceExtractionSchema>;
export type DictionaryVerdict = z.infer<typeof DictionaryVerdictSchema>;
