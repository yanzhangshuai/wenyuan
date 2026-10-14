import { normalizeName } from "@/lib/text";

import { CLASSICAL_GENRE_PACK } from "./classical";
import type { GenrePack, WorkPack } from "./types";

/**
 * N12 tier ③「**离线作品包生成器**」的**确定性半边**（纯函数、零 LLM、零数据库、零网络）。
 *
 * ## 它解决什么问题
 *
 * 作品层词典一直是**手工写的**（《儒林外史》118 条、《红楼梦》173 条）。
 * 每来一本新书就要凭印象手写一份，这正是「解析准确率过低」的一个结构性来源 ——
 * 词典是承重件（整词率 空词典 75.7% → 配对词典 97.4%），但它没有生产端。
 *
 * 参考项目 AI-Reader-V2 的 P0 就是**这个生成器**：
 * `jieba + ngram + 后缀规则统计候选实体 → LLM 分类成白名单`。
 * 我们历史上只借了它的**消费端**（拿词典做锚定），没借生产端。
 * 本模块补的就是生产端的**确定性那一半** —— LLM 那一半（语义过滤 + 补低频常识）不在本模块。
 *
 * ## 为什么必须用 n-gram，而不是复用 P0 的 `collectCandidateNames`
 *
 * `collectCandidateNames`（`pipeline/dictionary.ts`）走的是**分词**通道，
 * 而分词要靠词典来修正 —— 生成器却要在**没有词典**的前提下产出词典，
 * 这是一个**循环依赖**。实测（批 12，`_wb_pack_gen.ts`）：
 * 分词通道对「原文出现 ≥3 次」的手工条目只召回 **59.2% / 69.5%**，
 * 而 n-gram 通道召回 **95.9% / 89.3%** —— 差的正是被切碎的名字
 * （`杜少卿` → `杜少/卿道`、`马纯上` → `马纯/上`）。
 * n-gram **不需要分词，所以没有这个环**。
 *
 * ## 参数为什么是 `freedom = 0.6` / `frequency = 2`（批 28 实测，非猜测）
 *
 * 批 12 把「确定性天花板」记成一个**与参数无关的常数**（68%～80%），
 * 批 28（`_wb_pack_curve.ts`）把它变成一条曲线，并证伪了那个前提：
 *
 * - **`minCandidateFrequency: 3` 其实是自由度阈值的推论，不是独立参数**：
 *   候选出现 `k` 次 ⟹ 左邻字最多 `k` 种取值 ⟹ `熵左 ≤ ln k`；右同理；
 *   故 `freedom = min(熵左, 熵右) ≤ ln k`。于是 `freedom ≥ 0.8 ⟹ k ≥ e^0.8 ≈ 2.23 ⟹ k ≥ 3`。
 *   → 实测 F=2 与 F=3 的候选集**逐条相同**（`minCandidateFrequency` 完全惰性）。
 * - **真正的旋钮是自由度，拐点在 0.6**：0.8 → 0.6 只花 2.7× 候选就拿到
 *   **+3.4 / +5.8** 点召回（儒林 79.7% → 83.1%，红楼 67.6% → 73.4%）；
 *   0.6 → 0 再多 +4.2 / +2.3 点却再翻一倍候选（23 万 / 48 万条 → 对 LLM 不可用）。
 * - ⚠️ **「凝固度」「自由度」作为排序键是反信号**：top-40 精度 **0.0%** ——
 *   排在最前的是 `怂恿`/`朦胧`/`铿锵`/`踌躇` 这类**联绵词**：它们是「完美的词」，
 *   却永远不是专名。**词形完美度与「是不是专名」负相关。**
 *   → 见 `CANDIDATE_RANK_KEYS`：本模块**刻意不提供**这两个键。
 *
 * ## 本模块的边界（诚实说明）
 *
 * - **只做「高召回」，不做「高精度」**：LLM 的职责是**语义过滤**，不是补常识
 *   （批 28 的两条独立结论）。本模块的输出**必须**再过一道 LLM，不能直接当词典用。
 * - **「出现 ≤ 1 次」的条目放弃自动发现**：那是**信息下界**，不是可调的阈值
 *   （要拿到它们，候选总数变成 23 万 / 48 万）。
 * - ⛔ **刻意不含「姓氏 × 已发现候选」重组通道**：批 28 实测它只是「补充，不是主力」
 *   （儒林 +4 / 红楼 +10），且需要一张**通用层姓氏表** —— 而 `LexiconKnowledge` 里
 *   没有姓氏概念，加进去是一次接口变更（且按三层教义属于**通用层**，塞进 `GenrePack`
 *   是层级错位）。更关键的是它产出**假重组**（`范老太太←范+老太太`、`金寡妇←金+寡妇`，
 *   后缀是泛称而非名）→ **反正必须过 LLM**，确定性半边无法自证。留给「LLM 半边」那批一起做。
 * - ⚠️ **本模块不被流水线调用**（只有 `scripts/generate-work-pack.ts` 调用它）→
 *   加它**不改变任何生产行为**，因此**库与代码一致**，不需要重导、不需要重跑 analyze。
 *   但这也意味着 `_wb_controlflow_diff.py` 的 `C4 确定性阶段` 断言**不覆盖本文件**
 *   （那份断言扫的是硬编码的 10 个 `pipeline/*.ts`）—— 如实记在文档里。
 *
 * ## 回目通道（批 34，$0 实测）：一份**免费的**「正文拿不到的全名」来源
 *
 * `parseChapters` 把回目行放进 `chapter.title`、**不放**进 `chapter.text`
 * → 生成器一直**看不见回目**。而回目恰恰全是**全名**（「史太君寿终归地府」）。
 *
 * 三条实测事实（量出来的，不是推理）：
 *
 * 1. **净增量 = 9 个金标，不是 13**。回目通道捞回 13 个「正文通道漏掉的金标」，
 *    但其中 **4 个**（`贾宝玉`/`贾雨村`/`来旺`/`薛宝钗`）在正文里出现 **5–17 次**，
 *    只是被**凝固度闸**切掉 → 严格说不属于回目通道的贡献。
 *    剩下 **9 个**（儒林 3 / 红楼 6）正文只出现 **0–1 次** → 任何基于正文的方法都拿不到。
 *
 * 2. **自由度闸与凝固度闸对回目都不可用**：回目里每个字串几乎只出现 1 次
 *    （实测最高频次 儒林 **5** / 红楼 **18**）→ `freedom` 恒为 **0**
 *    （左右邻字只有一种取值，熵 = 0）→ `minFreedom: 0.6` 会把 1722 条砍到 **27** 条。
 *    故回目通道必须 `F = 1`、凝固度闸放开（`-Infinity`）。
 *    **这不是调参，是换语义**：回目的信息量不在「反复出现」，而在「它是作者手写的全名清单」。
 *
 * 3. 🚨 **没有任何确定性排序键能把候选变小**（两个方向都试过，都是**反信号**）：
 *    - 按**正文频次降序**：儒林要 `K = 809/1577`、红楼 `2442/3856` 才能捞全
 *      —— 排在最前的是 `杜少`(331) / `超人`(215) / `老老`(317) 这类**高频名字的碎片**。
 *    - 按正文频次**升序**更差：正文零频桶里儒林 1371 条含 2 个金标（**0.15%**）、
 *      红楼 3428 条含 6 个（**0.17%**）。
 *    - **机制**：正文通道漏掉的恰恰是「正文低频 / 零频」的名字 → 按正文频次排序
 *      等于**按「被漏掉的程度」倒序排列**，结构性把要救的人排到最后。
 *
 * → 所以本通道的产物**必须**过 LLM（实测精度只有 **1.7% / 1.4%**）。
 *   它的**正确消费方式**有两条：把 5433 条候选并进 LLM 的候选表，
 *   或者更省 —— 把**原始回目**（儒林 1235 字 / 红楼 2771 字）整体作为一个输入块喂给 LLM。
 *   ⚠️ 后者属于**付费批**；本模块只做确定性半边（与批 31 / 32 的分工一致）。
 *
 * ⚠️ **替代方案贵 17–20 倍**（要拿到同样的 13 个）：放宽正文凝固度闸到 `< -0.39`
 *   （`贾宝玉` 的凝固度就是 **-0.39** —— 因为 `贾` 与 `宝玉` 各自都太高频，整串比随机还罕见）
 *   → 儒林候选 **27515 → 55209**（+27694）、红楼 **53435 → 130647**（+77212）。
 *   回目通道只要 **1577 / 3856**。→ 回目通道是拿到这 13 个的**最便宜**形状。
 *
 * ⚠️ **章号前缀剥离是必要的，但 book-dependent**：儒林的 `第一回　` 全是汉字
 *   → 剥离后候选 1903 → **1722**（−181 条 `第X回` 样板）；红楼的 `第1章 ` 含 ASCII 数字，
 *   而含数字的 n-gram 早被「纯 CJK」那道过滤掉 → 剥离是**无操作**（4090 → 4090）。
 *
 * ## ⚠️ 刻意**不带**批 28 探针里的内存守卫（`PRUNE_AT`）—— 它在一个关键性质上不成立
 *
 * 探针里有一段「表规模超过 `PRUNE_AT` 就丢掉**当前**计数 ≤ 1 的条目」的内存守卫。
 * 它在**计数过程中**触发，所以删掉的是「**当前**计数 ≤ 1」而不是「**真**频次 ≤ 1」的条目 ——
 * 而一个真频次为 4 的条目，在它**第一次出现之后**当前计数也是 1 → 被删 → 再从 0 重新累积
 * → **系统性低估频次**，重则整个候选消失。（已用 20 行脚本独立复现：
 * 真值 `f(子丑寅) = 4`，守卫触发后该条目**不在表里**。）
 *
 * 它之所以没污染批 28 的读数，只是因为**它从未执行**：两本书的 distinct n-gram 数
 * （儒林 27479 / 红楼 53375 量级）都远低于 `1.5e6`，`table.size > PRUNE_AT` 恒为假。
 *
 * → 一个**要么是死代码、要么静默算错**的守卫不该进生产。本模块不带它。
 *   真正的内存问题应由**分块计数**（二次扫描 / 外部排序）解决，而那要先证明它必要 ——
 *   加的时候必须同时给出**值保持的证明**（本仓库的判据是「方向 + 机制能否对上」，
 *   不是「看起来更省内存」）。
 */

