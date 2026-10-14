import { z } from "zod";

/**
 * 金标（goldset）schema。
 *
 * 与 v1 `scripts/goldset/schema.ts` **取值完全对齐**，使既有金标文件可直接复用，
 * 避免「换了项目就得重标一遍」的重复劳动。
 *
 * 约束：本文件仅供评测脚本使用，不进入应用运行时。
 */

/** 实体类型枚举。 */
export const GoldEntityTypeSchema = z.enum(["PERSON", "LOCATION", "ORGANIZATION", "CONCEPT"]);

/** 名字类型枚举。 */
export const GoldNameTypeSchema = z.enum(["NAMED", "TITLE_ONLY"]);

/** 金标实体。 */
export const GoldEntitySchema = z.object({
  canonical: z.string().min(1),
  type     : GoldEntityTypeSchema,
  nameType : GoldNameTypeSchema.default("NAMED"),
  aliases  : z.array(z.string()).default([])
});

/** 金标关系。 */
export const GoldRelationSchema = z.object({
  typeCode       : z.string().min(1),
  sourceCanonical: z.string().min(1),
  targetCanonical: z.string().min(1)
});

/** 金标文件（按章节粒度标注）。 */
export const GoldSetSchema = z.object({
  workTitle      : z.string().min(1),
  /**
   * 标注覆盖的**回号**区间（闭区间，如 `[1, 3]` 表示第 1–3 回）。
   *
   * 单位与 `chapters.ordinal` 一致，而 `ordinal` 的定义是「真实章节从 1 起、等于回号」
   * （见 `src/server/modules/importing/parse-text.ts`）。前置内容（出版方导读 /
   * 封面 / 版权页）的序号是 `0`，因此 `min(1)` 同时也是「不要把前置内容写进区间」的校验。
   *
   * 这条定义是**事后补上的** —— 在此之前本字段没有说明单位，而当时的
   * `chapters.ordinal` 还被前置内容占用着 1，于是 `[1, 3]` 被解读成
   * 「前言 + 第一回 + 第二回」，整章漏掉第三回。
   * `run-eval.ts` 现在会把区间解析到的**章节标题逐条打印**，可直接肉眼核对。
   */
  chapterRange   : z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  /**
   * 标注说明：**记录「金标与原文不一致」或「系统做不到」的条目及其证据**。
   *
   * 为什么必须有这个字段（本项目已经栽过四次）：
   * 每一次「指标难看」的排查，最终都发现坏的是尺子而不是系统 ——
   * `chapterRange` 没接上、`ordinal` 偏移一位、金标含 0 次出现的名字、
   * 金标把原文的 `师生` 标成了 `同僚`。而**这四次全都无法从 PRF 数字上看出来**：
   * 一个金标错误与一个系统缺陷在报告里长得一模一样。
   *
   * 于是处置方式分裂成两条，必须分开记录：
   * - **事实错误**（原文根本不支持）→ 直接从 `entities` / `relations` 里改掉，
   *   并在本字段留下「改了什么、依据是原文哪一段」，使后人不必重查；
   * - **真实缺口**（原文支持，但系统当前做不到）→ 留在金标里**照算 FN**，
   *   只在本字段说明它是什么性质的缺口。
   *
   * ⚠️ 本字段**不参与任何指标计算**。这是刻意的：把缺口从分母里剔除，
   * 就等于允许「指标不好看就改金标」，那比不修还危险。
   *
   * 每条须自带可核对的依据（回号 + 段落序号 + 原文引用），否则下次仍要重查一遍。
   */
  annotationNotes: z.array(z.string()).default([]),
  entities       : z.array(GoldEntitySchema).default([]),
  relations      : z.array(GoldRelationSchema).default([])
});

export type GoldEntity = z.infer<typeof GoldEntitySchema>;
export type GoldRelation = z.infer<typeof GoldRelationSchema>;
export type GoldSet = z.infer<typeof GoldSetSchema>;
