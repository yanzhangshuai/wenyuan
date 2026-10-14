/**
 * ChiNovelKE 对标评测（只读，零 LLM 成本）。
 *
 * 目的：把 v3 放在**参考项目 AI-Reader-V2 的公开基准**上打分，从而**客观对标**，
 * 而不是拿两套不同口径的数字互相比。
 *
 * ## 两种模式
 *
 * ```bash
 * # ① 硬自检：用数据集内嵌的参考系统输出复算官方基线（不连库）
 * tsx --conditions=react-server scripts/eval/chinovelke-eval.ts \
 *   --dataset <chinovelke.json> --selfcheck
 *
 * # ② 给 v3 打分：读库内图谱 → 按官方口径打分
 * tsx --conditions=react-server scripts/eval/chinovelke-eval.ts \
 *   --dataset <chinovelke.json> --work 红楼梦 [--top 50]
 * ```
 *
 * ## 🚨 读结果前必读（六处口径约束，见 `chinovelke-metrics.ts` 文件头）
 * 1. **金标是偏易样本**（每书最高频 Top-50），与 v3 自有**穷尽标注**金标**不可直接相比**。
 * 2. **人物抽取有 `unlabeled`**：v3 输出集外名字无标签 → 只在**已标注子集**上算精确率，unlabeled 单列。
 * 3. **关系「类型」不可比、「类别」可比**：官方是细粒度称谓、v3 是 10 个粗粒度码 → **目录错配**。
 *    本脚本**只报类别**，并公开 `V3_CATEGORY_TO_OFFICIAL` 映射表。
 * 4. 🆕 **关系类别要报「严格 / 宽松」两个界**（批次 45）：同一对可能有多条不同类别的关系，
 *    「取哪条」是**尺子口径**而非系统能力 → 两个界**成对读**，差值单列为 `tieBreakLosses`。
 *    关系装载已加**显式 `ORDER BY`**（`start_chapter, relation_type_code, id`）→ 分数**可复现**。
 * 5. 🆕 **金标自身有重复条目**（批次 45）：归一化后同一对可能记多次（红楼 `宝玉—黛玉` ×3，
 *    金标 `notes` 自述）→ 报 `uniqueGoldPairs`，**不改金标内容**。
 * 6. 🆕 **`intimate` 是映射缺口**（批次 45）：v3 的 5 类里没有它 → 该类条目**结构上不可赢**，
 *    单列并另报「可比子集」准确率。**不得把它算成系统的错**。
 */
import { readFile } from "node:fs/promises";

import { eq } from "drizzle-orm";

import { RELATION_TYPES } from "@/lib/relations";
import { normalizeName } from "@/lib/text";
import { getDatabase } from "@/server/db/client";
import {
  entities as entitiesTable,
  entityAliases,
  entityMentions,
  relationships,
  books
} from "@/server/db/schema";

import {
  OFFICIAL_BASELINE,
  V3_CATEGORY_TO_OFFICIAL,
  scoreAliasGroups,
  scoreEntityPrecision,
  scoreRelationCategory,
  selfCheck,
  type V3EntityRow,
  type V3RelationRow
} from "./chinovelke-metrics";
import { ChiNovelKeSchema } from "./chinovelke-schema";

/** 作品标题 → 数据集键。匹配用 `startsWith`，故顺序敏感（长别名在前）。 */
const TITLE_TO_NOVEL: readonly (readonly [string, string])[] = [
  ["红楼梦", "dream_of_red_chamber"],
  ["石头记", "dream_of_red_chamber"],
  ["西游记", "journey_to_west"],
  ["水浒传", "water_margin"],
  ["水浒", "water_margin"]
];

/** v3 的关系码 → 类别下标（0–4）。 */
const CODE_TO_CATEGORY: ReadonlyMap<string, number> = new Map(
  RELATION_TYPES.map((item) => [item.code, item.category])
);

function parseArgs(argv: readonly string[]): { dataset: string; selfcheck: boolean; book: string | undefined; top: number } {
  let dataset = "";
  let selfcheck = false;
  let book: string | undefined;
  let top = 50;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dataset") {
      dataset = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--selfcheck") {
      selfcheck = true;
    } else if (arg === "--work") {
      book = argv[index + 1];
      index += 1;
    } else if (arg === "--top") {
      top = Number(argv[index + 1] ?? "50");
      index += 1;
    }
  }
  if (dataset === "") {
    throw new Error(
      "用法：chinovelke-eval.ts --dataset <chinovelke.json> (--selfcheck | --work <作品标题>) [--top 50]"
    );
  }
  return { dataset, selfcheck, book, top };
}