/** 一个 n-gram 候选及其确定性统计量。 */
export interface NgramCandidate {
  /** 候选字面（直接取自正文，未经归一化）。 */
  readonly gram     : string;
  /** 正文出现次数（按**每个字符偏移**计数，重叠也计）。 */
  readonly frequency: number;
  /** 凝固度：所有切分点的对数点互信息取 **min**。 */
  readonly cohesion : number;
  /** 自由度：左右边界熵取 **min**。 */
  readonly freedom  : number;
}

/**
 * 发现参数。**每一项都有默认值**（见 `DISCOVERY_DEFAULTS`）。
 *
 * ⚠️ **刻意没有 `minFreedom`** —— 自由度闸不在这里，而由 `selectByFreedom` 单独施加。
 * 理由见 `discoverNgrams` 的注释：在发现阶段过滤会让「自由度闸」与「频次闸」混在一起，
 * 而这正是批 12 无法发现「`minCandidateFrequency` 是推论」的原因（它只有一个点，没有对照组）。
 */
export interface DiscoveryOptions {
  /** n-gram 最长长度。默认 4（词典实测**无一条超过 4 字**，故窗口不吃亏）。 */
  readonly maxN?        : number;
  /** 建表与候选的最低频次。默认 2。 */
  readonly minFrequency?: number;
  /** 凝固度（对数）下限。默认 3。**是闸门，不是排序键**。 */
  readonly minCohesion? : number;
  /** 题材包（提供泛称停用表）。省略时用古典白话默认包。 */
  readonly genrePack?   : GenrePack;
}

