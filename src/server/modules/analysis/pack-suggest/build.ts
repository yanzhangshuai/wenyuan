import "server-only";

import { eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { bookPacks, books, chapters, paragraphs } from "@/server/db/schema";
import { UNREGISTERED_WORK_PACK, resolveWorkPack } from "@/server/modules/analysis/genre-pack";
import { findPrefixConflicts } from "@/server/modules/analysis/genre-pack/proper-noun-dict";
import { scanBookCandidates } from "@/server/modules/analysis/pipeline/tokenizer";

import { mergeCandidates, scanAppellations } from "./appellations";
import { computePackMetrics, type PackMetrics } from "./metrics";
import { extractSamples } from "./samples";
import {
  MAX_CANDIDATES_PER_CALL,
  SAMPLES_PER_CANDIDATE,
  TRAILING_FUNCTION_CHARS,
  suggestAliasGroups,
  type SuggestCandidate,
  type SuggestOutcome
} from "./suggest";

/**
 * 为某本书生成「建议配置」：L1 扫描 → L2 建议 → 写 `book_packs`（draft）。
 *
 * ## 为什么 L1 用空词典扫描，而不是用已有包
 *
 * 这一步的目的恰恰是**发现这本书有哪些专名**。若用内置包扫描，等于假设
 * 「这本书就是那本已知的书」，对真正的新书毫无意义。
 *
 * ## 为什么写库时 `status = draft`
 *
 * 这份配置未经人确认。第一次解析若出现错并，`work_pack_resolved` 里的
 * `packStatus=draft` 就是第一嫌疑人 —— 没有这个标记，「图错了」会被归因到模型或代码。
 */

/** 写入结果。 */
export interface BuildPackResult {
  bookId        : string;
  bookTitle     : string;
  /** L1 扫出的候选总数（截断前）。 */
  candidateCount: number;
  /** 实际送给 L2 的数量。 */
  sentCount     : number;
  /** 进了专名表的名字数（= 候选数 − rejects）。 */
  properNounCount: number;
  /** 生成出的别名组数。 */
  aliasGroupCount: number;
  /** 被确定性关卡砍掉的别名。 */
  droppedAliases: SuggestOutcome["droppedAliases"];
  /** 被判为「不是人物」的候选。 */
  rejects       : SuggestOutcome["rejects"];
  model         : string;
  tokensIn      : number;
  tokensOut     : number;
  /** 质量指标（页面据此染色）。 */
  metrics       : PackMetrics;
}

/**
 * 生成并保存建议配置。
 *
 * @param bookId 作品 id
 * @returns 生成摘要
 * @throws 作品不存在、没有章节、模型输出不合法时抛出
 */
export async function buildSuggestedPack(bookId: string): Promise<BuildPackResult> {
  const db = getDatabase();

  const [book] = await db
    .select({ id: books.id, title: books.title })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  if (book === undefined) {
    throw new Error(`作品不存在：${bookId}`);
  }

  /**
   * 已有内置包的书**不自动生成**。
   *
   * 实测（2026-10-23）：对《红楼梦》跑一次生成，得到 145 个专名 / **3 个别名组**，
   * 而内置包是 163 / 32 —— 自动生成的质量明显更差（称谓型候选召回不足）。
   * 如果允许它覆盖内置包，等于用一份未验证的配置换掉被金标验证过的基线，
   * 而 `loadWorkPack` 是「库里优先」，覆盖会**静默生效**。
   *
   * 正确路径是页面上的「从内置包导入」：显式复制一份到库里再改，改坏了还能再导。
   */
  if (resolveWorkPack(book.title).matched) {
    const [existing] = await db
      .select({ id: bookPacks.id })
      .from(bookPacks)
      .where(eq(bookPacks.bookId, bookId))
      .limit(1);
    if (existing === undefined) {
      throw new Error(
        `《${book.title}》已有内置作品包，请用「从内置包导入」而不是自动生成` +
          "（自动生成的别名召回率明显低于人工策展的基线）"
      );
    }
  }

  const chapterRows = await db
    .select({ id: chapters.id, ordinal: chapters.ordinal, title: chapters.title })
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(chapters.ordinal);
  if (chapterRows.length === 0) {
    throw new Error("该作品没有章节，无法生成配置");
  }

  const paragraphRows = await db
    .select({ chapterId: paragraphs.chapterId, ordinal: paragraphs.ordinal, text: paragraphs.text })
    .from(paragraphs)
    .innerJoin(chapters, eq(paragraphs.chapterId, chapters.id))
    .where(eq(chapters.bookId, bookId));

  const byChapter = new Map<string, { ordinal: number; text: string }[]>();
  for (const row of paragraphRows) {
    const bucket = byChapter.get(row.chapterId) ?? [];
    bucket.push({ ordinal: row.ordinal, text: row.text });
    byChapter.set(row.chapterId, bucket);
  }

  const chapterTexts: { ordinal: number; text: string }[] = [];
  for (const chapter of chapterRows) {
    const bucket = (byChapter.get(chapter.id) ?? []).sort((a, b) => a.ordinal - b.ordinal);
    chapterTexts.push({ ordinal: chapter.ordinal, text: bucket.map((item) => item.text).join("\n") });
  }

  // L1：空词典扫描（$0）。候选已按频次降序返回。
  const tokenized = scanBookCandidates(chapterTexts, UNREGISTERED_WORK_PACK);
  const fullText = chapterTexts.map((item) => item.text).join("\n");
  // 称谓候选：分词器切不出「宝二爷」「林姑娘」这类写法，别名组的召回全靠这一层。
  const merged = mergeCandidates(tokenized, scanAppellations(fullText), chapterTexts);

  const sent: SuggestCandidate[] = merged.slice(0, MAX_CANDIDATES_PER_CALL).map((item) => ({
    name        : item.name,
    frequency   : item.frequency,
    firstChapter: item.firstChapter,
    samples     : extractSamples(fullText, item.name, SAMPLES_PER_CANDIDATE)
  }));

  if (sent.length === 0) {
    throw new Error("没有扫描到任何候选名（文本过短或分词异常）");
  }

  // L2：建议（一次调用）。
  const outcome = await suggestAliasGroups(book.title, sent);

  const rejectedNames = new Set(outcome.rejects.map((item) => item.name));
  const rawNouns = merged
    .filter((item) => !rejectedNames.has(item.name))
    // 以动词/助词结尾的候选是「名字 + 动作」的截断（雨村道、黛玉笑），
    // 留在词典里不仅无用，还会与真名构成前缀冲突（见下面的冲突剔除）。
    .filter((item) => !TRAILING_FUNCTION_CHARS.test(item.name.slice(-1)))
    .map((item) => ({ name: item.name, postag: 128 }));

  /**
   * 前缀冲突剔除。
   *
   * `segmentit` 在同词频下优先取短词，所以「雨村」存在时「雨村道」永远切不出来；
   * 而 `buildDictionaryText` 遇到冲突会**直接抛错**让解析启动失败（实测踩到）。
   *
   * 剔除规则与项目既有约定一致：**删较短的那条**。
   * 短名多半是别名（`刘老` vs `刘老老`），它已经在 `aliasGroups` 里承担了「同一人」的语义，
   * 不需要再作为独立词条存在。
   */
  const conflicts = findPrefixConflicts(rawNouns.map((item) => [item.name, item.postag] as const));
  const droppedForConflict = new Set(conflicts.map(([short]) => short));
  const properNouns = rawNouns.filter((item) => !droppedForConflict.has(item.name));

  // 别名组：只保留真有多个写法的组（单元素组没有意义，且会被 P5 当成空操作）。
  const aliasGroups = outcome.persons
    .filter((person) => person.aliases.length > 0)
    .map((person) => [person.name, ...person.aliases]);

  /**
   * 质量指标。
   *
   * `unsupportedAliases` 只统计**因证据缺失被砍**的别名 —— 因「以动词/助词结尾」被砍的
   * 属于形态规则正常过滤（`李贵忙` 这类截断），不算模型编造，计进去会把覆盖率冤枉地压低。
   */
  const keptAliases = outcome.persons.reduce((sum, person) => sum + person.aliases.length, 0);
  const unsupportedAliases = outcome.droppedAliases.filter((item) =>
    item.reason.includes("证据片段")
  ).length;
  const metrics = computePackMetrics({
    candidateCount    : merged.length,
    properNounCount   : properNouns.length,
    aliasGroups,
    keptAliases,
    unsupportedAliases,
    rejectedCount     : outcome.rejects.length
  });

  const note = [
    `generated by ${outcome.model}`,
    `candidates=${String(merged.length)}`,
    `sent=${String(sent.length)}`,
    `persons=${String(outcome.persons.length)}`,
    `groups=${String(aliasGroups.length)}`,
    `droppedAliases=${String(outcome.droppedAliases.length)}`,
    `droppedPrefixConflict=${String(droppedForConflict.size)}`,
    `tokensIn=${String(outcome.tokensIn)}`,
    `tokensOut=${String(outcome.tokensOut)}`
  ].join(" · ");

  await db
    .insert(bookPacks)
    .values({
      bookId        : bookId,
      source        : "generated",
      status        : "draft",
      properNouns   : properNouns,
      aliasGroups   : aliasGroups,
      suggestionNote: note,
      metrics       : metrics,
      updatedAt     : new Date()
    })
    .onConflictDoUpdate({
      target: bookPacks.bookId,
      set   : {
        source        : "generated",
        status        : "draft",
        properNouns   : properNouns,
        aliasGroups   : aliasGroups,
        suggestionNote: note,
        metrics       : metrics,
        updatedAt     : new Date()
      }
    });

  return {
    bookId,
    bookTitle       : book.title,
    candidateCount  : merged.length,
    sentCount       : sent.length,
    properNounCount : properNouns.length,
    aliasGroupCount : aliasGroups.length,
    droppedAliases  : outcome.droppedAliases,
    rejects         : outcome.rejects,
    model           : outcome.model,
    tokensIn        : outcome.tokensIn,
    tokensOut       : outcome.tokensOut,
    metrics
  };
}
