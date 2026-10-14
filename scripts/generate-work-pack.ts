import { basename, resolve } from "node:path";

import { normalizeName } from "@/lib/text";
import { resolveWorkPack, type WorkPack } from "@/server/modules/analysis/genre-pack";
import {
  CANDIDATE_RANK_KEYS,
  DISCOVERY_DEFAULTS,
  HEADING_DISCOVERY_DEFAULTS,
  auditDictionary,
  countOccurrences,
  discoverHeadingCandidates,
  discoverNgrams,
  rankCandidates,
  selectByFreedom,
  selectNovelCandidates,
  type NgramCandidate
} from "@/server/modules/analysis/genre-pack/discovery";

import { loadBookBody } from "./lib/book-corpus";

/**
 * **离线作品包生成器**（N12 tier ③）—— 确定性半边。
 *
 * 用法：
 *   pnpm exec tsx scripts/generate-work-pack.ts <书籍文本> [--pack 作品标题] [--freedom 0.6] [--top 40]
 *
 * 它做四件事，**全部零 LLM、零数据库、零网络**：
 * 1. 用字符 n-gram 新词发现扫出**高召回**候选（参数见 `DISCOVERY_DEFAULTS`）；
 * 2. 按 `频次×长度` 排出**人工/LLM 要过的那份清单**；
 * 3. **回目通道**（批 34）：以章节标题为第二份语料 —— `parseChapters` 把回目放进
 *    `title` 而不放进 `text`，所以正文通道**看不见**它；而回目里全是**全名**。
 *    这条通道是「正文只出现 0–1 次的全名」的**唯一**确定性来源。
 * 4. 若给了 `--pack`，再对**现有**作品词典做**双向审计**（错收 + 漏收）＋ 回目通道净增量。
 *
 * ## ⚠️ 它**不是**终点，是「把凭印象手写 173 条」变成「审一份候选清单」
 *
 * 实测（批 12 / 批 28）：纯确定性通道的召回上限是 **83.1% / 73.4%**（`freedom=0.6`），
 * 剩下的 17%～27% 是**低频全名**（正文一律只用简称）→ **必须 LLM 凭常识补**。
 * 而且候选的精度只有 **25% / 40%**（top-40）→ **必须 LLM 做语义过滤**。
 * 所以本脚本的输出**不是**可直接落库的词典，而是**给 LLM 与人工看的输入**。
 *
 * ## 为什么必须走生产的语料路径（而不是直接 `parseChapters(readFileSync(...))`）
 *
 * 生产导入走三步：`normalizeEncoding`（BOM/CRLF/零宽）→ `stripStructuralNoise`（删整行噪声）
 * → `parseChapters`。生成器要产出的词典是**给生产用的**，就必须看**同一份**语料。
 *
 * ⚠️ 这一点有代价，必须记档：批 28 的侦察探针**只做了 `parseChapters`**，
 * 所以它报的绝对值（儒林 27479 / 红楼 53375）是在**未剥离噪声行**的语料上取的 ——
 * 两者**不是同一份语料**（`stripStructuralNoise` 实测删掉儒林 114 行 / 红楼 120 行）。
 * 曲线的**形状**与那条定理不受影响（那是结构性质），但**绝对数不可混用**。
 * 逐数复现批 28 读数的忠实度检查在 `_wb_discovery_replay.ts`（根级只读探针）。
 *
 * ## 运行方式
 *
 * 本脚本不 import `server-only`，故**不需要** `--conditions=react-server`
 * （与 `scripts/eval/run-eval.ts` 同类）。但 `package.json` 里没有它的别名，
 * 直接用 `pnpm exec tsx` 即可。
 */

/** 命令行参数。 */
interface CliOptions {
  filePath: string;
  pack    : string | undefined;
  freedom : number;
  top     : number;
}

/**
 * 解析命令行参数。
 *
 * @param argv 进程参数（不含 node 与脚本路径）
 * @returns 解析结果
 * @throws 缺少路径、或数值参数非法时抛出
 */