/**
 * 批 28 实测决定的参数默认值。
 *
 * ⚠️ `minFreedom` 不在 `DiscoveryOptions` 里，放在这里只是为了让
 * 「生成器该用什么参数」这件事**有一个单一可引用的出处**。
 */
export const DISCOVERY_DEFAULTS = {
  maxN        : 4,
  minFrequency: 2,
  minCohesion : 3,
  minFreedom  : 0.6
} as const;

/** n-gram 频次表：下标 = 长度（0..maxN），`tables[n]` 是长度 n 的那张表。 */
type FreqTables = Map<string, number>[];

/**
 * 统计长度 1..maxN 的所有 n-gram 频次。
 *
 * `tables[0]` 恒为空表，只为让下标等于长度（免去 `n - 1` 的换算）。
 *
 * ⚠️ 这里**没有**内存守卫（批 28 探针里的 `PRUNE_AT` 已刻意移除，理由见文件头）。
 * 实测两本书（33 万字 / 86 万字）在 `--max-old-space-size=6144` 下无内存压力。
 *
 * @param body 正文
 * @param maxN 最长长度
 */
function buildFreqTables(body: string, maxN: number): FreqTables {
  const tables: FreqTables = [];
  for (let n = 0; n <= maxN; n += 1) {
    tables.push(new Map<string, number>());
  }
  for (let i = 0; i < body.length; i += 1) {
    for (let n = 1; n <= maxN && i + n <= body.length; n += 1) {
      const table = tables[n];
      if (table === undefined) {
        continue;
      }
      const gram = body.slice(i, i + n);
      table.set(gram, (table.get(gram) ?? 0) + 1);
    }
  }
  return tables;
}