/** 自检模式：不连库，只验指标实现。 */
async function runSelfCheck(datasetPath: string): Promise<number> {
  const dataset = ChiNovelKeSchema.parse(JSON.parse(await readFile(datasetPath, "utf8")) as unknown);
  const rows = selfCheck(dataset);

  console.log("═".repeat(78));
  console.log("ChiNovelKE 硬自检 —— 用数据集内嵌的参考系统输出复算官方基线");
  console.log("═".repeat(78));
  console.log(`数据集：${datasetPath}`);
  console.log(`版本  ：${dataset.metadata.version}　许可：${dataset.metadata.license}`);
  console.log("");
  console.log("  作品        实体精确率        关系类型准确率      别名分组准确率");
  let failed = 0;
  for (const row of rows) {
    const official = OFFICIAL_BASELINE[row.novelKey];
    const mark = (ok: boolean | null) => (ok === null ? "—" : ok ? "✅" : "❌");
    if (!row.entityOk || !row.relationTypeOk || row.aliasGroupOk === false) {
      failed += 1;
    }
    console.log(
      `  ${row.title.padEnd(6)}  ${row.entityPrecision.toFixed(1).padStart(5)}% (官方 ${String(official?.entityPrecision ?? "?")}%) ${mark(row.entityOk)}` +
        `   ${row.relationType.toFixed(1).padStart(5)}% (官方 ${String(official?.relationType ?? "?")}%) ${mark(row.relationTypeOk)}` +
        `   ${row.aliasGroup === null ? "  N/A" : `${row.aliasGroup.toFixed(1).padStart(5)}%`} ${mark(row.aliasGroupOk)}`
    );
  }
  console.log("");
  console.log("🚨 无法复现的两个维度（字段普查确认，非本实现的问题）：");
  console.log("   · 关系类别准确率（官方 64/86/34）：数据集**没有 `system_category`**");
  console.log("   · 地点层级精确率（官方 65.6/55.8）：数据集**没有 `system_parent`**");
  console.log("");
  if (failed > 0) {
    console.log(`❌ ${String(failed)} 部书的可复现维度**未逐字命中** → 指标实现有偏，报告作废`);
    return 1;
  }
  console.log("✅ 3 个可复现维度**逐字命中**官方基线 → 指标实现与官方一致，可用于给 v3 打分");
  return 0;
}

/** v3 侧图谱。 */
interface V3Graph {
  readonly entities : readonly (V3EntityRow & { readonly type: string })[];
  readonly aliases  : readonly { readonly canonical: string; readonly aliases: readonly string[] }[];
  readonly relations: readonly V3RelationRow[];
}

