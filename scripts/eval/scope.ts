import { normalizeName } from "@/lib/text";
import { isChapterHeading } from "@/server/modules/importing/parse-text";

import type { GoldSet } from "./goldset-schema";
import { evaluateAll, type EvalReport } from "./metrics";

/**
 * 评测用图谱**切片**。
 *
 * 存在理由（一次实测暴露的**口径缺陷**）：
 * `GoldSetSchema.chapterRange` 声明了金标覆盖的章节区间，但 `run-eval.ts`
 * 只把它打进了 `console.log`，**从未用它过滤图谱**。后果是：
 *
 *   拿「全书 938 个实体」去对「第 1–3 回的 11 个金标实体」，
 *   后 54 回的每一个实体都被判成 FP → 精确率 **0.85%**、F1 **1.69%**。
 *
 * 这个数字**结构性无意义**（它约等于 11/938），却会触发 `EVAL_F1_THRESHOLD`
 * 的 74% 门禁告警 —— 会让人误判「系统坏了」，而实际上坏的是**尺子**。
 *
 * 切片口径：
 * - 实体：在该章节区间内**被提及过**（由调用方经 `entity_mentions` → 段落 → 章节查出）；
 * - 关系：**两端都在切片内**，且（若已知 `startChapter`）首次观察章节 ≤ 区间上界。
 *
 * 保留为**纯函数**（只吃名字集合，不碰数据库）是为了能脱离 DB 单测 ——
 * 这类口径缺陷靠肉眼 review 是发现不了的，必须有测试钉住。
 */

/** 评测用图谱（与 `run-eval.ts` 的 `ExtractedGraph` 同形）。 */
export interface EvalGraph {
  entities : { canonical: string; aliases: readonly string[] }[];
  relations: EvalRelation[];
}

/** 评测用关系；`startChapter` 可选，提供时参与章节过滤。 */
export interface EvalRelation {
  typeCode       : string;
  sourceCanonical: string;
  targetCanonical: string;
  /** 关系首次被观察到的章节序号；`undefined` 表示不参与章节过滤。 */
  startChapter?  : number;
}

/**
 * 把图谱切片到指定的规范名集合。
 *
 * 为什么按**规范名**而不是实体 id 过滤：`EvalGraph` 是可读名字的表示
 * （关系里存的就是名字），按名字过滤才能让本函数保持纯函数、脱离数据库单测。
 *
 * 归一化一律走 `normalizeName()` —— 与落库、归并、指标比较**共用同一实现**，
 * 避免出现「切片认得这个写法、指标认不得」的口径漂移。
 *
 * @param graph 全量图谱
 * @param inScopeCanonicals 落在章节区间内的规范名集合
 * @param chapterUpperBound 金标章节区间上界；提供时丢弃 `startChapter` 超出它的关系
 * @returns 切片后的图谱（保持原顺序）
 */
export function scopeGraph(
  graph: EvalGraph,
  inScopeCanonicals: ReadonlySet<string>,
  chapterUpperBound?: number
): EvalGraph {
  const scope = new Set([...inScopeCanonicals].map((name) => normalizeName(name)));

  const entities = graph.entities.filter((entity) => scope.has(normalizeName(entity.canonical)));

  const relations = graph.relations.filter((relation) => {
    if (
      !scope.has(normalizeName(relation.sourceCanonical)) ||
      !scope.has(normalizeName(relation.targetCanonical))
    ) {
      return false;
    }
    // 首次观察晚于金标区间的关系统统不算 —— 否则会把「第 10 回才出现的边」
    // 记成第 1–3 回的假正例，重新把精确率压低。
    if (chapterUpperBound !== undefined && relation.startChapter !== undefined) {
      return relation.startChapter <= chapterUpperBound;
    }
    return true;
  });

  return { entities, relations };
}

/**
 * 判断精确率在当前金标规模下**是否可读**。
 *
 * 背景：即使切片正确，若金标本身只列了少数实体（本仓库的样例金标只有 11 个），
 * 而切片里有 80+ 个实体，那精确率的分母主要来自**金标漏标**，而不是系统多报。
 * 此时精确率不可读，只有**召回率**有意义。
 *
 * 这里给出一个保守的判据，用于在报告里明确提示，避免读者把噪声当结论。
 *
 * @param goldCount 金标实体数
 * @param sliceCount 切片内实体数
 * @returns 精确率可读时为 true
 */
export function isPrecisionReadable(goldCount: number, sliceCount: number): boolean {
  // 金标覆盖不到切片的一半时，精确率必然被漏标主导。
  return goldCount * 2 >= sliceCount;
}

/** 章节引用（评测只需要序号与标题）。 */
export interface ChapterRef {
  ordinal: number;
  title  : string;
}

/** 金标区间解析结果。 */
export interface ChapterRangeSummary {
  /** 区间内的章节（按 `ordinal` 升序）。 */
  chapters  : ChapterRef[];
  /**
   * 区间内**不像编号标题**的章节（例如解析器合成的「前言」「正文」）。
   *
   * 非空即意味着区间与 `chapters.ordinal` 的轴不一致，或本书压根没切出章节。
   * 这正是 `[1,3]` 被解析成「前言 + 第一回 + 第二回」时唯一可见的信号 ——
   * 当时的输出里**一个字都没提区间落在哪些章节上**，所以没人发现。
   */
  unnumbered: ChapterRef[];
}