/** 取频次；被剪枝或不存在的条目按 1 计（保守，会**低估**凝固度）。 */
function freqOf(tables: FreqTables, gram: string): number {
  const table = tables[gram.length];
  return table?.get(gram) ?? 1;
}

/**
 * 凝固度：`min` over 所有切分点的对数点互信息。
 *
 * `cohesion(w) = min_k log( N * freq(w) / (freq(w[0..k]) * freq(w[k..])) )`
 *
 * 取 min 是因为「**只要有一个切分点是松的，整个串就不像词**」。
 *
 * @param tables 频次表
 * @param gram 待测字串
 * @param total 正文长度
 * @returns 凝固度；单字串无切分点 → `+Infinity`
 */
function cohesion(tables: FreqTables, gram: string, total: number): number {
  let worst = Number.POSITIVE_INFINITY;
  for (let k = 1; k < gram.length; k += 1) {
    const left = freqOf(tables, gram.slice(0, k));
    const right = freqOf(tables, gram.slice(k));
    const value = Math.log((total * freqOf(tables, gram)) / (left * right));
    if (value < worst) {
      worst = value;
    }
  }
  return worst;
}

/**
 * 香农熵（自然对数）。空分布返回 0。
 *
 * @param counts 取值 → 计数
 */
function entropy(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of counts.values()) {
    total += count;
  }
  if (total === 0) {
    return 0;
  }
  let value = 0;
  for (const count of counts.values()) {
    const p = count / total;
    value -= p * Math.log(p);
  }
  return value;
}

/**
 * 字符 n-gram 新词发现（零分词依赖）。
 *
 * 两趟：
 * 1. 按**频次闸 + 凝固度闸**筛出中间候选集；
 * 2. 再扫一遍正文，**只为这些候选**收集左右邻字分布
 *    （把内存从「所有 n-gram」压到「候选数」）。
 *
 * 最后施加两道**确定性精度过滤**（都不需要 LLM）：
 * ① 必须**全部是 CJK 汉字** —— 一步砍掉 `道：“`、`。\n　　` 这类标点碎片；
 * ② 不得命中题材层的**泛称停用表**（`先生`/`老爷`/`银子`/`太太`…）。
 *
 * ## ⚠️ 自由度**不在此过滤**
 *
 * `freedom` 原样返回，由 `selectByFreedom` 按不同阈值切片。
 * 这不是风格问题：在函数内部过滤会让「自由度闸」与「频次闸」**混在一起**，
 * 于是「`minCandidateFrequency: 3` 是自由度阈值的推论」这件事就**看不见了** ——
 * 批 12 只有 `F = 3` 一个点、没有对照组，正是这么把「阈值 3」当成了一个真实的选择。
 *
 * @param body 正文（**必须是整本书** —— 只扫前 10 回只能拿到 19.4% / 45.0% 的召回）
 * @param options 发现参数
 * @returns 候选列表（**顺序由频次表的插入序决定，调用方需自行排序**）
 */