/** 读 v3 图谱（按提及数降序）。 */
async function loadV3Graph(bookTitle: string): Promise<V3Graph> {
  const db = getDatabase();
  const [bookRow] = await db
    .select({ id: books.id })
    .from(books)
    .where(eq(books.title, bookTitle))
    .limit(1);
  if (bookRow === undefined) {
    throw new Error(`库里没有《${bookTitle}》`);
  }

  const entityRows = await db
    .select({ id: entitiesTable.id, canonical: entitiesTable.canonical, type: entitiesTable.type })
    .from(entitiesTable)
    .where(eq(entitiesTable.bookId, bookRow.id));

  const mentionRows = await db
    .select({ entityId: entityMentions.entityId })
    .from(entityMentions)
    .innerJoin(entitiesTable, eq(entitiesTable.id, entityMentions.entityId))
    .where(eq(entitiesTable.bookId, bookRow.id));

  const aliasRows = await db
    .select({ entityId: entityAliases.entityId, alias: entityAliases.alias })
    .from(entityAliases)
    .where(eq(entityAliases.bookId, bookRow.id));

  // 🚨 批次 45：**必须显式排序** —— 否则「同一对取哪条关系」由 DB 行序决定，分数**不可复现**。
  //    语义 = 取**最早观察到**的那条（`start_chapter` 最小）；并列按关系码、`id` 兜底保证**全序**。
  //    该顺序喂给 `scoreRelationCategory` 的「严格口径」；宽松口径（任一条命中）不依赖顺序。
  const relationRows = await db
    .select({
      typeCode: relationships.relationTypeCode,
      sourceId: relationships.sourceEntityId,
      targetId: relationships.targetEntityId
    })
    .from(relationships)
    .where(eq(relationships.bookId, bookRow.id))
    .orderBy(relationships.startChapter, relationships.relationTypeCode, relationships.id);

  const mentionCount = new Map<string, number>();
  for (const row of mentionRows) {
    mentionCount.set(row.entityId, (mentionCount.get(row.entityId) ?? 0) + 1);
  }

  const aliasByEntity = new Map<string, string[]>();
  for (const row of aliasRows) {
    const bucket = aliasByEntity.get(row.entityId) ?? [];
    bucket.push(row.alias);
    aliasByEntity.set(row.entityId, bucket);
  }

  const nameById = new Map(entityRows.map((row) => [row.id, row.canonical]));

  const entities: (V3EntityRow & { type: string })[] = entityRows
    .map((row) => ({
      name        : row.canonical,
      mentionCount: mentionCount.get(row.id) ?? 0,
      type        : row.type
    }))
    .sort((left, right) => right.mentionCount - left.mentionCount);

  const aliases = entityRows.map((row) => ({
    canonical: row.canonical,
    aliases  : aliasByEntity.get(row.id) ?? []
  }));

  const relations: V3RelationRow[] = relationRows.flatMap((row) => {
    const source = nameById.get(row.sourceId);
    const target = nameById.get(row.targetId);
    if (source === undefined || target === undefined) {
      return [];
    }
    return [{ source, target, category: CODE_TO_CATEGORY.get(row.typeCode) ?? 4 }];
  });

  return { entities, aliases, relations };
}