function parseArgs(argv: readonly string[]): CliOptions {
  const positional: string[] = [];
  let pack: string | undefined;
  let freedom: number = DISCOVERY_DEFAULTS.minFreedom;
  let top = 40;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pack") {
      pack = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--freedom") {
      const raw = argv[index + 1];
      const parsed = Number(raw);
      if (raw === undefined || !Number.isFinite(parsed)) {
        throw new Error(`--freedom 需要一个数字，收到：${String(raw)}`);
      }
      freedom = parsed;
      index += 1;
      continue;
    }
    if (arg === "--top") {
      const raw = argv[index + 1];
      const parsed = Number(raw);
      if (raw === undefined || !Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--top 需要一个正整数，收到：${String(raw)}`);
      }
      top = parsed;
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      positional.push(arg);
    }
  }

  const filePath = positional[0];
  if (filePath === undefined) {
    throw new Error(
      "缺少书籍文本路径。用法：" +
        "tsx scripts/generate-work-pack.ts <书籍文本> [--pack 作品标题] [--freedom 0.6] [--top 40]"
    );
  }

  return { filePath, pack, freedom, top };
}

/** 百分比格式化。 */
function pct(part: number, whole: number): string {
  return whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`;
}

/** 右对齐定宽（中文按 2 列宽计）。 */
function pad(text: string, width: number): string {
  let visual = 0;
  for (const char of text) {
    visual += (char.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
  }
  return text + " ".repeat(Math.max(0, width - visual));
}

/** 归一化去重后的作品词典条目（口径与 `auditDictionary` 内部一致）。 */
function packEntries(pack: WorkPack): string[] {
  const seen = new Set<string>();
  for (const [surface] of pack.properNouns) {
    const normalized = normalizeName(surface);
    if (normalized.length > 0) {
      seen.add(normalized);
    }
  }
  return [...seen];
}

/** 主流程。 */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const absolutePath = resolve(options.filePath);
  const { body, chapterCount, deletedLines, headings } = await loadBookBody(absolutePath);

  console.log("=".repeat(78));
  console.log(`${basename(absolutePath)}  ·  ${String(chapterCount)} 章 / ${String(body.length)} 字`);
  console.log(`结构性噪声：删 ${String(deletedLines)} 行（生产口径；批 28 探针未做这一步）`);
  console.log("=".repeat(78));

  const candidates = discoverNgrams(body);
  console.log(`n-gram 候选（F ≥ ${String(DISCOVERY_DEFAULTS.minFrequency)}、` +
    `凝固度 ≥ ${String(DISCOVERY_DEFAULTS.minCohesion)}、**未过自由度闸**）：` +
    `${String(candidates.length)} 个`);
  console.log("");

  // —— 自由度曲线（真正的旋钮）——
  console.log("【自由度曲线】（固定频次闸；定理：freedom ≥ f ⟹ 出现次数 ≥ ⌈e^f⌉）");
  console.log("  freedom   隐含最低频次   候选数");
  for (const step of [0, 0.2, 0.4, 0.6, 0.8]) {
    const subset = selectByFreedom(candidates, step);
    const implied = Math.ceil(Math.exp(step));
    const marker = Math.abs(step - DISCOVERY_DEFAULTS.minFreedom) < 1e-9 ? "  ← 默认" : "";
    console.log(
      `  ${pad(step.toFixed(1), 9)} ${pad(`≥ ${String(implied)}`, 13)} ` +
        `${pad(String(subset.length), 10)}${marker}`
    );
  }
  console.log("");

  // —— 候选清单（人工/LLM 要过的那一份）——
  const selected = selectByFreedom(candidates, options.freedom);
  console.log(
    `【候选清单】freedom ≥ ${options.freedom.toFixed(1)} → ${String(selected.length)} 条；` +
      `可用排序键：${CANDIDATE_RANK_KEYS.map((key) => key.name).join(" / ")}`
  );
  for (const key of CANDIDATE_RANK_KEYS) {
    const ranked = rankCandidates(selected, key.name);
    console.log(`  ▸ 按「${key.name}」top-${String(options.top)}：`);
    console.log(
      `    ${ranked
        .slice(0, options.top)
        .map((candidate) => `${candidate.gram}(${String(candidate.frequency)})`)
        .join(" ")}`
    );
  }
  console.log("");

  // —— 回目通道（批 34）：正文看不见的那份「作者手写的全名清单」——
  const headingCandidates = discoverHeadingCandidates(headings);
  const novelHeadings = selectNovelCandidates(headingCandidates, selected);
  const headingChars = headings.join("\n").length;

  console.log("【回目通道】（`parseChapters` 把回目放进 `title`、**不放** `text` → 正文通道看不见它们）");
  console.log(
    `  回目：${String(headings.length)} 行 / ${String(headingChars)} 字 ` +
      `（正文 ${String(body.length)} 字 —— 回目只有它的 ${pct(headingChars, body.length)}）`
  );
  console.log(
    `  回目候选（F ≥ ${String(HEADING_DISCOVERY_DEFAULTS.minFrequency)}、凝固度闸放开）：` +
      `${String(headingCandidates.length)} 条；其中**正文通道没有的**：` +
      `${String(novelHeadings.length)} 条 ← **真实新增规模**（要额外交给 LLM 的就是它）`
  );
  console.log(
    "  ⚠️ 两通道的 `frequency`/`cohesion`/`freedom` **不可比**（不同语料、不同闸门）；差集按**字面**算。"
  );
  console.log(
    "  ⚠️ 精度只有 **1–2%**（实测 1.7% / 1.4%）→ **必须过 LLM**；且**没有可用的排序键**"
  );
  console.log("     （正文频次正/反两个方向都是反信号，实测见 `discovery.ts` 文件头第 3 条）。");
  console.log("");

  // —— 可选：对现有作品词典做双向审计 ——
  if (options.pack === undefined) {
    console.log("（未给 --pack，跳过词典审计。加 --pack 儒林外史 可对现有词典做双向审计。）");
    return;
  }

  const resolution = resolveWorkPack(options.pack);
  if (!resolution.matched) {
    console.log(`⚠️ 作品标题「${options.pack}」未命中注册表 → 无法审计（兜底是空词典）。`);
    return;
  }

  const entries = packEntries(resolution.pack);
  const selectedGrams = new Set(selected.map((candidate) => candidate.gram));
  const covered = entries.filter((entry) => selectedGrams.has(entry));
  const audit = auditDictionary(body, resolution.pack, selected, headings);

  console.log(`【词典审计】${resolution.pack.label}（匹配别名「${String(resolution.matchedAlias)}」）`);
  console.log(`  词典条目（归一化去重后）：${String(entries.length)} 条`);
  console.log(
    `  在 freedom ≥ ${options.freedom.toFixed(1)} 的候选里命中：` +
      `${String(covered.length)}/${String(entries.length)} = ${pct(covered.length, entries.length)}`
  );
  console.log(
    `  ⚠️ 这是**召回的下界**：分母是整份词典，而候选只覆盖「出现 ≥ ${String(DISCOVERY_DEFAULTS.minFrequency)} 次」的部分。`
  );
  console.log("");

  const rankByFrequency = (grams: readonly string[]): NgramCandidate[] =>
    rankCandidates(
      grams
        .map((gram) => selected.find((candidate) => candidate.gram === gram))
        .filter((candidate): candidate is NgramCandidate => candidate !== undefined),
      "频次"
    );

  console.log(`  ⓐ **漏收**（正文里高频出现、词典却没有）：${String(audit.uncoveredCandidates.length)} 条`);
  console.log(
    `     ${rankByFrequency(audit.uncoveredCandidates)
      .slice(0, 30)
      .map((candidate) => `${candidate.gram}(${String(candidate.frequency)})`)
      .join(" ")}`
  );
  console.log("");
  console.log(
    "  ⓑ **错收 / 异文**（词典条目在**原文**（正文 + 回目）出现 **0** 次）：" +
      `${String(audit.deadEntries.length)} 条`
  );
  console.log(`     ${audit.deadEntries.join(" ")}`);
  console.log("");
  console.log(
    "  ⚠️ ⓑ 里可能是**异文**（`刘姥姥` 而正文写 `刘老老`）——" +
      "要逐条查正文实际写法，不能一律当 bug 删。"
  );
  console.log("");
  console.log(
    "  ⓒ **只在回目里**（正文 0 次、回目里有 → **活条目，别删**）：" +
      `${String(audit.headingOnlyEntries.length)} 条`
  );
  console.log(`     ${audit.headingOnlyEntries.join(" ")}`);
  console.log("");
  console.log(
    "  ℹ️ ⓒ 是批 36 修掉的口径 bug：修复前 ⓑ 只查**正文**，而正文**不含回目**"
  );
  console.log("     （`parseChapters` 把回目行放进 `chapter.title`）→ 活条目被报成死条目。");
  console.log("");

  // 词典里有、但候选覆盖不到的 —— 它们**不是**漏收（漏收是反方向），
  // 而是「确定性通道拿不到的低频条目」，即**必须 LLM 凭常识补**的那一部分（批 28 的「下界」）。
  const notCovered = entries.filter((entry) => !selectedGrams.has(entry));
  console.log(
    `  ℹ️ 词典里**候选覆盖不到**的条目：${String(notCovered.length)} 条 —— ` +
      "这是确定性通道的地板（低频/零频），只能靠 LLM 凭常识补。"
  );
  console.log(`     ${notCovered.join(" ")}`);

  // —— 回目通道的**净增量**：正文通道拿不到、回目候选里才有 ——
  const headingGramSet = new Set(headingCandidates.map((candidate) => candidate.gram));
  const headingOnly = notCovered.filter((entry) => headingGramSet.has(entry));
  const headingZeroFreq = headingOnly.filter(
    (entry) => countOccurrences(body, entry) < DISCOVERY_DEFAULTS.minFrequency
  );

  console.log("");
  console.log("【回目通道的净增量】");
  console.log(
    `  正文通道拿不到、**回目候选里有**的词典条目：${String(headingOnly.length)} 条` +
      `（占「候选覆盖不到」的 ${pct(headingOnly.length, notCovered.length)}）`
  );
  console.log(`     ${headingOnly.join(" ")}`);
  console.log(
    `  其中**正文出现 < ${String(DISCOVERY_DEFAULTS.minFrequency)} 次**的：` +
      `${String(headingZeroFreq.length)} 条 ← **只有回目能救**（任何正文方法都拿不到）`
  );
  console.log(`     ${headingZeroFreq.join(" ")}`);
  console.log(
    `  其余 ${String(headingOnly.length - headingZeroFreq.length)} 条在正文里出现过，` +
      "只是被**凝固度闸**切掉 —— 放宽那道闸要贵 17–20 倍，所以仍走回目更划算。"
  );
}

await main();
