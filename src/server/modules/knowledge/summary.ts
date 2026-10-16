import type { KnowledgeRunSummary } from "./run-agent";

/**
 * 判定层运行汇总的格式化（**纯函数**，独立于 `run-agent.ts` 的 `server-only`）。
 *
 * 为什么单独一个文件：汇总文案有两个消费方（独立 CLI 与 `analyze --with-knowledge` 钩子），
 * 且必须可单测 —— 与「IO / 纯逻辑分层」同一条纪律。
 */
export function formatKnowledgeSummary(summary: KnowledgeRunSummary): string {
  if (summary.skippedReason !== null) {
    return `[knowledge-agent] 已跳过：${summary.skippedReason}`;
  }
  const books = summary.bookTitles.length > 0 ? summary.bookTitles.join("、") : "(无作品)";
  return (
    `[knowledge-agent] ${books}：触发 ${String(summary.targets)} · 模型调用 ${String(summary.calls)} 次 · ` +
    `成本 $${summary.costUsd.toFixed(4)} · resolved ${String(summary.resolved)} / ` +
    `disputed ${String(summary.disputed)} / unresolvable ${String(summary.unresolvable)} · ` +
    `未检索跳过 ${String(summary.skippedSearch)} · 落库 ${String(summary.written)} 条（图谱未改动）`
  );
}
