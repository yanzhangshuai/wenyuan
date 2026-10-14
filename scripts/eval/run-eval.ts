import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { and, eq, gte, lte } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import {
  chapters,
  entities as entitiesTable,
  entityAliases,
  entityMentions,
  paragraphs,
  relationships,
  books
} from "@/server/db/schema";

import { GoldSetSchema } from "./goldset-schema";
import type { EvalReport } from "./metrics";
import {
  describeChapterRange,
  isPrecisionReadable,
  renderAnnotationNotes,
  runEval,
  type ChapterRef,
  type LoadedGraph
} from "./scope";

/**
 * 评测执行脚本。
 *
 * 用法：
 *   pnpm eval <金标 JSON 路径>
 *   pnpm eval <金标 JSON 路径> --work-id <uuid>
 *
 * 流程：读取金标 → 从数据库拉取该书图谱 → 归一化比较 → 输出 PRF 报告。
 *
 * 设计原因：评测必须跑在**真实的落库数据**上，而不是内存中的中间产物 ——
 * 否则「归并后引用丢失」这类缺陷不会被发现（v1 的评测恰好从未跑通，
 * 因此该缺陷一直未被暴露）。
 */

/** 按作品标题读取图谱。 */
async function loadGraphByTitle(
  title: string,
  chapterRange: readonly [number, number]
): Promise<LoadedGraph> {
  const db = getDatabase();
  const rows = await db.select({ id: books.id }).from(books).where(eq(books.title, title)).limit(1);
  const bookId = rows[0]?.id;
  if (bookId === undefined) {
    throw new Error(`未找到标题为《${title}》的作品，请先导入并解析`);
  }
  return loadGraph(bookId, chapterRange);
}

/** 按作品 ID 读取图谱。 */
async function loadGraph(
  bookId: string,
  chapterRange: readonly [number, number]
): Promise<LoadedGraph> {
  const db = getDatabase();

  const entityRows = await db
    .select({ id: entitiesTable.id, canonical: entitiesTable.canonical })
    .from(entitiesTable)
    .where(eq(entitiesTable.bookId, bookId));

  const aliasRows = await db
    .select({ entityId: entityAliases.entityId, alias: entityAliases.alias })
    .from(entityAliases)
    .where(eq(entityAliases.bookId, bookId));

  const aliasByEntity = new Map<string, string[]>();
  for (const row of aliasRows) {
    const bucket = aliasByEntity.get(row.entityId) ?? [];
    bucket.push(row.alias);
    aliasByEntity.set(row.entityId, bucket);
  }

  // 关系需要把 UUID 还原为可读名字：直接内联 join 两次实体表。
  // 一并取出 `startChapter` —— 金标只覆盖前若干回，第 10 回才出现的边不该算进前 3 回的输出。
  const relationRows = await db
    .select({
      typeCode    : relationships.relationTypeCode,
      sourceId    : relationships.sourceEntityId,
      targetId    : relationships.targetEntityId,
      startChapter: relationships.startChapter
    })
    .from(relationships)
    .where(eq(relationships.bookId, bookId));

  const nameById = new Map(entityRows.map((row) => [row.id, row.canonical]));

  // 金标章节区间内被提及过的实体 —— 这是「切片」的依据。
  const [from, to] = chapterRange;
  const scopeRows = await db
    .selectDistinct({ canonical: entitiesTable.canonical })
    .from(entityMentions)
    .innerJoin(paragraphs, eq(paragraphs.id, entityMentions.paragraphId))
    .innerJoin(chapters, eq(chapters.id, paragraphs.chapterId))
    .innerJoin(entitiesTable, eq(entitiesTable.id, entityMentions.entityId))
    .where(
      and(
        eq(chapters.bookId, bookId),
        gte(chapters.ordinal, from),
        lte(chapters.ordinal, to)
      )
    );

  return {
    bookId,
    inScopeCanonicals: new Set(scopeRows.map((row) => row.canonical)),
    graph            : {
      entities: entityRows.map((row) => ({
        canonical: row.canonical,
        aliases  : aliasByEntity.get(row.id) ?? []
      })),
      relations: relationRows.flatMap((row) => {
        const sourceCanonical = nameById.get(row.sourceId);
        const targetCanonical = nameById.get(row.targetId);
        if (sourceCanonical === undefined || targetCanonical === undefined) {
          return [];
        }
        return [
          {
            typeCode    : row.typeCode,
            sourceCanonical,
            targetCanonical,
            startChapter: row.startChapter
          }
        ];
      })
    }
  };
}

/** 读取作品的全部章节标题 —— 仅用于把金标区间解析成人可核对的章节列表。 */
async function loadChapterRefs(bookId: string): Promise<ChapterRef[]> {
  const db = getDatabase();
  return db
    .select({ ordinal: chapters.ordinal, title: chapters.title })
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(chapters.ordinal);
}

