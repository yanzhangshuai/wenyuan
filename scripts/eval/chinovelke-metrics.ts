import { normalizeName } from "@/lib/text";

import type { ChiNovelKe, ChiNovelKeCategory, ChiNovelKeNovel } from "./chinovelke-schema";

/**
 * ChiNovelKE 的指标实现（**重实现**，因为官方 `eval_dashboard.py` 在私有仓库里 —— raw URL 实测 404）。
 *
 * ## 为什么这个文件可信：**硬自检**
 *
 * 数据集**内嵌了参考系统自己的输出**（`system_type` / `is_valid_character` / `is_correct_grouping`）。
 * 因此「官方基线」可以**用本文件的指标代码从数据集本身算出来**。
 * `selfCheck()` 把复算结果与官方公布值逐字比对，不命中就说明**指标实现有偏**，报告作废。
 *
 * 2026-10-13 实测：**3 个维度逐字命中**
 *
 * | 维度 | 复算 | 官方 |
 * |---|---|---|
 * | 实体精确率 | 78.0 / 96.0 / 100.0 | 78 / 96 / 100 |
 * | 关系类型准确率 | 76.0 / 82.0 / 22.0 | 76 / 82 / 22 |
 * | 别名分组准确率 | 42.9 / — / 47.1 | 42.9 / — / 47.1 |
 *
 * ## 🚨 两个维度**无法**复现（字段普查确认）
 * - **关系类别准确率**（官方 64/86/34）：数据集**没有 `system_category`**。⚠️ 试过「按 `system_type`
 *   多数票反推映射」，上界仅 94/96/84%，与官方 64/86/34 相差极远 → 官方用的是它**逐条的实际判定**，
 *   不可从数据反推。→ **本文件不产出官方的关系类别数字**。
 * - **地点层级精确率**（官方 65.6/55.8）：数据集**没有 `system_parent`**，只有金标 `correct_parent`/`tier`。
 *
 * ## 🚨 给 v3 打分时的三个公平性约束（必须与结果一起读）
 * 1. **金标是偏易样本**：官方协议只取**每书最高频 Top-50** 人物/关系对；而 v3 的自有金标是**穷尽标注**。
 *    → **两套口径不可直接相比**。
 * 2. **人物抽取有 `unlabeled` 问题**：`is_valid_character` 只贴在**参考系统自己抽出的 50 个名字**上。
 *    v3 若输出集外名字 → **无标签**。→ 只在**已标注子集**上算精确率，并**单列 unlabeled 数**；
 *    **不得把 unlabeled 当 valid**（那会虚高）。
 * 3. **关系「类型」不可比、「类别」可比**：官方的 `correct_type` 是**细粒度称谓**（主仆/恋人/表兄妹/婆媳…），
 *    而 v3 的目录是 **10 个粗粒度码**（父子/母子/兄弟/夫妻/师生/同年/同僚/主仆/朋友/仇敌）。
 *    → 类型级对比是**目录错配**而非准确率问题；**只有类别级（6 类 vs v3 的 5 类）是公平比较**。
 */

/** 官方公布基线（来自 HuggingFace 数据集页的 Baseline Results 表）。 */
export const OFFICIAL_BASELINE: Readonly<
  Record<
    string,
    {
      readonly entityPrecision  : number;
      readonly relationType     : number;
      readonly relationCategory : number;
      readonly aliasGroup       : number | null;
      readonly locationHierarchy: number | null;
    }
  >
> = {
  journey_to_west     : { entityPrecision: 78.0,  relationType: 76.0, relationCategory: 64.0, aliasGroup: 42.9, locationHierarchy: 65.6 },
  dream_of_red_chamber: { entityPrecision: 96.0,  relationType: 82.0, relationCategory: 86.0, aliasGroup: null, locationHierarchy: 55.8 },
  water_margin        : { entityPrecision: 100.0, relationType: 22.0, relationCategory: 34.0, aliasGroup: 47.1, locationHierarchy: null }
};

