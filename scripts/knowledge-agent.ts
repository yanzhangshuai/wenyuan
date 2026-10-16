import { runKnowledgeAgent } from "@/server/modules/knowledge/run-agent";
import { formatKnowledgeSummary } from "@/server/modules/knowledge/summary";

/**
 * 知识增强 Agent（三期判定层）—— **独立 CLI**。
 *
 * 用法：
 *   pnpm knowledge:agent --book 儒林外史 --dry-run
 *   pnpm knowledge:agent --book 儒林外史 --limit 20
 *   pnpm knowledge:agent --subject 建文皇帝,王熙凤 --force
 *
 * 环境变量（二选一）：
 *   SEARCH_API_URL + SEARCH_API_KEY   → HTTP JSON 检索（Serper/Tavily/Bing API/自建）
 *   SEARCH_FIXTURE_DIR                → 离线快照检索（测试 / 无网环境）
 *
 * 本文件只是**薄壳**：解析参数 → 调 `runKnowledgeAgent` → 打印汇总。
 * 同一份实现在 `scripts/analyze.ts --with-knowledge` 里被复用（流程一体、数据隔离）。
 */

interface CliOptions {
  bookTitle: string | null;
  subjects : string[] | null;
  limit    : number | null;
  dryRun   : boolean;
  force    : boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { bookTitle: null, subjects: null, limit: null, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--book") options.bookTitle = argv[i + 1] ?? null;
    if (arg === "--limit") options.limit = Number(argv[i + 1] ?? "0") || null;
    if (arg === "--dry-run") options.dryRun = true;
    if (arg === "--force") options.force = true;
    if (arg === "--subject") {
      const list = (argv[i + 1] ?? "").split(",").map((name) => name.trim()).filter((name) => name.length > 0);
      options.subjects = list.length > 0 ? list : null;
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await runKnowledgeAgent({
    bookTitle      : options.bookTitle,
    subjects       : options.subjects,
    limit          : options.limit,
    dryRun         : options.dryRun,
    force          : options.force,
    requireProvider: true
  });
  console.log(`\n${formatKnowledgeSummary(summary)}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
