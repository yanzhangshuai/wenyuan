import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 种子脚本的环境加载契约。
 *
 * 🚨 为什么需要这条测试：`getServerEnv()` 是**惰性**的（首次连库才 `loadEnvFile`），
 * 而种子脚本在连库**之前**就要读 `ADMIN_EMAIL` / `ADMIN_PASSWORD`。
 * 若忘记 `ensureEnvLoaded()`，把管理员凭据写进 `.env` 会读不到，
 * 命令却报「未设置 ADMIN_EMAIL」——这是批 92 已在知识增强 Agent 上踩过的同一个坑。
 */

const ROOT = process.cwd();

function codeOnlyOf(relativePath: string): string {
  const source = readFileSync(path.resolve(ROOT, relativePath), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

describe("种子脚本先加载 .env 再读配置", () => {
  for (const file of ["scripts/seed.ts", "scripts/seed-admin.ts"]) {
    it(`${file} 在读取配置前调用 ensureEnvLoaded()`, () => {
      const code = codeOnlyOf(file);
      const loadIndex = code.indexOf("ensureEnvLoaded()");
      expect(loadIndex).toBeGreaterThan(-1);

      // 加载必须发生在「读 ADMIN_*」之前：以 resolveSeedPlan / parseArgs 作为分界。
      const readIndex = Math.max(
        code.indexOf("resolveSeedPlan("),
        code.indexOf("parseArgs(process.argv")
      );
      expect(readIndex).toBeGreaterThan(-1);
      expect(loadIndex).toBeLessThan(readIndex);
    });
  }
});
