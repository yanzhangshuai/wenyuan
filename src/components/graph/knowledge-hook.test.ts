import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `analyze --with-knowledge` 后置钩子的**接线契约**。
 *
 * 三件事必须在源码里成立，否则「一条命令跑完整个流程」就是假的：
 * 1. 钩子存在且被解析器读取（`--with-knowledge`）；
 * 2. 钩子调用**同一份**判定层实现（`runKnowledgeAgent`），且 `requireProvider: false`
 *    —— 未配置检索源时只提示、不报错（解析本身已成功）；
 * 3. 钩子被 try/catch 包住 —— 增强步骤失败不得改变解析的成功语义。
 */

const ROOT = process.cwd();

function codeOnly(relativePath: string): string {
  const source = readFileSync(path.resolve(ROOT, relativePath), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

const analyze = codeOnly("scripts/analyze.ts");
const pkg = JSON.parse(readFileSync(path.resolve(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("analyze --with-knowledge 钩子", () => {
  it("解析器识别该标志并把它从位置参数里剔除", () => {
    expect(analyze).toContain('"--with-knowledge"');
    expect(analyze).toContain("rawArgs.filter");
  });

  it("调用同一份判定层实现，且不因缺检索源而报错", () => {
    expect(analyze).toContain("runKnowledgeAgent");
    expect(analyze).toContain("requireProvider: false");
  });

  it("增强步骤失败不影响解析成功语义（try/catch 包裹）", () => {
    const callIndex = analyze.indexOf("runKnowledgeAgent({");
    expect(callIndex).toBeGreaterThan(0);
    const before = analyze.slice(Math.max(0, callIndex - 200), callIndex);
    expect(before).toContain("try");
    const after = analyze.slice(callIndex, callIndex + 400);
    expect(after).toContain("catch");
  });

  it("package.json 提供独立 CLI 入口", () => {
    expect(pkg.scripts["knowledge:agent"]).toContain("scripts/knowledge-agent.ts");
  });
});