/**
 * 把金标声明的回号区间解析成具体章节，供人肉眼核对。
 *
 * 为什么必须把它打出来：`chapterRange` 的单位曾经是**未定义的**，而当时的
 * `chapters.ordinal` 又被前置内容占用了 1，于是「第 1–3 回」静默变成
 * 「前言 + 第一回 + 第二回」。这类口径错误靠看最终 PRF 数字**永远发现不了** ——
 * 只能靠把中间量摊开给人看。因此本函数的价值在于**输出**，不在于计算。
 *
 * 保持为纯函数是为了可脱离数据库单测（与 `scopeGraph` 同一理由）。
 *
 * @param chapters 作品的**全部**章节（含前置内容）
 * @param from 区间下界（回号）
 * @param to 区间上界（回号）
 * @returns 区间内章节，以及其中不像编号标题的那些
 */
export function describeChapterRange(
  chapters: readonly ChapterRef[],
  from: number,
  to: number
): ChapterRangeSummary {
  const inRange = chapters
    .filter((chapter) => chapter.ordinal >= from && chapter.ordinal <= to)
    .sort((left, right) => left.ordinal - right.ordinal);

  return {
    chapters  : inRange,
    // 复用导入侧的标题判据，避免「评测认为这是编号章节、导入不认为」的口径漂移。
    unnumbered: inRange.filter((chapter) => !isChapterHeading(chapter.title))
  };
}

/**
 * 渲染金标的「标注说明」（`GoldSetSchema.annotationNotes`）。
 *
 * 与 `describeChapterRange` 同一理由：这类内容的**价值在于被看见**，不在于计算。
 * 金标错误与系统缺陷在 PRF 报告里长得一模一样 —— 本项目已经因此栽过四次
 * （`chapterRange` 没接上 / `ordinal` 偏移一位 / 金标含 0 次出现的名字 /
 * 金标把 `师生` 标成 `同僚`）。把依据打在报告旁边，是唯一能阻止复发的做法。
 *
 * 返回 `string[]`（而非一整段文本）是为了让调用方决定换行方式，
 * 也让测试可以逐条断言，而不是去比对一个大字符串。
 *
 * @param notes 金标里登记的说明条目
 * @returns 渲染后的行；无说明时返回空数组
 */
export function renderAnnotationNotes(notes: readonly string[]): string[] {
  const items = notes.map((note) => note.trim()).filter((note) => note.length > 0);
  if (items.length === 0) {
    return [];
  }
  return [
    "",
    `金标标注说明（${String(items.length)} 条，**不参与指标计算**）：`,
    ...items.map((note, index) => `  ${String(index + 1)}. ${note}`)
  ];
}

/**
 * 从数据库读出的系统输出 + **金标章节区间内的实体名集合**。
 *
 * 为什么必须一起带出来：`GoldSetSchema.chapterRange` 声明了金标覆盖的章节区间，
 * 但 `run-eval.ts` 初版只把它打进了 `console.log`，**从未用它过滤图谱**。
 * 后果是拿「全书 938 个实体」去对「第 1–3 回的 11 个金标实体」，
 * 后 54 回的每个实体都被算成 FP → 精确率 0.85%、F1 1.69%（约等于 11/938）。
 */
export interface LoadedGraph {
  workId           : string;
  graph            : EvalGraph;
  /** 金标章节区间内**被提及过**的实体规范名（`entity_mentions` → 段落 → 章节）。 */
  inScopeCanonicals: Set<string>;
}

/** 一次评测的产物。 */
export interface EvalRun {
  report: EvalReport;
  slice : {
    entities     : number;
    relations    : number;
    goldEntities : number;
    goldRelations: number;
  };
}

/**
 * 把「金标 + 已加载图谱」跑成一份报告。
 *
 * ⚠️ 这个函数存在的**唯一理由**是让「切片是否真的接上了」可被测试：
 * 若把 `scopeGraph(...)` 直接写在 `run-eval.ts` 的 `main()` 里，那段代码
 * 永远进不了单测（`main()` 一被 import 就会连数据库），
 * 于是「有人重构时把切片去掉了」这种回归**没有任何测试能发现** ——
 * 而它正是本模块要修的那个 bug。所以切片这一步必须待在一个纯函数里。
 *
 * @param gold 金标
 * @param loaded 已加载的全量图谱与区间内规范名
 * @returns 报告与切片规模
 */
export function runEval(gold: GoldSet, loaded: LoadedGraph): EvalRun {
  const graph = scopeGraph(loaded.graph, loaded.inScopeCanonicals, gold.chapterRange[1]);
  return {
    report: evaluateAll({ entities: gold.entities, relations: gold.relations }, graph),
    slice : {
      entities     : graph.entities.length,
      relations    : graph.relations.length,
      goldEntities : gold.entities.length,
      goldRelations: gold.relations.length
    }
  };
}
