import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 不确定性的**接线契约**（与 `node-fill-wiring.test.ts` 同源教训 —— 批 63）：
 *
 * 「纯函数单测全绿」不等于「功能接上了」。`uncertainty.ts` 的检测器再正确，
 * 如果读侧没有调 `computeUncertainty`、页面没有把报告传下去，用户看到的
 * 就永远没有那个计数 —— 而且**没有任何纯函数测试会红**。
 *
 * 本文件把三个接线点钉成显式契约（读源码文本、剥注释后断言「关系」而非「写法」）：
 * 1. 读侧 `read-uncertainty.ts`：必须调 `computeUncertainty`，且词表判定来自
 *    **现行闸门** `judgeEntityName`（溯源矛盾形态）而不是自写后缀表；
 *    **不得**出现 `limitGraphSize`（裁剪后的 snapshot 是切片尺子，批 63 坑⑮）。
 * 2. 页面 `page.tsx`：必须创建 `loadUncertainty` Promise 并把结果传给 GraphView。
 * 3. 视图 `GraphView.tsx`：必须接收 `uncertainty` prop 并消费 `marks.length`。
 */

const ROOT = process.cwd();

function codeOnlyOf(relativePath: string): string {
  const source = readFileSync(path.resolve(ROOT, relativePath), "utf8");
  // ⚠️ 必须剥注释再断言（坑⑮）：注释里的解释性文字会被误判成违规。
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

const readSide = codeOnlyOf("src/server/modules/graph/read-uncertainty.ts");
const page = codeOnlyOf("src/app/(graph)/book/[bookId]/page.tsx");
const view = codeOnlyOf("src/components/graph/GraphView.tsx");

describe("不确定性读侧接线（read-uncertainty.ts）", () => {
  it("检测结果由 computeUncertainty 算出（纯函数层是真正的决策点）", () => {
    expect(readSide).toContain("computeUncertainty");
  });

  it("词形/词表判定复用现行闸门与 name-form，不自造规则（修正案 4 溯源矛盾）", () => {
    expect(readSide).toContain("judgeEntityName");
    expect(readSide).toContain("isHonorificForm");
    expect(readSide).toContain("isProperNameForm");
    // 防御：③ 号检测器的词形方案 PLACE_SUFFIX 已被证伪，不得以任何形式回魂。
    expect(readSide).not.toContain("PLACE_SUFFIX");
  });

  it("输入是全库口径，不得复用裁剪后的渲染子集", () => {
    expect(readSide).not.toContain("limitGraphSize");
    expect(readSide).not.toContain("loadGraphSnapshot");
  });
});

describe("不确定性页面接线（page.tsx）", () => {
  it("创建 loadUncertainty Promise 并与 snapshot 并列下发", () => {
    expect(page).toContain("loadUncertainty(bookId)");
    expect(page).toContain("loadGraphSnapshot(bookId)");
  });

  it("不确定性报告传给 GraphView（不合并进 snapshot）", () => {
    expect(page).toContain("uncertainty={uncertainty}");
    expect(page).not.toMatch(/snapshot\s*=\s*\{[^}]*uncertainty/u);
  });
});

describe("不确定性视图接线（GraphView.tsx）", () => {
  it("接收 uncertainty prop 并消费标记计数", () => {
    expect(view).toContain("uncertainty");
    expect(view).toContain("uncertainty.marks.length");
  });

  it("分类标签来自单一来源 UNCERTAINTY_KIND_LABELS（不在 UI 里另写一份）", () => {
    expect(view).toContain("UNCERTAINTY_KIND_LABELS");
  });
});
