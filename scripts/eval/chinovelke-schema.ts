import { z } from "zod";

/**
 * ChiNovelKE 基准数据集的 schema。
 *
 * 来源：HuggingFace `mouseart2025/ChiNovelKE`（**CC-BY-4.0**，1 个 row / train split）。
 * 这是参考项目 AI-Reader-V2 的**公开基准**，用于把 v3 放在**同一把尺子**上与它对照。
 *
 * ⚠️ **本文件仅供评测脚本使用，不进入应用运行时**（与 `goldset-schema.ts` 同规矩）。
 * ⚠️ 数据集文件**不入库**（放镜像侧 `verify/chinovelke/`），保留 CC-BY-4.0 归属。
 *
 * ## 已实测的字段事实（2026-10-13 全字段普查）
 *
 * | 维度 | 字段 | 可复现官方基线？ |
 * |---|---|---|
 * | `characters` | `name` / `mention_count` / `first_chapter` / `last_chapter` / **`is_valid_character`** / `correct_name` / `notes` | ✅ 实体精确率 |
 * | `relations` | `person_a` / `person_b` / **`system_type`** / `mention_count` / `example_evidence` / `example_chapter` / **`correct_type`** / **`correct_category`** / `notes` | ✅ 关系类型准确率；❌ **关系类别**（无 `system_category`） |
 * | `aliases` | `canonical_name` / `system_aliases` / **`is_correct_grouping`** / `wrong_aliases` / `missing_aliases` / `notes` | ✅ 别名分组准确率 |
 * | `location_hierarchy` | `name` / `correct_parent` / `tier`（+ 可选 `_note`） | ❌ **无 `system_parent`** |
 *
 * 🚨 **三处必须记住的结构性事实**：
 * 1. **红楼（`dream_of_red_chamber`）没有 `aliases` 维度**；**水浒（`water_margin`）没有 `location_hierarchy`**。
 * 2. 金标只覆盖**每书最高频 Top-50** 人物/关系对 → 这是**偏易样本**，与 v3 自有的**穷尽标注**金标**不可直接相比**。
 * 3. `is_valid_character` 只贴在**参考系统自己抽出的 50 个名字**上 → 给 v3 打分时，**集外名字无标签**（详见 `chinovelke-metrics.ts`）。
 */

/** 关系类别闭集（官方 6 类）。 */
export const ChiNovelKeCategorySchema = z.enum([
  "family",
  "intimate",
  "hierarchical",
  "social",
  "hostile",
  "other"
]);

/** 地点层级闭集（官方 tier 体系）。 */
export const ChiNovelKeTierSchema = z.enum([
  "continent",
  "kingdom",
  "region",
  "city",
  "site",
  "building"
]);

/** ① 人物抽取的一条金标。 */
export const ChiNovelKeCharacterSchema = z.object({
  name              : z.string().min(1),
  mention_count     : z.number().int().nonnegative().optional(),
  first_chapter     : z.number().int().optional(),
  last_chapter      : z.number().int().optional(),
  /** 参考系统抽出的这个名字**是否**为有效人物（false = 泛称等噪声）。 */
  is_valid_character: z.boolean(),
  /** 别名归并后的规范名；`null` = 无需归并。 */
  correct_name      : z.string().nullable().optional(),
  notes             : z.string().optional()
});

/** ② 关系分类的一条金标。 */
export const ChiNovelKeRelationSchema = z.object({
  person_a        : z.string().min(1),
  person_b        : z.string().min(1),
  /** **参考系统**给出的关系类型（`null` 表示它没给出）。 */
  system_type     : z.string().nullable().optional(),
  mention_count   : z.number().int().nonnegative().optional(),
  example_evidence: z.string().optional(),
  example_chapter : z.number().int().optional(),
  /** 人工标注的正确类型。 */
  correct_type    : z.string().min(1),
  /** 人工标注的正确类别。 */
  correct_category: ChiNovelKeCategorySchema,
  notes           : z.string().optional()
});

