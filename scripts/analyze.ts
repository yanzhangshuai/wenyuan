import { eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { books } from "@/server/db/schema";
import { runPipeline } from "@/server/modules/analysis/pipeline/run";

/**
 * 解析执行脚本。
 *
 * 用法：
 *   pnpm analyze <bookId>
 *   pnpm analyze --title 《儒林外史》
 *
 * 设计原因：把「执行解析」做成独立 CLI 而非 API 路由，
 * 使长耗时任务不受 HTTP 超时约束，且便于在 CI 或本地批量跑评测。
 */

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
  const bookId = await resolveBookId(process.argv.slice(2));
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
}

await main();