export function discoverNgrams(body: string, options: DiscoveryOptions = {}): NgramCandidate[] {
  const genrePack = options.genrePack ?? CLASSICAL_GENRE_PACK;
  const maxN = options.maxN ?? DISCOVERY_DEFAULTS.maxN;
  const minFrequency = options.minFrequency ?? DISCOVERY_DEFAULTS.minFrequency;
  const minCohesion = options.minCohesion ?? DISCOVERY_DEFAULTS.minCohesion;

  const total = body.length;
  const tables = buildFreqTables(body, maxN);

  // —— 第一趟：频次闸 + 凝固度闸 ——
  const middle = new Map<string, { frequency: number; cohesion: number }>();
  for (let n = 2; n <= maxN; n += 1) {
    const table = tables[n];
    if (table === undefined) {
      continue;
    }
    for (const [gram, frequency] of table) {
      if (frequency < minFrequency) {
        continue;
      }
      const cohesionValue = cohesion(tables, gram, total);
      if (cohesionValue < minCohesion) {
        continue;
      }
      middle.set(gram, { frequency, cohesion: cohesionValue });
    }
  }

  // —— 第二趟：只为中间候选收集左右邻字 ——
  const left = new Map<string, Map<string, number>>();
  const right = new Map<string, Map<string, number>>();
  for (const gram of middle.keys()) {
    left.set(gram, new Map());
    right.set(gram, new Map());
  }
  for (let i = 0; i < body.length; i += 1) {
    for (let n = 2; n <= maxN && i + n <= body.length; n += 1) {
      const gram = body.slice(i, i + n);
      if (!middle.has(gram)) {
        continue;
      }
      // 边界哨兵：句首无左邻字、句尾无右邻字 —— 用一个**不会出现在正文里**的记号，
      // 使边界本身成为一个「取值」，从而**降低**贴边词的熵（正确的行为）。
      const leftChar = i > 0 ? body[i - 1] : "^";
      const rightChar = i + n < body.length ? body[i + n] : "$";
      const leftMap = left.get(gram);
      const rightMap = right.get(gram);
      if (leftMap !== undefined && leftChar !== undefined) {
        leftMap.set(leftChar, (leftMap.get(leftChar) ?? 0) + 1);
      }
      if (rightMap !== undefined && rightChar !== undefined) {
        rightMap.set(rightChar, (rightMap.get(rightChar) ?? 0) + 1);
      }
    }
  }

  const out: NgramCandidate[] = [];
  for (const [gram, stat] of middle) {
    if (!/^[\u4e00-\u9fff]+$/.test(gram)) {
      continue;
    }
    // ⚠️ 刻意**不** import `pipeline/dictionary.ts` 的 `isStopWord`：
    //    那会形成 `genre-pack → pipeline → genre-pack` 的循环依赖。
    //    这里直接问题材包，语义与 `isStopWord` 完全一致（精确相等，不是子串）。
    if (genrePack.lexicon.stopWords.has(gram)) {
      continue;
    }
    const leftMap = left.get(gram) ?? new Map<string, number>();
    const rightMap = right.get(gram) ?? new Map<string, number>();
    const freedom = Math.min(entropy(leftMap), entropy(rightMap));
    out.push({ gram, frequency: stat.frequency, cohesion: stat.cohesion, freedom });
  }
  return out;
}

/**
 * 按自由度阈值切片。
 *
 * 与 `discoverNgrams` **分开**是刻意的（见其注释）：这样「旋钮在自由度上」
 * 才是 API 层面看得见的事实，而不是一句注释。
 *
 * @param candidates `discoverNgrams` 的输出
 * @param minFreedom 自由度下限（含）。批 28 定的是 **0.6**
 * @returns 满足 `freedom ≥ minFreedom` 的子集（**保持原顺序**）
 */
export function selectByFreedom(
  candidates: readonly NgramCandidate[],
  minFreedom: number
): NgramCandidate[] {
  return candidates.filter((candidate) => candidate.freedom >= minFreedom);
}

/** 候选排序键。 */
export interface CandidateRankKey {
  readonly name : string;
  readonly score: (candidate: NgramCandidate) => number;
}

