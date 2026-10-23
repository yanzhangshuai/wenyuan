// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 执行器与知识层的**接线契约**。
 *
 * 为什么用源码文本断言而不是行为测试：
 * 真正要钉住的是「子进程到底带没带 `--with-knowledge`」这一行 —— 它决定了一次导入
 * 会不会额外花检索与判定的钱。行为测试要真起子进程（分钟级、花钱），
 * 而这一行被删掉时纯函数测试全绿、页面也看不出来。
 *
 * 断言前先剥注释：本文件的注释里就出现了 `--with-knowledge` 字样，
 * 不剥会把「解释」当成「实现」（项目既有教训）。
 */
const ROOT = process.cwd();

function codeOnlyOf(relativePath: string): string {
  const source = readFileSync(path.resolve(ROOT, relativePath), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

const runner = codeOnlyOf("src/server/modules/analysis/runner.ts");

describe("解析子进程参数", () => {
  it("解析脚本以子进程方式启动（不是进程内 await）", () => {
    expect(runner).toContain("spawn(");
    expect(runner).toContain("scripts/analyze.ts");
    expect(runner).toContain("--conditions=react-server");
  });

  it("带 --with-knowledge：导入即解析后顺带跑三期判定层", () => {
    expect(runner).toContain('args.push("--with-knowledge")');
  });

  it("是否带该 flag 由检索源配置决定，而不是恒真", () => {
    // 恒真会让没配检索源的环境每次导入都多一段空转；
    // 恒假则等于功能没接上。两种都必须在源码里看得见判据。
    expect(runner).toContain("resolveSearchProvider(process.env) !== null");
  });
});