/** 百分比保留一位小数，便于与官方公布值**逐字**比对。 */
function pct(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** 单部书的自检行。 */
export interface SelfCheckRow {
  readonly novelKey       : string;
  readonly title          : string;
  readonly entityPrecision: number;
  readonly relationType   : number;
  readonly aliasGroup     : number | null;
  readonly entityOk       : boolean;
  readonly relationTypeOk : boolean;
  readonly aliasGroupOk   : boolean | null;
}

/**
 * 从数据集**内嵌的参考系统输出**复算官方基线（3 个可复现维度）。
 *
 * @param dataset 已通过 schema 校验的数据集
 * @returns 每部书的复算值 + 是否与官方逐字一致
 */
export function selfCheck(dataset: ChiNovelKe): readonly SelfCheckRow[] {
  const rows: SelfCheckRow[] = [];
  for (const [novelKey, novel] of Object.entries(dataset.novels)) {
    const official = OFFICIAL_BASELINE[novelKey];
    const characters = novel.annotations.characters?.entries ?? [];
    const relations = novel.annotations.relations?.entries ?? [];
    const aliases = novel.annotations.aliases?.entries;

    const validCount = characters.filter((entry) => entry.is_valid_character).length;
    const entityPrecision = pct(validCount, characters.length);

    const typeHits = relations.filter((entry) => entry.system_type === entry.correct_type).length;
    const relationType = pct(typeHits, relations.length);

    const aliasGroup =
      aliases === undefined || aliases.length === 0
        ? null
        : pct(aliases.filter((entry) => entry.is_correct_grouping).length, aliases.length);

    rows.push({
      novelKey,
      title         : novel.title,
      entityPrecision,
      relationType,
      aliasGroup,
      entityOk      : official === undefined ? true : entityPrecision === official.entityPrecision,
      relationTypeOk: official === undefined ? true : relationType === official.relationType,
      aliasGroupOk:
        official?.aliasGroup == null || aliasGroup === null
          ? null
          : aliasGroup === official.aliasGroup
    });
  }
  return rows;
}

/** v3 侧的一个实体（用于人物抽取维度）。 */
export interface V3EntityRow {
  readonly name        : string;
  readonly mentionCount: number;
}

/** 人物抽取维度的结果。 */
export interface EntityPrecisionResult {
  /** 命中金标且 `is_valid_character = true`。 */
  readonly valid             : readonly string[];
  /** 命中金标且 `is_valid_character = false`（参考系统也被判为噪声的名字）。 */
  readonly invalid           : readonly string[];
  /** 🚨 **不在金标 50 个名字里 → 无标签**，不得计入 valid。 */
  readonly unlabeled         : readonly string[];
  /** 在**已标注子集**上的精确率（%）。 */
  readonly precisionOnLabeled: number;
  /** 已标注占比（%）：越低说明可比性越弱。 */
  readonly labeledCoverage   : number;
}

/**
 * 给 v3 的 Top-N 实体打「人物抽取」分。
 *
 * ⚠️ 只在**已标注子集**上算精确率；`unlabeled` 单列。把 unlabeled 当 valid 会**虚高**。
 *
 * @param v3Entities v3 图谱里的实体（调用方负责按提及数降序取 Top-N）
 * @param novel      数据集里的那一部书
 * @returns 三分桶 + 两个比率
 */
export function scoreEntityPrecision(
  v3Entities: readonly V3EntityRow[],
  novel: ChiNovelKeNovel
): EntityPrecisionResult {
  const gold = new Map(
    (novel.annotations.characters?.entries ?? []).map((entry) => [
      normalizeName(entry.name),
      entry.is_valid_character
    ])
  );

  const valid: string[] = [];
  const invalid: string[] = [];
  const unlabeled: string[] = [];
  for (const entity of v3Entities) {
    const verdict = gold.get(normalizeName(entity.name));
    if (verdict === undefined) {
      unlabeled.push(entity.name);
    } else if (verdict) {
      valid.push(entity.name);
    } else {
      invalid.push(entity.name);
    }
  }

  const labeled = valid.length + invalid.length;
  return {
    valid,
    invalid,
    unlabeled,
    precisionOnLabeled: pct(valid.length, labeled),
    labeledCoverage   : pct(labeled, v3Entities.length)
  };
}

/**
 * v3 的关系类别（0–4）→ 官方 6 类的**显式映射**。
 *
 * ⚠️ 这张表是**公平性风险点**，必须与结果一起公开，不得藏在代码里。
 *
 * v3 的类别：`0 亲属 / 1 友好 / 2 对立 / 3 从属 / 4 其他`（见 `src/lib/relations.ts`）。
 *
 * 🚨 **`兄弟` 的映射是有争议的**：官方自己的映射**前后不一致** —— 在《西游》把 `兄弟` 记成 `social`，
 * 在《红楼》《水浒》记成 `family`。本表取 `family`（与 v3 的「亲属」类别语义一致），
 * 但**必须标注这一处不确定**。
 */
export const V3_CATEGORY_TO_OFFICIAL: Readonly<Record<number, ChiNovelKeCategory>> = {
  0: "family",
  1: "social",
  2: "hostile",
  3: "hierarchical",
  4: "other"
};

/** v3 侧的一条关系（已归一化为可比较的形式）。 */
export interface V3RelationRow {
  readonly source  : string;
  readonly target  : string;
  /** v3 的类别下标（0–4）。 */
  readonly category: number;
}

/** 关系类别维度的结果。 */
export interface RelationCategoryResult {
  /** 严格口径（取**最早观察到**的那条）命中。 */
  readonly matched          : readonly string[];
  /** 严格口径下的类别错。 */
  readonly mismatched       : readonly { readonly pair: string; readonly got: string; readonly want: string }[];
  /** 🚨 金标有该关系、v3 图谱里**没有** → 无法得分（**不是错**，是缺失）。 */
  readonly missing          : readonly string[];
  /** 在「金标有且 v3 也给出」的子集上的类别准确率（%）。**严格口径**。 */
  readonly accuracyOnMatched: number;
  /** v3 在 50 对上的覆盖率（%）。 */
  readonly coverage         : number;

  // ── 🆕 批次 45：口径必须成对报，不许单独引用 ──
  /** 宽松口径（该对的**任一条**关系命中即算命中）命中。 */
  readonly matchedLenient   : readonly string[];
  /** 宽松口径下的类别错。 */
  readonly mismatchedLenient: readonly { readonly pair: string; readonly got: string; readonly want: string }[];
  /** 宽松口径准确率（%）。 */
  readonly accuracyLenient  : number;
  /** 该对的多条关系跨了 ≥2 个 v3 类别 → **口径会影响结果**。 */
  readonly ambiguousPairs   : readonly string[];
  /** 🚨 严格口径失手、宽松口径命中的对数 = **尺子口径的影响量**。 */
  readonly tieBreakLosses   : readonly string[];

  // ── 🆕 批次 45：金标自身的两处口径事实（**登记，不改分**）──
  /** 归一化后**同一对出现多次**的金标条目（第 2 次及以后）。 */
  readonly duplicateEntries     : readonly string[];
  /** 归一化后金标里的**唯一关系对数**。 */
  readonly uniqueGoldPairs      : number;
  /** 官方类别在 v3 的 5 类里**不可达**的金标条目（映射缺口）。 */
  readonly unreachableGold      : readonly string[];
  /** 不可达的官方类别名。 */
  readonly unreachableCategories: readonly string[];
  /** 剔除「不可达类别」条目后的准确率（%）。 */
  readonly accuracyOnComparable : number;
}

/**
 * 把一对名字归一化成一个无序键（关系无向比较）。
 *
 * @param resolve 名字解析器 —— **默认是 `normalizeName`**（字面口径）；
 *                传「别名归一器」即得到**别名解析口径**（金标写 `林黛玉`、v3 规范名是 `黛玉`）。
 */
function pairKey(left: string, right: string, resolve: (name: string) => string): string {
  return [resolve(left), resolve(right)].sort().join("\u0001");
}

/** `scoreRelationCategory` 的可选项。 */
export interface RelationCategoryOptions {
  /**
   * 🆕 批次 45：名字解析器。
   *
   * 缺省 = `normalizeName`（**字面口径**）。传「别名归一器」后，金标里的 `贾宝玉`/`林黛玉`
   * 会解析到 v3 的规范名 `宝玉`/`黛玉` → 才能看见「金标把同一对关系记了 3 次」这件事。
   *
   * ⚠️ 两种口径**必须分别报**，不许混用：字面口径下名字变体会落进 `missing` 桶
   * （**不进准确率分母**）→ 口径**意外宽松**。
   */
  readonly resolveName?: (name: string) => string;
}

/**
 * 给 v3 打「关系类别」分（**本维是唯一与官方公平可比的子项**）。
 *
 * ⚠️ **不比 `correct_type`** —— 官方是细粒度称谓、v3 是 10 个粗粒度码，**目录错配**；
 * 只有**类别**（6 类 vs 5 类）是公平比较。
 *
 * ## 🚨 批次 45 的三处尺子修正 —— **旧读数与新读数不可直接比**
 *
 * 1. **口径不再依赖「DB 行序」**：旧实现取 `select` 返回的**第一条**，而装载**没有 `ORDER BY`**
 *    → 同一张图也可能因行序不同而给出不同分。现在由调用方**显式排序**
 *    （`start_chapter, relation_type_code, id`），语义 = **取「最早观察到」的那条**。
 *    并**同时报两个界**：**严格**（`accuracyOnMatched`，取首条）与**宽松**
 *    （`accuracyLenient`，任一条命中即算）。两者之差 = `tieBreakLosses` = **尺子口径的影响量**。
 *    **必须成对读，不许单独引用。**
 * 2. **金标自身有重复条目**：归一化后同一对可能出现多次（红楼 `宝玉—黛玉` 记了 **3 次**，
 *    金标自己的 `notes` 承认「同一对关系的不同称呼」）→ 报 `duplicateEntries` 与 `uniqueGoldPairs`。
 *    **不改金标内容**，只把口径摊开。
 * 3. **`intimate` 是映射缺口**：`V3_CATEGORY_TO_OFFICIAL` 只映射 family / social / hostile /
 *    hierarchical / other，**没有 `intimate`** → 该类别的金标条目**结构上不可赢**。
 *    单列 `unreachableGold`，并另报 `accuracyOnComparable`（剔除不可达类别后的准确率）。
 *
 * @param v3Relations v3 的关系（名字 + 类别下标）；**调用方必须已按显式顺序给出**（见 `chinovelke-eval.ts`）
 * @param novel       数据集里的那一部书
 * @returns 严格 / 宽松两口径 + 重复条目 + 映射缺口
 */
export function scoreRelationCategory(
  v3Relations: readonly V3RelationRow[],
  novel: ChiNovelKeNovel,
  options: RelationCategoryOptions = {}
): RelationCategoryResult {
  const resolve = options.resolveName ?? normalizeName;

  // 保留同一对的**全部**关系（宽松口径与歧义计数要用）；严格口径取第一条（调用方已显式排序）。
  const categoriesByPair = new Map<string, number[]>();
  for (const relation of v3Relations) {
    const key = pairKey(relation.source, relation.target, resolve);
    const bucket = categoriesByPair.get(key) ?? [];
    bucket.push(relation.category);
    categoriesByPair.set(key, bucket);
  }

  const matched: string[] = [];
  const mismatched: { pair: string; got: string; want: string }[] = [];
  const missing: string[] = [];
  const matchedLenient: string[] = [];
  const mismatchedLenient: { pair: string; got: string; want: string }[] = [];
  const ambiguousPairs: string[] = [];
  const tieBreakLosses: string[] = [];
  const duplicateEntries: string[] = [];
  const unreachableGold: string[] = [];
  const unreachableCategories = new Set<string>();
  const seenPairs = new Map<string, number>();

  const reachable = new Set<string>(Object.values(V3_CATEGORY_TO_OFFICIAL));

  for (const gold of novel.annotations.relations?.entries ?? []) {
    const key = pairKey(gold.person_a, gold.person_b, resolve);
    const label = `${gold.person_a}—${gold.person_b}`;

    const seen = (seenPairs.get(key) ?? 0) + 1;
    seenPairs.set(key, seen);
    if (seen > 1) {
      duplicateEntries.push(label);
    }

    if (!reachable.has(gold.correct_category)) {
      unreachableCategories.add(gold.correct_category);
      unreachableGold.push(label);
    }

    const categories = categoriesByPair.get(key);
    if (categories === undefined || categories.length === 0) {
      missing.push(label);
      continue;
    }

    const firstCategory = categories[0] ?? 4;
    const got = V3_CATEGORY_TO_OFFICIAL[firstCategory] ?? "other";
    if (got === gold.correct_category) {
      matched.push(label);
    } else {
      mismatched.push({ pair: label, got, want: gold.correct_category });
    }

    const hitLenient = categories.some(
      (category) => (V3_CATEGORY_TO_OFFICIAL[category] ?? "other") === gold.correct_category
    );
    if (hitLenient) {
      matchedLenient.push(label);
      if (got !== gold.correct_category) {
        // 🚨 严格口径失手、宽松口径命中 → 这一条完全由**尺子口径**决定。
        tieBreakLosses.push(label);
      }
    } else {
      mismatchedLenient.push({ pair: label, got, want: gold.correct_category });
    }

    if (new Set(categories).size > 1) {
      ambiguousPairs.push(label);
    }
  }

  const given = matched.length + mismatched.length;
  const total = (novel.annotations.relations?.entries ?? []).length;

  // 「可比子集」= 剔除官方类别在 v3 的 5 类里**不可达**的条目。
  const unreachableSet = new Set(unreachableGold);
  const comparableMatched = matched.filter((label) => !unreachableSet.has(label)).length;
  const comparableMismatched = mismatched.filter((item) => !unreachableSet.has(item.pair)).length;

  return {
    matched,
    mismatched,
    missing,
    accuracyOnMatched    : pct(matched.length, given),
    coverage             : pct(given, total),
    matchedLenient,
    mismatchedLenient,
    accuracyLenient      : pct(matchedLenient.length, matchedLenient.length + mismatchedLenient.length),
    ambiguousPairs,
    tieBreakLosses,
    duplicateEntries,
    uniqueGoldPairs      : seenPairs.size,
    unreachableGold,
    unreachableCategories: [...unreachableCategories].sort(),
    accuracyOnComparable : pct(comparableMatched, comparableMatched + comparableMismatched)
  };
}

/** 别名维度的结果（⚠️ 红楼无该维度）。 */
export interface AliasGroupResult {
  readonly correct  : readonly string[];
  readonly incorrect: readonly string[];
  /** 重建的金标全集大小（`canonical ∪ system_aliases ∪ missing_aliases`）。 */
  readonly goldSize : number;
  readonly accuracy : number;
}

/**
 * 给 v3 打「别名分组」分。
 *
 * 🚨 **金标别名表是重建的** —— 数据集**没有**完整金标别名列表，只有参考系统的组 + 它漏掉的名字。
 * 本函数按 `{canonical_name} ∪ system_aliases ∪ missing_aliases` **重建已知全集**，
 * 再检查 v3 的组是否与该全集一致（组内不含 `wrong_aliases`、且覆盖全集）。
 * ⚠️ 这是**近似**，必须与结果一起标注。
 *
 * @param v3Groups v3 的别名组（每组 = 规范名 + 其别名）
 * @param novel    数据集里的那一部书
 * @returns 正确 / 不正确 / 金标规模 / 准确率
 */
export function scoreAliasGroups(
  v3Groups: readonly { readonly canonical: string; readonly aliases: readonly string[] }[],
  novel: ChiNovelKeNovel
): AliasGroupResult | null {
  const entries = novel.annotations.aliases?.entries;
  if (entries === undefined || entries.length === 0) {
    return null;
  }

  const v3ByCanonical = new Map(
    v3Groups.map((group) => [normalizeName(group.canonical), new Set(group.aliases.map(normalizeName))])
  );

  const correct: string[] = [];
  const incorrect: string[] = [];
  let goldSize = 0;

  for (const gold of entries) {
    const expected = new Set(
      [gold.canonical_name, ...gold.system_aliases, ...gold.missing_aliases].map(normalizeName)
    );
    expected.delete(normalizeName(gold.canonical_name));
    goldSize += expected.size;

    const actual = v3ByCanonical.get(normalizeName(gold.canonical_name));
    const forbidden = new Set(gold.wrong_aliases.map(normalizeName));
    const label = `${gold.canonical_name}（金标 ${String(expected.size)} 个别名）`;

    if (actual === undefined) {
      incorrect.push(`${label} —— v3 无此规范名`);
      continue;
    }
    const hasForbidden = [...actual].some((name) => forbidden.has(name));
    const covers = [...expected].every((name) => actual.has(name));
    if (covers && !hasForbidden) {
      correct.push(label);
    } else {
      const missed = [...expected].filter((name) => !actual.has(name));
      incorrect.push(
        `${label} —— ${hasForbidden ? "含错误别名" : ""}${missed.length > 0 ? ` 缺 ${String(missed.length)}` : ""}`
      );
    }
  }

  return {
    correct,
    incorrect,
    goldSize,
    accuracy: pct(correct.length, entries.length)
  };
}
