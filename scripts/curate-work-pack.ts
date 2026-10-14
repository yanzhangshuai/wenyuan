import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { normalizeName } from "@/lib/text";
import { AiCallError, callWithRetry, getModelSnapshot } from "@/server/modules/ai/client";
import { resolveWorkPack } from "@/server/modules/analysis/genre-pack";
import {
  DEFAULT_CURATION_BATCH_SIZE,
  applyCuration,
  emptyWorkPack,
  estimateCurationCost,
  failedCurationOutcome,
  mergeCurationOutcomes,
  parseCurationResponse,
  planCurationBatches,
  type CurationApplySummary,
  type CurationParseOutcome,
  type MergedCuration
} from "@/server/modules/analysis/genre-pack/curation";
import {
  DISCOVERY_DEFAULTS,
  discoverNgrams,
  rankCandidates,
  selectByFreedom,
  type NgramCandidate
} from "@/server/modules/analysis/genre-pack/discovery";

import { loadBookBody } from "./lib/book-corpus";

/**
 * N12 tier ③「**离线作品包生成器**」的 **LLM 半边入口** —— 本仓库**唯一**会花钱的离线脚本。
 *
 * 用法：
 *   # 先看计划与成本（**默认就是 dry-run，永远不会花钱**）
 *   pnpm exec tsx --conditions=react-server scripts/curate-work-pack.ts books/rulin.txt --pack 儒林外史
 *   # 确认成本后再真的调用
 *   pnpm exec tsx --conditions=react-server scripts/curate-work-pack.ts books/rulin.txt --pack 儒林外史 --spend
 *   # 批 37 起：把【回目】原文当独立输入块一起发（A 臂；会**增加每批输入 token**，故须显式开关）
 *   pnpm exec tsx --conditions=react-server scripts/curate-work-pack.ts books/rulin.txt --pack 儒林外史 --headings --spend
 *
 * ## ⚠️ 三条安全设计（都不是风格问题）
 *
 * 1. **默认 dry-run**：不加 `--spend` 就**只打印计划**，一次调用都不发。
 *    「花钱必须是一个被看见的动作」在这里落成默认值 —— 裸调用**在结构上**不可能扣费。
 * 2. **`--max-calls` 闸门**：计划调用数超过上限时**直接拒跑**（除非 `--force`）。
 *    理由：候选数随 `--freedom` 变化很大（0.8 → 0.6 会让候选数翻 2.7 倍），
 *    一个手滑的参数就会把成本放大一个量级。
 * 3. **`supplied` 默认不落盘**：模型凭常识补的名字**无法被程序验伪**，
 *    只打印给人看；要写进词典必须显式 `--include-supplied`。
 * 4. **打印不截断 + 补全项可显式落盘（`--out-supplied`）**：
 *    上面第 3 条说补全项「只打印给人看」—— 那就意味着**打印一旦截断，数据就永久丢失**。
 *    批 33 实测：儒林 top-300 的补全项有 **129** 条，而打印上限是 80 条
 *    → 后 **49 条既没落盘也没人看见**（`merged.result.supplied` 只在内存里活过一次）。
 *    ⚠️ 这是**缺陷而不是风格**：最需要人工过目的产物，恰恰是唯一不落盘的产物。
 *    修法两条一起上 —— 打印去掉 `slice` 上限，并给一个**显式**的落盘开关。
 * 5. **`--headings` 默认关闭**（批 37）：喂回目会**增加每批的输入 token**
 *    （儒林回目 1235 字 ≈ 1577 token × 调用次数），属于花钱的动作 → 与 `--spend` 同一哲学，
 *    必须**被看见**。关闭时提示词与护栏**逐字节**退回旧行为（有单测钉住）。
 *
 * ## 为什么它和 `generate-work-pack.ts` 是两个脚本
 *
 * 本脚本 import 了 `@/server/modules/ai/client`（`server-only`）→ 必须带
 * `--conditions=react-server`。而 `generate-work-pack.ts` 是**纯确定性**的、不需要该条件。
 * 拆开让「哪一个是纯的」在文件名与运行方式上就看得出来，
 * 而不是让一个脚本内部藏一条会花钱的分支。
 *
 * ## 它**不在流水线内**（C3 契约）
 *
 * 流水线的 LLM 调用点由 `pipeline/run.ts` 独占（恰好 2 个，见
 * `pipeline/llm-callpoints.test.ts` 与 `verify/_wb_controlflow_diff.py`）。
 * 本脚本位于 `scripts/`，**不被任何 `src/` 文件 import** ——
 * 这条不变量由 `llm-callpoints.test.ts` 新增的断言钉死（本批补的盲区）。
 */