/** 打分模式。 */
async function runBook(datasetPath: string, bookTitle: string, top: number): Promise<number> {
  const dataset = ChiNovelKeSchema.parse(JSON.parse(await readFile(datasetPath, "utf8")) as unknown);

  const hit = TITLE_TO_NOVEL.find(([title]) => normalizeName(bookTitle).startsWith(normalizeName(title)));
  if (hit === undefined) {
    throw new Error(`《${bookTitle}》不在 ChiNovelKE 的三本书里（西游记 / 红楼梦 / 水浒传）`);
  }
  const novelKey = hit[1];
  const novel = dataset.novels[novelKey];
  if (novel === undefined) {
    throw new Error(`数据集里没有 ${novelKey}`);
  }

  const graph = await loadV3Graph(bookTitle);

  console.log("═".repeat(78));
  console.log(`ChiNovelKE 对标 —— v3《${bookTitle}》 vs 参考项目《${novel.title}》（${novel.genre}）`);
  console.log("═".repeat(78));
  console.log("⚠️ 口径 A（同口径 Top-50，**偏易样本**）与 v3 自有**穷尽标注**金标**不可直接相比**。");
  console.log(`v3 图谱：实体 ${String(graph.entities.length)}　关系 ${String(graph.relations.length)}`);
  console.log("");

  // ── ① 人物抽取 ──
  // 🚨 **必须先按 `type = PERSON` 过滤** —— 这是**协议对齐**，不是放水：
  //    实测参考项目判为「无效」的条目**全是泛称**（土地/小妖/国王/众僧/小丫头/婆子…），
  //    **没有一个是地点** → 说明官方的 characters 维度**只在 person 类型里取 Top-50**。
  //    不过滤的话，v3 的地名（荣府/大观园/怡红院…）会落进 `unlabeled` 桶，虚增可比性噪声。
  const persons = graph.entities.filter((entity) => entity.type === "PERSON");
  const topEntities = persons.slice(0, top);
  const entityResult = scoreEntityPrecision(topEntities, novel);
  const official = OFFICIAL_BASELINE[novelKey];
  const nonPersonInTop = graph.entities
    .slice(0, top)
    .filter((entity) => entity.type !== "PERSON").length;
  console.log(
    `【① 人物抽取】v3 按 type=PERSON 过滤后取提及数 Top-${String(top)}（实际 ${String(topEntities.length)} 个）`
  );
  console.log(
    `   （不过滤的话，Top-${String(top)} 里会混入 ${String(nonPersonInTop)} 个非 PERSON —— 那不是官方的口径）`
  );
  console.log(`   ✅ 有效 ${String(entityResult.valid.length)}　❌ 无效 ${String(entityResult.invalid.length)}　⚠️ 无标签 ${String(entityResult.unlabeled.length)}`);
  console.log(
    `   已标注子集上的精确率 = ${entityResult.precisionOnLabeled.toFixed(1)}%` +
      `（参考项目官方 ${String(official?.entityPrecision ?? "?")}%）`
  );
  console.log(`   ⚠️ 已标注覆盖率 = ${entityResult.labeledCoverage.toFixed(1)}%（越低 → 可比性越弱）`);
  if (entityResult.invalid.length > 0) {
    console.log(`   判为无效：${entityResult.invalid.slice(0, 20).join("　")}`);
  }
  // 🚨 **必须把 unlabeled 摊开** —— 「无标签」既可能是「金标没有的真名」，也可能是「金标没标的噪声」。
  //    不摊开就无法判断 100% 的精确率是真精确，还是被 unlabeled 藏住了噪声。
  if (entityResult.unlabeled.length > 0) {
    console.log("   ⚠️ 无标签（须人工判断是真名还是噪声，**不得默认算作有效**）：");
    console.log(`      ${entityResult.unlabeled.join("　")}`);
  }
  console.log("");

  // ── ② 关系类别（唯一公平可比的子项）──
  // 🆕 批次 45：**两个名字口径都跑**。字面口径与历史读数可比；别名归一口径才看得见
  //    「金标写 `林黛玉`、v3 规范名是 `黛玉`」这类名字变体（否则它们会落进 `missing` 桶）。
  const aliasResolver = new Map<string, string>();
  for (const group of graph.aliases) {
    const canonical = normalizeName(group.canonical);
    for (const alias of group.aliases) {
      aliasResolver.set(normalizeName(alias), canonical);
    }
  }
  const resolveByAlias = (name: string): string =>
    aliasResolver.get(normalizeName(name)) ?? normalizeName(name);

  const relationResult = scoreRelationCategory(graph.relations, novel);
  const relationByAlias = scoreRelationCategory(graph.relations, novel, { resolveName: resolveByAlias });
  const goldPairCount = (novel.annotations.relations?.entries ?? []).length;
  console.log("【② 关系类别】（⚠️ **不比类型** —— 官方是细粒度称谓、v3 是 10 个粗粒度码，**目录错配**）");
  console.log(`   映射表 v3 类别 → 官方类别：${JSON.stringify(V3_CATEGORY_TO_OFFICIAL)}`);
  console.log(`   ✅ 命中 ${String(relationResult.matched.length)}　❌ 类别错 ${String(relationResult.mismatched.length)}　⚠️ v3 未给出 ${String(relationResult.missing.length)}`);
  console.log(
    `   在「金标有且 v3 也给出」的子集上的类别准确率 = ${relationResult.accuracyOnMatched.toFixed(1)}%` +
      `（官方 ${String(official?.relationCategory ?? "?")}%）`
  );
  console.log(`   ⚠️ v3 在金标 ${String(goldPairCount)} 对上的覆盖率 = ${relationResult.coverage.toFixed(1)}%`);
  for (const item of relationResult.mismatched.slice(0, 15)) {
    console.log(`      ✗ ${item.pair}：v3=${item.got} 官方=${item.want}`);
  }
  // 🚨 批次 45：下面这些**必须与上面的数字一起读**，否则会把「尺子口径」误读成「系统能力」。
  console.log("   ── 🚨 口径（批次 45 修正：**两个界成对读，不许单独引用**）──");
  console.log(
    `   严格（取**最早观察到**的那条）= ${relationResult.accuracyOnMatched.toFixed(1)}%　` +
      `宽松（该对**任一条**命中即算）= ${relationResult.accuracyLenient.toFixed(1)}%　` +
      `→ 差 ${String(relationResult.tieBreakLosses.length)} 条 = **尺子口径的影响量**`
  );
  if (relationResult.tieBreakLosses.length > 0) {
    console.log(`      仅因「取哪条」而失手：${relationResult.tieBreakLosses.join("　")}`);
  }
  console.log(
    `   ⚠️ 该对多条关系**跨 ≥2 个 v3 类别**的金标对 = ${String(relationResult.ambiguousPairs.length)} / ${String(goldPairCount)}`
  );
  if (relationResult.duplicateEntries.length > 0) {
    console.log(
      `   ⚠️ 金标**重复条目** = ${String(relationResult.duplicateEntries.length)} 条（归一化后同一对）` +
        ` → 唯一关系对 = ${String(relationResult.uniqueGoldPairs)} / ${String(goldPairCount)}`
    );
    console.log(`      ${relationResult.duplicateEntries.join("　")}`);
  }
  if (relationResult.unreachableGold.length > 0) {
    console.log(
      `   🚨 **映射缺口**：官方类别 ${relationResult.unreachableCategories.join("/")} 在 v3 的 5 类里**不可达**` +
        ` → ${String(relationResult.unreachableGold.length)} 条金标**结构上不可赢**`
    );
    console.log(`      ${relationResult.unreachableGold.join("　")}`);
  }
  console.log(
    `   ✅ 剔除「不可达类别」后的准确率（**可比子集**）= ${relationResult.accuracyOnComparable.toFixed(1)}%`
  );
  // 🆕 批次 45：**别名归一口径** —— 金标写 `林黛玉`、v3 规范名是 `黛玉`。
  //    字面口径下这些条目落进 `missing` 桶（**不进准确率分母**）→ **口径意外宽松**。
  console.log("   ── 🆕 别名归一口径（用 v3 的别名组解析金标名字）──");
  console.log(
    `   命中 ${String(relationByAlias.matched.length)}　类别错 ${String(relationByAlias.mismatched.length)}` +
      `　缺失 ${String(relationByAlias.missing.length)}　→ 准确率 = ${relationByAlias.accuracyOnMatched.toFixed(1)}%`
  );
  if (relationByAlias.duplicateEntries.length > 0) {
    console.log(
      `   🚨 **金标重复条目** = ${String(relationByAlias.duplicateEntries.length)} 条（别名归一后同一对）` +
        ` → **唯一关系对 = ${String(relationByAlias.uniqueGoldPairs)}** / ${String(goldPairCount)}`
    );
    console.log(`      ${relationByAlias.duplicateEntries.join("　")}`);
  } else {
    console.log("   金标重复条目 = 0（别名归一后仍无重复对）");
  }
  console.log(
    `   ⚠️ 字面口径 → 别名口径：缺失 ${String(relationResult.missing.length)} → ${String(relationByAlias.missing.length)}` +
      "（**减少的部分是「名字变体」而非「系统没抽到」**）"
  );
  if (relationByAlias.missing.length > 0) {
    console.log(`   别名口径下**仍缺失**：${relationByAlias.missing.join("　")}`);
  }
  console.log("");

  // ── ③ 别名分组（红楼 N/A）──
  const aliasResult = scoreAliasGroups(graph.aliases, novel);
  if (aliasResult === null) {
    console.log("【③ 别名分组】N/A —— 该数据集里**这本没有 aliases 维度**（红楼无、水浒无地点）");
  } else {
    console.log("【③ 别名分组】（⚠️ **金标别名表是重建的**：canonical ∪ system_aliases ∪ missing_aliases）");
    console.log(`   ✅ 正确 ${String(aliasResult.correct.length)}　❌ 不正确 ${String(aliasResult.incorrect.length)}　金标别名总数 ${String(aliasResult.goldSize)}`);
    console.log(
      `   准确率 = ${aliasResult.accuracy.toFixed(1)}%（参考项目官方 ${String(official?.aliasGroup ?? "?")}%）`
    );
  }
  console.log("");

  // ── ④ 地点层级 ──
  console.log("【④ 地点层级】N/A —— **v3 完全没有这个维度**（如实标注为缺口，不伪造）");
  return 0;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfcheck) {
    return runSelfCheck(options.dataset);
  }
  if (options.book === undefined) {
    throw new Error("需要 --selfcheck 或 --work <作品标题>");
  }
  return runBook(options.dataset, options.book, options.top);
}

process.exit(await main());
