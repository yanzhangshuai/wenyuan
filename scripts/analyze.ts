import { eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { books } from "@/server/db/schema";
import { runPipeline } from "@/server/modules/analysis/pipeline/run";
import { runKnowledgeAgent } from "@/server/modules/knowledge/run-agent";
import { formatKnowledgeSummary } from "@/server/modules/knowledge/summary";

/**
 * 解析执行脚本。
 *
 * 用法：
 *   pnpm analyze <bookId>
 *   pnpm analyze --title 《儒林外史》
 *   pnpm analyze <bookId> --with-knowledge   # 解析完成后顺带跑三期判定层（外部资料补全）
 *
 * `--with-knowledge` 是**流程编排**，不是数据合并：
 * 判定层仍写独立的 `external_knowledge` 表、仍不碰图谱（否则会失去成本可预测、
 * $0 预演、可回退与尺子有效性）。未配置检索源时**只提示、不报错**——
 * 解析本身已经成功，增强步骤不得改变解析的成功语义。
 *
 * 设计原因：把「执行解析」做成独立 CLI 而非 API 路由，
 * 使长耗时任务不受 HTTP 超时约束，且便于在 CI 或本地批量跑评测。
 */

/** 是否顺带跑判定层（`--with-knowledge`）。 */
const WITH_KNOWLEDGE_FLAG = "--with-knowledge";

/** 解析命令行参数。 */
async function resolveBookId(argv: readonly string[]): Promise<string> {
  const positional = argv[0];
  if (positional !== undefined && positional.length > 0 && positional !== "--title") {
    return positional;
  }

  const titleIndex = argv.indexOf("--title");
  const title = titleIndex >= 0 ? argv[titleIndex + 1] : undefined;
  if (title === undefined) {
    throw new Error("用法：pnpm analyze <bookId> 或 pnpm analyze --title <作品标题>");
  }

  const db = getDatabase();
  const rows = await db
    .select({ id: books.id })
    .from(books)
    .where(eq(books.title, title))
    .limit(1);
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error(`未找到标题为《${title}》的作品，请先执行 pnpm import:book`);
  }
  return id;
}

/** 入口。 */
async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const withKnowledge = rawArgs.includes(WITH_KNOWLEDGE_FLAG);
  // 标志位不参与 bookId/title 解析，避免污染位置参数。
  const bookId = await resolveBookId(rawArgs.filter((arg) => arg !== WITH_KNOWLEDGE_FLAG));
  console.log(`[analyze] 开始解析作品 ${bookId}`);

  // ⚠️ N20 的教训有两个方向，两个方向都必须处理：
  //   ① `runPipeline` **正常返回**不等于成功 —— 一次全 402 的运行照样会走完
  //      P0→P6 并把该作品的图谱写空。所以「这次到底成没成」必须由运行后的
  //      把关（`_wb_run_guard.mjs`）判定，不能只看这个 CLI 没报错；
  //   ② 反过来，`runPipeline` **抛出**必须变成非 0 退出码 —— 否则 CI 与批量
  //      脚本会把一次被质量闸门拦下的运行当成成功，继续往下跑。
  let result: Awaited<ReturnType<typeof runPipeline>>;
  try {
    result = await runPipeline({ bookId });
  } catch (error) {
    console.error("[analyze] 解析失败，本次未落库（该作品既有图谱保持不变）");
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log("[analyze] 解析完成");
  console.log(`  runId      : ${result.runId}`);
  console.log(`  实体数      : ${result.entityCount}`);
  console.log(`  关系数      : ${result.relationCount}`);
  console.log(`  模型调用    : ${result.cost.callCount} 次`);
  console.log(`  token 输入  : ${result.cost.tokensIn}`);
  console.log(`  token 输出  : ${result.cost.tokensOut}`);
  // 思考 token 单列：它是「成本为何高」的最大单项，不显示就无法验证开关是否生效。
  const reasoning = result.cost.reasoningTokens;
  const outTotal = result.cost.tokensOut;
  const share = outTotal > 0 ? ((reasoning / outTotal) * 100).toFixed(0) : "0";
  console.log(`  其中思考    : ${reasoning} (占输出 ${share}%)`);
  console.log(`  成本        : $${result.cost.usd.toFixed(4)}`);

  if (result.issues.length > 0) {
    console.log("  问题留档：");
    for (const issue of result.issues) {
      console.log(`    ${issue.code} × ${issue.count}`);
    }
  }

  // ── 后置钩子：三期判定层（可选增强，失败不影响解析结果）──
  if (!withKnowledge) return;

  console.log("\n[analyze] --with-knowledge：开始补外部资料（独立表，图谱不改动）");
  try {
    const summary = await runKnowledgeAgent({ bookId, requireProvider: false });
    console.log(formatKnowledgeSummary(summary));
    if (summary.skippedReason !== null) {
      console.log("  提示：配置 SEARCH_API_URL + SEARCH_API_KEY（或 SEARCH_FIXTURE_DIR）后可用");
      console.log("        pnpm knowledge:agent --book <书名> 单独补跑；解析结果不受影响。");
    }
  } catch (error) {
    // 增强步骤的任何异常都不应让「解析成功」变成失败。
    console.error("[analyze] 外部资料补全失败（解析结果已落库，不受影响）：");
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  }
}

await main();