/**
 * 可用的候选排序键 —— **刻意只有两个**。
 *
 * 批 28 实测的 top-40 精度：
 *
 * | 排序键 | 儒林 | 红楼 |
 * | --- | --- | --- |
 * | **频次** | 15.0% | 40.0% |
 * | **频次×长度** | **25.0%** | 40.0% |
 * | 凝固度 | **0.0%** | **0.0%** |
 * | 自由度 | **0.0%** | 7.5% |
 * | 凝固×自由 | 12.5% | 20.0% |
 *
 * 凝固度/自由度排在前面的是 `怂恿`/`朦胧`/`铿锵`/`踌躇`/`琵琶` 这类**联绵词** ——
 * 「像词」的最高分几乎被它们占满，而**专名与常用词的差别不在「像不像词」，在「指不指人」**。
 *
 * ⚠️ 把它们从 API 里**拿掉**（而不是留着加注释），是为了让「用错了键」
 * 变成一次**编译错误**，而不是一个静默的坏结果 —— 本仓库反复栽在后者上。
 */
export const CANDIDATE_RANK_KEYS: readonly CandidateRankKey[] = [
  { name: "频次",      score: (candidate) => candidate.frequency },
  { name: "频次×长度", score: (candidate) => candidate.frequency * candidate.gram.length }
];

/**
 * 按指定键降序排序（**不修改入参**）。
 *
 * @param candidates 候选列表
 * @param keyName `CANDIDATE_RANK_KEYS` 里的名字
 * @returns 新数组（降序）
 * @throws 名字不在 `CANDIDATE_RANK_KEYS` 里时抛错（防止静默退化成「不排序」）
 */
export function rankCandidates(
  candidates: readonly NgramCandidate[],
  keyName: string
): NgramCandidate[] {
  const key = CANDIDATE_RANK_KEYS.find((candidate) => candidate.name === keyName);
  if (key === undefined) {
    const available = CANDIDATE_RANK_KEYS.map((candidate) => candidate.name).join(" / ");
    throw new Error(`未知的候选排序键：${keyName}（可选：${available}）`);
  }
  return [...candidates].sort((left, right) => key.score(right) - key.score(left));
}

/**
 * 章节标题里的**章号前缀**：`第一回　` / `第1章 ` / `卷三 `。
 *
 * 与 `parse-text.ts` 的 `CHAPTER_PATTERNS` **同构但不同用**：
 * 那边用来**识别**标题行（锚定整行），这边用来**剥掉**前缀、只留标题正文。
 *
 * ⚠️ 两个分支缺一不可 —— 卷帙形态（`卷三`）**不带** `第`：
 * 只写「第…回/章/节/篇」那一支的话，`卷三 某标题` 会**整条原样留下**，
 * 于是 `卷三` / `三某` 之类样板照样进候选（本模块的测试就是被这一条抓出来的）。
 *
 * ⚠️ 不 import `parse-text.ts` 的那个正则：它锚定整行（`^...$`）且用于**判定**，
 * 语义不同；且 `genre-pack` 依赖 `importing` 会把「题材包」和「导入」两层耦在一起。
 */
const CHAPTER_NUMBER_PREFIX =
  /^(?:第\s*[0-9一二三四五六七八九十百千零〇两]+\s*[回章节篇]|[卷篇]\s*[0-9一二三四五六七八九十百千零〇两]+)\s*/u;

/**
 * 剥掉章节标题的**章号前缀**，只留标题正文。
 *
 * ⚠️ **只在回目通道里用**：正文里的「第一回」是叙述内容，剥不得。
 *
 * 为什么必须剥：儒林的 `第一回　说楔子…` 整串都是汉字，
 * 于是 `第一` / `一回` / `第一回` 都会成为候选 —— 实测占 **181 条**（1903 → 1722），
 * 全是样板噪声。红楼的 `第1章 ` 含 ASCII 数字，含数字的 n-gram 本就被
 * 「纯 CJK」过滤掉 → 对它剥离是**无操作**（4090 → 4090）。
 *
 * @param title 章节标题（来自 `parseChapters` 的 `chapter.title`）
 * @returns 去掉章号前缀的标题；无前缀时**原样返回**
 */
export function stripChapterNumberPrefix(title: string): string {
  return title.replace(CHAPTER_NUMBER_PREFIX, "");
}