/** 渲染报告。 */
function renderReport(
  report: EvalReport,
  slice: { entities: number; relations: number; goldEntities: number; goldRelations: number }
): string {
  const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
  const lines = [
    "评测报告",
    "─────────────────────────────",
    `切片规模  实体 ${String(slice.entities)}（金标 ${String(slice.goldEntities)}）　` +
      `关系 ${String(slice.relations)}（金标 ${String(slice.goldRelations)}）`,
    `实体   TP=${String(report.entity.tp)} FP=${String(report.entity.fp)} FN=${String(report.entity.fn)}`,
    `       精确率 ${percent(report.entity.precision)}  召回率 ${percent(report.entity.recall)}  F1 ${percent(report.entity.f1)}`,
    `关系   TP=${String(report.relation.tp)} FP=${String(report.relation.fp)} FN=${String(report.relation.fn)}`,
    `       精确率 ${percent(report.relation.precision)}  召回率 ${percent(report.relation.recall)}  F1 ${percent(report.relation.f1)}`
  ];
  // 切片对了，精确率也未必可读 —— 若金标本身漏标严重，FP 主要来自漏标而非系统多报。
  // 明确提示，避免读者把「金标不全」误读成「系统很差」。
  if (!isPrecisionReadable(slice.goldEntities, slice.entities)) {
    lines.push(
      "",
      `⚠️ 金标只列了 ${String(slice.goldEntities)} 个实体，而切片内有 ${String(slice.entities)} 个。`,
      "   精确率的分母主要来自**金标漏标**，此时只有**召回率**可读；",
      "   要让精确率可读，必须先把金标补全到覆盖该章节区间。"
    );
  }
  return lines.join("\n");
}

/** 入口。 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const goldPath = argv.find((arg) => !arg.startsWith("--") && arg.endsWith(".json"));
  if (goldPath === undefined) {
    throw new Error("用法：pnpm eval <金标 JSON 路径> [--work-id <uuid>]");
  }

  const raw = await readFile(resolve(goldPath), "utf8");
  const gold = GoldSetSchema.parse(JSON.parse(raw) as unknown);

  const bookIdIndex = argv.indexOf("--work-id");
  const explicitBookId = bookIdIndex >= 0 ? argv[bookIdIndex + 1] : undefined;

  const loaded =
    explicitBookId === undefined
      ? await loadGraphByTitle(gold.bookTitle, gold.chapterRange)
      : await loadGraph(explicitBookId, gold.chapterRange);

  // **关键**：`runEval` 内部会按金标的章节区间切片。不切片就会拿全书图谱
  // 去对章节金标，区间外的一切都被算成 FP —— 那正是初版 0.85% 精确率的来源。
  const { report, slice } = runEval(gold, loaded);

  console.log(`金标作品：《${gold.bookTitle}》 章节 ${String(gold.chapterRange[0])}–${String(gold.chapterRange[1])}`);
  console.log(`比对图谱：${loaded.bookId}`);

  // 把区间解析到的**章节标题**逐条打出来。这不是装饰 —— `chapterRange` 的单位
  // 曾经未定义，而 `chapters.ordinal` 又被前置内容占用了 1，于是「第 1–3 回」
  // 静默变成了「前言 + 第一回 + 第二回」。这类口径错误看 PRF 数字永远发现不了，
  // 只能把中间量摊开。
  const rangeSummary = describeChapterRange(
    await loadChapterRefs(loaded.bookId),
    gold.chapterRange[0],
    gold.chapterRange[1]
  );
  console.log(
    `区间解析：${String(gold.chapterRange[0])}–${String(gold.chapterRange[1])} 回 → ` +
      (rangeSummary.chapters.length === 0
        ? "**区间内没有任何章节**（作品不存在或区间越界）"
        : rangeSummary.chapters.map((chapter) => chapter.title).join(" ／ "))
  );
  if (rangeSummary.unnumbered.length > 0) {
    console.warn(
      `⚠️ 区间内有 ${String(rangeSummary.unnumbered.length)} 个章节不是编号标题：` +
        rangeSummary.unnumbered
          .map((chapter) => `「${chapter.title}」(序号 ${String(chapter.ordinal)})`)
          .join("、") +
        "\n   通常意味着金标区间的单位与 chapters.ordinal 不一致" +
        "（例如把前置内容算进了第 1 回）。"
    );
  }

  console.log(
    `切片口径：实体须在第 ${String(gold.chapterRange[0])}–${String(gold.chapterRange[1])} 回被提及过；` +
      `关系须两端在切片内，且首次观察不晚于第 ${String(gold.chapterRange[1])} 回`
  );
  console.log(renderReport(report, slice));

  // 金标自己登记的说明（已删除/已更正的条目 + 保留的真实缺口）。
  // 必须打在报告**旁边**：金标错误与系统缺陷在 TP/FP/FN 里长得一模一样，
  // 不写出来，下一个读报告的人就会把金标缺陷当成系统缺陷再查一遍。
  for (const line of renderAnnotationNotes(gold.annotationNotes)) {
    console.log(line);
  }

  // 退出码约定：F1 未达阈值时非零退出，可直接用于 CI 门禁。
  const threshold = Number(process.env.EVAL_F1_THRESHOLD ?? "0.74");
  if (report.entity.f1 < threshold) {
    console.error(
      `\n实体 F1 ${(report.entity.f1 * 100).toFixed(2)}% 低于阈值 ${(threshold * 100).toFixed(2)}%`
    );
    process.exitCode = 1;
  }
}

await main();