/** ③ 别名解析的一条金标。 */
export const ChiNovelKeAliasSchema = z.object({
  canonical_name     : z.string().min(1),
  system_aliases     : z.array(z.string()),
  /** 参考系统的这个别名组**是否正确**。 */
  is_correct_grouping: z.boolean(),
  wrong_aliases      : z.array(z.string()),
  missing_aliases    : z.array(z.string()),
  notes              : z.string().optional()
});

/** ④ 地点层级的一条金标。 */
export const ChiNovelKeLocationSchema = z.object({
  name          : z.string().min(1),
  correct_parent: z.string().nullable(),
  /**
   * ⚠️ **可空** —— 实测红楼有一条 `金陵十二钗正册` 的 `tier` 是 `null`
   * （「册」是书册而非地点，属数据集自身瑕疵）。用 `.nullable()` 而不是把它塞进枚举，
   * 是为了**如实保留**这个瑕疵而不是掩盖它。
   */
  tier          : ChiNovelKeTierSchema.nullable(),
  _note         : z.string().optional()
});

/** 单个维度的容器（`annotated`/`annotation_rules` 在不同维度出现与否不同）。 */
export const ChiNovelKeCharacterDimSchema = z.object({
  count    : z.number().int().nonnegative(),
  annotated: z.number().int().nonnegative().optional(),
  entries  : z.array(ChiNovelKeCharacterSchema)
});
export const ChiNovelKeRelationDimSchema = z.object({
  count    : z.number().int().nonnegative(),
  annotated: z.number().int().nonnegative().optional(),
  entries  : z.array(ChiNovelKeRelationSchema)
});
export const ChiNovelKeAliasDimSchema = z.object({
  count    : z.number().int().nonnegative(),
  annotated: z.number().int().nonnegative().optional(),
  entries  : z.array(ChiNovelKeAliasSchema)
});
export const ChiNovelKeLocationDimSchema = z.object({
  count           : z.number().int().nonnegative(),
  annotation_rules: z.array(z.string()).optional(),
  entries         : z.array(ChiNovelKeLocationSchema)
});

/**
 * 一部书的标注集合。
 *
 * ⚠️ 四个维度**全部可选** —— 因为实测红楼无 `aliases`、水浒无 `location_hierarchy`。
 * 用 `.optional()` 而不是 `.default()`：**「这个维度不存在」与「这个维度为空」是两件事**，
 * 前者应被如实报告为 `N/A`，不能被静默当成「0 条」。
 */
export const ChiNovelKeNovelSchema = z.object({
  title      : z.string().min(1),
  title_en   : z.string().optional(),
  author     : z.string().optional(),
  /** 题材（`fantasy` / `realistic` / `wuxia`）—— 参考项目**确有**题材概念，但只用于提示词注入。 */
  genre      : z.string().min(1),
  chapters   : z.number().int().positive(),
  annotations: z.object({
    characters        : ChiNovelKeCharacterDimSchema.optional(),
    relations         : ChiNovelKeRelationDimSchema.optional(),
    aliases           : ChiNovelKeAliasDimSchema.optional(),
    location_hierarchy: ChiNovelKeLocationDimSchema.optional()
  })
});

/** 数据集根对象。 */
export const ChiNovelKeSchema = z.object({
  metadata: z.object({
    name     : z.string(),
    full_name: z.string().optional(),
    version  : z.string(),
    license  : z.string(),
    citation : z.string().optional(),
    url      : z.string().optional()
  }).loose(),
  novels: z.record(z.string(), ChiNovelKeNovelSchema)
});

/** 数据集根对象类型。 */
export type ChiNovelKe = z.infer<typeof ChiNovelKeSchema>;
/** 单部书类型。 */
export type ChiNovelKeNovel = z.infer<typeof ChiNovelKeNovelSchema>;
/** 关系类别类型。 */
export type ChiNovelKeCategory = z.infer<typeof ChiNovelKeCategorySchema>;