/**
 * 回目通道的发现参数。**与正文通道不同**，理由见文件头「回目通道」一节第 2 条。
 *
 * - `minFrequency: 1`：回目里每个字串几乎只出现一次（实测最高 5 / 18）。
 * - `minCohesion: -Infinity`：凝固度闸对回目**不可用** —— 回目只有几十行，
 *   分母（部件频次）几乎全是 1，`log` 值没有可比性。
 * - `maxN: 4`：与正文通道一致（词典实测无一条超过 4 字）。
 *
 * ⚠️ **没有 `minFreedom`**：`F = 1 ⟹ freedom ≡ 0`，任何正的自由度闸都会把回目清空。
 */
export const HEADING_DISCOVERY_DEFAULTS = {
  maxN        : 4,
  minFrequency: 1,
  minCohesion : Number.NEGATIVE_INFINITY
} as const;

/**
 * **回目通道**：以章节标题为语料发现候选。
 *
 * 它是 `discoverNgrams` 的一个**薄封装** —— 只做两件正文通道不做的事：
 * ① 逐行剥掉章号前缀；② 用回目适配的闸门（`HEADING_DISCOVERY_DEFAULTS`）。
 *
 * ⚠️ 输出的 `frequency` / `cohesion` / `freedom` 是**回目语料内**的统计量，
 * **不可与正文候选的统计量直接比较**（不同语料、不同闸门）。
 * 需要跨语料比较时用 `selectNovelCandidates` 做集合差，而不是比大小。
 *
 * @param headings 章节标题列表（`parseChapters` 的 `chapter.title`，**含**前置内容也行，调用方过滤）
 * @param options 覆盖默认闸门（一般不需要）
 * @returns 候选列表（顺序由频次表插入序决定，调用方自行排序）
 */
export function discoverHeadingCandidates(
  headings: readonly string[],
  options: DiscoveryOptions = {}
): NgramCandidate[] {
  const text = headings.map(stripChapterNumberPrefix).join("\n");
  const merged: DiscoveryOptions = {
    maxN        : options.maxN ?? HEADING_DISCOVERY_DEFAULTS.maxN,
    minFrequency: options.minFrequency ?? HEADING_DISCOVERY_DEFAULTS.minFrequency,
    minCohesion : options.minCohesion ?? HEADING_DISCOVERY_DEFAULTS.minCohesion
  };
  if (options.genrePack !== undefined) {
    return discoverNgrams(text, { ...merged, genrePack: options.genrePack });
  }
  return discoverNgrams(text, merged);
}

/**
 * 集合差：`candidates` 里**不在** `known` 中的部分（按 `gram` 比较）。
 *
 * 用途：算「回目通道的**净新增**」= 回目候选 − 正文候选。
 * 这是这条通道的**真实成本**（要额外交给 LLM 过滤多少条），
 * 而「回目候选总数」（1722 / 4090）会把它**高估 9% / 6%**。
 *
 * ⚠️ 比较的是**字面**（`gram`），不是归一化后的形式 —— 与 `auditDictionary`
 * 的口径不同（那边先过 `normalizeName`）。这里刻意保持字面：
 * 两个通道的候选都直接取自文本，字面相同才是真的重复。
 *
 * @param candidates 待筛候选
 * @param known 已知候选（通常是正文通道的输出）
 * @returns `candidates` 中不在 `known` 里的条目（**保持原顺序**）
 */
export function selectNovelCandidates(
  candidates: readonly NgramCandidate[],
  known: readonly NgramCandidate[]
): NgramCandidate[] {
  const knownGrams = new Set(known.map((candidate) => candidate.gram));
  return candidates.filter((candidate) => !knownGrams.has(candidate.gram));
}

/**
 * 统计某字串在正文里的出现次数（按**每个偏移**计数，重叠也计）。
 *
 * ⚠️ 批 28 的探针把这一步的注释写成了「**非重叠**」，但它实际是
 * `indexOf(needle, at + 1)` —— 前进 1 而不是前进 `needle.length`，所以**重叠也计**。
 * 这里按**代码的真实语义**写注释（口径与探针逐字节一致，故批 28 的读数可复现）。
 *
 * @param body 正文
 * @param needle 待查字串（空串返回 0，避免死循环）
 */
export function countOccurrences(body: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let at = body.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = body.indexOf(needle, at + 1);
  }
  return count;
}