/** 命令行参数。 */
interface CliOptions {
  filePath       : string;
  pack           : string | undefined;
  out            : string | undefined;
  outSupplied    : string | undefined;
  freedom        : number;
  limit          : number;
  batchSize      : number;
  maxCalls       : number;
  spend          : boolean;
  force          : boolean;
  includeSupplied: boolean;
  headings       : boolean;
}

/** 解析一个整数参数（非法即抛，不静默兜底）。 */
function requireInt(raw: string | undefined, flag: string, min: number): number {
  const parsed = Number(raw);
  if (raw === undefined || !Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${flag} 需要 ≥ ${String(min)} 的整数，收到：${String(raw)}`);
  }
  return parsed;
}

/** 解析一个数值参数。 */
function requireNumber(raw: string | undefined, flag: string): number {
  const parsed = Number(raw);
  if (raw === undefined || !Number.isFinite(parsed)) {
    throw new Error(`${flag} 需要一个数字，收到：${String(raw)}`);
  }
  return parsed;
}

/**
 * 解析命令行参数。
 *
 * @param argv 进程参数（不含 node 与脚本路径）
 * @returns 解析结果
 * @throws 缺少路径或数值参数非法时抛出
 */
function parseArgs(argv: readonly string[]): CliOptions {
  const positional: string[] = [];
  const options: CliOptions = {
    filePath       : "",
    pack           : undefined,
    out            : undefined,
    outSupplied    : undefined,
    freedom        : DISCOVERY_DEFAULTS.minFreedom,
    limit          : 300,
    batchSize      : DEFAULT_CURATION_BATCH_SIZE,
    maxCalls       : 200,
    spend          : false,
    force          : false,
    includeSupplied: false,
    headings       : false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--spend") {
      options.spend = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--include-supplied") {
      options.includeSupplied = true;
      continue;
    }
    if (arg === "--headings") {
      options.headings = true;
      continue;
    }
    if (arg === "--pack") {
      options.pack = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--out-supplied") {
      options.outSupplied = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--freedom") {
      options.freedom = requireNumber(argv[index + 1], "--freedom");
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      options.limit = requireInt(argv[index + 1], "--limit", 1);
      index += 1;
      continue;
    }
    if (arg === "--batch") {
      options.batchSize = requireInt(argv[index + 1], "--batch", 1);
      index += 1;
      continue;
    }
    if (arg === "--max-calls") {
      options.maxCalls = requireInt(argv[index + 1], "--max-calls", 1);
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
      "缺少书籍文本路径。用法：tsx --conditions=react-server scripts/curate-work-pack.ts " +
        "<书籍文本> [--pack 标题] [--limit 300] [--batch 150] [--freedom 0.6] [--headings] [--spend] " +
        "[--out 作品包.json] [--out-supplied 补全项.json]"
    );
  }
  options.filePath = filePath;
  return options;
}

/** 右对齐定宽（中文按 2 列宽计）。 */
function pad(text: string, width: number): string {
  let visual = 0;
  for (const char of text) {
    visual += (char.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
  }
  return text + " ".repeat(Math.max(0, width - visual));
}

/** 逐批调用模型。 */
async function runBatches(
  batches: ReturnType<typeof planCurationBatches>,
  model: string,
  headings: readonly string[],
  bodyUniverse: readonly NgramCandidate[]
): Promise<{ outcomes: CurationParseOutcome[]; failed: number[]; tokensIn: number; tokensOut: number; usd: number }> {
  const outcomes: CurationParseOutcome[] = [];
  const failed: number[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let usd = 0;

  for (const batch of batches) {
    let text: string;
    try {
      const result = await callWithRetry({
        model,
        system     : batch.system,
        user       : batch.user,
        temperature: 0,
        maxTokens  : 4096
      });
      text = result.text;
      tokensIn += result.usage.tokensIn;
      tokensOut += result.usage.tokensOut;
      usd += result.usage.costUsd ?? 0;
    } catch (error) {
      const kind = error instanceof AiCallError ? error.kind : "unknown";
      console.log(
        `  ✗ 批 ${String(batch.index + 1)}/${String(batch.total)} 调用失败（${kind}）：` +
          (error instanceof Error ? error.message : String(error))
      );
      failed.push(batch.index);
      outcomes.push(failedCurationOutcome());
      continue;
    }

    const outcome = parseCurationResponse(text, batch.candidates, headings, bodyUniverse);
    if (outcome.result === null) {
      failed.push(batch.index);
    }
    outcomes.push(outcome);
    console.log(
      `  ✓ 批 ${pad(String(batch.index + 1), 4)}/${String(batch.total)}  ` +
        `接受 ${pad(String(outcome.result?.accepted.length ?? 0), 5)}  ` +
        `补全 ${pad(String(outcome.result?.supplied.length ?? 0), 4)}  ` +
        `丢弃(幻觉) ${pad(String(outcome.diagnostics.unknownVerdicts.length), 4)}` +
        (outcome.errorKind === null ? "" : `  ⚠️ ${outcome.errorKind}`)
    );
  }

  return { outcomes, failed, tokensIn, tokensOut, usd };
}

/** 打印合并结果的诊断。 */
function printDiagnostics(merged: MergedCuration): void {
  const { diagnostics, failedBatches } = merged;
  console.log("");
  console.log("【诊断】（丢弃的东西必须看得见 —— 否则会表现为「模型不太行」而不是「护栏吃了一批」）");
  console.log(`  失败批           ：${failedBatches.length === 0 ? "0（全成功）" : failedBatches.join(" ")}`);
  console.log(`  幻觉/改写（已丢）：${String(diagnostics.unknownVerdicts.length)} 条  ${diagnostics.unknownVerdicts.slice(0, 30).join(" ")}`);
  console.log(`  回目来源（已收）：${String(diagnostics.headingVerdicts.length)} 条  ${diagnostics.headingVerdicts.slice(0, 30).join(" ")}`);
  console.log("     ⚠️ 口径：对照集是**全书正文候选**（不是本批的 150 条）—— 拿本批当对照会把");
  console.log("        「排名在 --limit 之外的正文候选」误算成回目独有（批 37 实测高估到 138 条）。");
  console.log(`  放错桶（已丢）    ：${String(diagnostics.misplacedSupplied.length)} 条  ${diagnostics.misplacedSupplied.slice(0, 30).join(" ")}`);
  console.log(`  重复补全（已丢）  ：${String(diagnostics.duplicateSupplied.length)} 条`);
  console.log(`  type 非法（兜底） ：${String(diagnostics.invalidTypes.length)} 条`);
}

/** 打印与既有词典的差。 */
function printApplySummary(summary: CurationApplySummary): void {
  console.log("");
  console.log("【合并结果】");
  console.log(`  新增（已校验）  ：${String(summary.addedAccepted.length)} 条`);
  console.log(`     ${summary.addedAccepted.join(" ")}`);
  console.log(`  新增（未验证）  ：${String(summary.addedSupplied.length)} 条`);
  console.log(`  已在词典中跳过  ：${String(summary.skippedExisting.length)} 条`);
  console.log(`  合并后总条目    ：${String(summary.totalEntries)} 条`);
}

/** 主流程。 */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const absolutePath = resolve(options.filePath);
  const { body, chapterCount, deletedLines, headings } = await loadBookBody(absolutePath);

  // `--headings` 关掉时**逐字节退回旧行为**（提示词不变、护栏不变）。
  // 之所以要一个显式开关：喂回目会**增加每批的输入 token**，属于花钱的动作，
  // 必须像 `--spend` 一样**被看见**（不能默认打开）。
  const headingLines: readonly string[] = options.headings ? headings : [];
  const headingChars = headingLines.reduce((sum, line) => sum + line.length, 0);

  console.log("=".repeat(78));
  console.log(`${basename(absolutePath)}  ·  ${String(chapterCount)} 章 / ${String(body.length)} 字`);
  console.log(`结构性噪声：删 ${String(deletedLines)} 行（生产口径）`);
  console.log("=".repeat(78));

  const all = discoverNgrams(body);
  const selected = selectByFreedom(all, options.freedom);
  // 按「频次×长度」排序后取前 `--limit` 条 —— 批 28 实测该键的 top-40 精度最高
  // （儒林 25% / 红楼 40%），优于纯频次（15% / 40%）与凝固度/自由度（0%）。
  const ranked = rankCandidates(selected, "频次×长度");
  const capped = ranked.slice(0, options.limit);

  const batches = planCurationBatches(capped, options.batchSize, headingLines);
  const estimate = estimateCurationCost(capped.length, options.batchSize, headingChars);

  console.log("");
  console.log("【计划】");
  console.log(`  n-gram 候选（未过自由度闸）  ：${String(all.length)} 条`);
  console.log(`  freedom ≥ ${options.freedom.toFixed(1)} 之后      ：${String(selected.length)} 条`);
  console.log(`  取「频次×长度」top-${String(options.limit)}      ：${String(capped.length)} 条`);
  console.log(
    options.headings
      ? `  回目输入块（--headings）    ：${String(headingLines.length)} 行 / ${String(headingChars)} 字（**每批都发**）`
      : "  回目输入块                  ：未启用（加 `--headings` 才发）"
  );
  console.log(`  每批 ${String(options.batchSize)} 条 → 需要调用   ：${String(batches.length)} 次`);
  console.log(
    `  token 量级（**估算，非账单**）：输入 ≈ ${String(estimate.approxInputTokens)}、` +
      `输出 ≈ ${String(estimate.approxOutputTokens)}`
  );

  if (batches.length === 0) {
    console.log("");
    console.log("候选为空 → 无需调用。");
    return;
  }

  // —— 闸门 2：调用数上限 ——
  if (batches.length > options.maxCalls && !options.force) {
    console.log("");
    console.log(
      `⛔ 计划调用 ${String(batches.length)} 次 > --max-calls ${String(options.maxCalls)} → **拒跑**。`
    );
    console.log("   要跑请显式加 --force（或调大 --max-calls）。");
    process.exitCode = 1;
    return;
  }

  // —— 闸门 1：默认 dry-run ——
  if (!options.spend) {
    console.log("");
    console.log("🟡 **dry-run（默认）**：一次调用都不会发。确认成本后加 `--spend` 才会真调用。");
    console.log("");
    console.log(`【第 1 批提示词预览】（system ${String(batches[0]?.system.length ?? 0)} 字）`);
    console.log("-".repeat(78));
    console.log((batches[0]?.user ?? "").slice(0, 1200));
    console.log("-".repeat(78));
    if (options.headings) {
      // 回目块在 user 的**尾部**，上面 1200 字的预览一定截不到它 —— 单独印一段，
      // 否则「dry-run 看到的东西」与「真正发出去的东西」不一致（那正是批 33 的教训）。
      console.log(`【回目输入块预览】（共 ${String(headingChars)} 字，每批都发）`);
      console.log("-".repeat(78));
      console.log(headingLines.join("\n").slice(0, 600));
      console.log("-".repeat(78));
    }
    return;
  }

  const snapshot = getModelSnapshot();
  console.log("");
  console.log(`🔴 **--spend 已开启**：将真实调用 ${String(batches.length)} 次（模型 ${snapshot.extractModel}）。`);
  console.log("");

  const run = await runBatches(batches, snapshot.extractModel, headingLines, selected);
  const merged = mergeCurationOutcomes(run.outcomes, run.failed);
  console.log("");
  console.log(
    `实际用量：输入 ${String(run.tokensIn)} / 输出 ${String(run.tokensOut)} token，` +
      `成本 ≈ $${run.usd.toFixed(4)}`
  );

  printDiagnostics(merged);
  console.log("");
  console.log(`【已校验的接受项】${String(merged.result.accepted.length)} 条`);
  console.log(`  ${merged.result.accepted.map((entry) => entry.name).join(" ")}`);
  console.log("");
  console.log(`【未验证的补全项】${String(merged.result.supplied.length)} 条 ⚠️ **必须人工过目后再决定是否入库**`);
  console.log(`  ${merged.result.supplied.map((entry) => entry.name).join(" ")}`);

  // —— 基准包：给了 --pack 就续写它，否则从空白包开始 ——
  let base;
  if (options.pack === undefined) {
    base = emptyWorkPack("unregistered", "《未命名》", 100_000);
  } else {
    const resolution = resolveWorkPack(options.pack);
    if (!resolution.matched) {
      console.log("");
      console.log(`⚠️ 作品标题「${options.pack}」未命中注册表 → 从空白包开始（新书场景）。`);
      base = emptyWorkPack(normalizeName(options.pack), `《${options.pack}》`, 100_000);
    } else {
      base = resolution.pack;
    }
  }

  const applied = applyCuration(base, merged.result, { includeSupplied: options.includeSupplied });
  printApplySummary(applied.summary);
  if (!options.includeSupplied && merged.result.supplied.length > 0) {
    console.log("");
    console.log("  ℹ️ 补全项**未写入**（默认）。要写入请加 `--include-supplied`。");
  }

  if (options.out !== undefined) {
    const outPath = resolve(options.out);
    await writeFile(outPath, JSON.stringify(applied.pack, null, 2), "utf8");
    console.log("");
    console.log(`已写出：${outPath}`);
  }

  // 未验证的补全项**默认不落盘**（见文件头第 3 条），但「只打印」不能让数据随滚屏消失
  // —— 所以给一个显式开关。它写的是**原始条目**（含模型给的 type），不经 `applyCuration`。
  if (options.outSupplied !== undefined) {
    const suppliedPath = resolve(options.outSupplied);
    await writeFile(suppliedPath, JSON.stringify(merged.result.supplied, null, 2), "utf8");
    console.log("");
    console.log(`已写出（未验证补全项，共 ${String(merged.result.supplied.length)} 条）：${suppliedPath}`);
  }
}

await main();
