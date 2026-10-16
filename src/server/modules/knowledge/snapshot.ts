import { createHash } from "node:crypto";

import type { SearchHit } from "./types";

/**
 * 抓取内容的快照哈希（**纯函数**，独立于 `repository.ts`）。
 *
 * 为什么单独一个文件：`repository.ts` 带 `server-only`（会阻断 vitest 导入），
 * 而快照哈希是纯计算、必须可单测 —— 与「IO / 纯逻辑分层」同一条纪律。
 */
export function hashSnapshot(hits: readonly SearchHit[]): string {
  const canonical = hits
    .map((hit) => `${hit.url}\n${(hit.content ?? hit.snippet).trim()}`)
    .sort()
    .join("\n---\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