/** 词典审计结果（**两个方向**）。 */
export interface DictionaryAudit {
  /**
   * **错收**：词典条目在**原文**（正文 + 回目）里出现 0 次（异文 / 死条目）。
   *
   * 🚨 口径必须是**原文**而不是**正文** —— 批 35/36 实测：只看正文会把
   * `蘧駪夫` `王孝廉` 这类「回目用、正文不用」的**活条目**报成死条目
   * （根因：`parseChapters` 把回目行放进 `chapter.title`、**不进** `chapter.text`）。
   */
  readonly deadEntries        : readonly string[];
  /**
   * **只在回目里**：正文 0 次、但回目里有 —— **活条目**，绝不能当死条目删。
   *
   * 单列出来是为了让「这一条到底该不该删」**不需要再判断一次**：
   * 它出现在回目里，就是这本书真的用过的写法。
   */
  readonly headingOnlyEntries : readonly string[];
  /** **漏收**：候选出现在正文里、却不在词典中（高频别名 / 未收录专名）。 */
  readonly uncoveredCandidates: readonly string[];
}

/**
 * 双向审计一份作品词典。
 *
 * ## 为什么值得单独做一个工具
 *
 * 批 28 用它**查出了 4 条真 bug**（不是「词典不够全」，是「词典里有错」）：
 *
 * | 词典条目 | 词典计数 | 正文实际写法 | 正文计数 |
 * | --- | --- | --- | --- |
 * | `刘姥姥` | **0** | `刘老老` | **288** |
 * | `蘅芜苑` | **0** | `蘅芜院` | **20** |
 * | `赤瑕宫` | **0** | `赤霞宫` | **2** |
 * | `李苇萧` | **0** | `季苇萧` | **110** |
 *
 * 与批 12 的发现（n-gram 可反向暴露**漏收**）合起来，**同一套机器给出两个方向**：
 * 漏收（高频候选不在词典里）与错收（词典条目在**原文**出现 0 次）。
 *
 * 🚨 **「原文」= 正文 + 回目，这一点是批 36 修的口径 bug。**
 * 修复前它只查 `body`，而 `body` **不含回目**（`parseChapters` 把回目放进 `chapter.title`）
 * → 儒林实测把 **2 条活条目**（`蘧駪夫` `王孝廉`）报成了死条目。
 * 「正文 0 次」与「原文 0 次」是**两件事**：前者里有一类是**回目用、正文不用**。
 * 所以 `headings` 是**必填**（不给默认值）—— 让每个调用点**显式**表态，
 * 而不是让「忘了传」静默退化成那个已知错误的口径。
 *
 * ⚠️ 条目一律先过 `normalizeName` 再比较 —— 与 `discoverNgrams` 的候选口径一致。
 * ⚠️ `uncoveredCandidates` 的**规模取决于传入的候选列表**：传 `selectByFreedom` 的结果
 * 才会得到「该自由度档下漏收的东西」。**这不是一个与参数无关的常数。**
 *
 * @param body 正文（**不含**回目）
 * @param pack 作品包
 * @param candidates 候选列表（通常来自 `discoverNgrams` + `selectByFreedom`）
 * @param headings 回目行（`loadBookBody` 的 `headings` / `parseChapters` 的 `chapter.title`）
 * @returns 三个名单（错收 / 只在回目里 / 漏收）
 */
export function auditDictionary(
  body: string,
  pack: WorkPack,
  candidates: readonly NgramCandidate[],
  headings: readonly string[]
): DictionaryAudit {
  const entries = new Set<string>();
  for (const [surface] of pack.properNouns) {
    const normalized = normalizeName(surface);
    if (normalized.length > 0) {
      entries.add(normalized);
    }
  }

  const headingText = headings.join("\n");
  const deadEntries: string[] = [];
  const headingOnlyEntries: string[] = [];
  for (const entry of entries) {
    if (countOccurrences(body, entry) > 0) {
      continue;
    }
    // 正文 0 次 → 还要看回目：回目里有就是**活条目**（这一本书真的用过这个写法）。
    if (countOccurrences(headingText, entry) > 0) {
      headingOnlyEntries.push(entry);
    } else {
      deadEntries.push(entry);
    }
  }

  const uncoveredCandidates: string[] = [];
  for (const candidate of candidates) {
    if (!entries.has(candidate.gram)) {
      uncoveredCandidates.push(candidate.gram);
    }
  }

  return { deadEntries, headingOnlyEntries, uncoveredCandidates };
}
