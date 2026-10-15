import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 节点填充的**接线契约**（`ForceGraphCanvas.tsx`）。
 *
 * ## 为什么单靠「纯函数单测」不够
 *
 * `node-fill.ts` 的单测证明了「主导分组算得对」，`node-paint.ts` 的单测证明了
 * 「球画得像」。但**把两者接到画布上**的那一行，此前**没有任何测试覆盖**：
 *
 * 变异实验（把那一行改回硬编码兜底色 `getEdgeColorForCategory(nodeColors, 4)`）
 * 结果是 **SURVIVED** —— `tsc` 干净、772 条测试全绿，而画布上所有节点
 * **又变回同一种颜色**。这正是用户最初报的那个 bug。
 *
 * jsdom 不做 canvas 绘制（`getContext("2d")` 返回 null），所以「渲染后断言颜色」
 * 这条路走不通。可行的做法是**把接线本身当成显式契约**：读源码文本，
 * 断言「节点填充确实由 `resolveNodeColorIndex(dominantCategory, ...)` 决定」。
 *
 * ## 断言的是「关系」而不是「写法」
 *
 * 只要求这一行里**同时出现** `resolveNodeColorIndex`、`dominantCategory`、`nodeColors`，
 * 不锁死变量名之外的任何格式，正常重构（换行、加括号、提取局部变量）不会判红；
 * 但**把决策退回常量**必然判红。
 */

// ⚠️ 与 `graph-stage-layout.test.ts` 同因：jsdom 下 `import.meta.url` 不是 `file:`，
// 用 `process.cwd()`（vitest 的 cwd 恒为项目根）。
const CANVAS_PATH = path.resolve(process.cwd(), "src/components/graph/ForceGraphCanvas.tsx");
const source = readFileSync(CANVAS_PATH, "utf8");

/**
 * 去掉注释后的源码。
 *
 * ⚠️ 必须剥注释再断言：本文件里**恰好有两处注释**在解释「不再使用 `factionIndex`」，
 * 直接对全文做 `not.toMatch(/factionIndex/)` 会被这两句正确的注释判红 ——
 * 那是「把解释当违规」，尺子量错了对象。
 */
const codeOnly = source
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/(^|[^:])\/\/[^\n]*/gu, "$1");

/** 取节点填充赋值语句（`const fill = ...;`）。 */
function nodeFillStatement(): string {
  // 在**剥掉注释**的源码上取，避免注释里的分号把语句截断。
  const match = /const fill =[^;]*;/u.exec(codeOnly);
  if (match === null) {
    throw new Error("ForceGraphCanvas 中找不到 `const fill = ...;` 语句");
  }
  return match[0];
}

describe("ForceGraphCanvas 节点填充接线", () => {
  it("填充色由「主导关系分组」决定，而不是硬编码常量", () => {
    const statement = nodeFillStatement();
    expect(statement).toContain("resolveNodeColorIndex");
    expect(statement).toContain("dominantCategory");
    // 防御：不得退回「固定索引」这种把所有人涂成同色的写法。
    expect(statement).not.toMatch(/,\s*\d+\s*\)/u);
  });

  it("使用主题的节点色盘（nodeColors），而不是边色盘", () => {
    const statement = nodeFillStatement();
    expect(statement).toContain("nodeColors");
    expect(statement).not.toContain("edgeColors");
  });

  it("主导分组的查找表由当前边集算出（不依赖恒为 null 的 factionIndex）", () => {
    expect(source).toContain("computeDominantCategoryByNode(edges)");
    // 回归护栏：`factionIndex` 在落库时恒为 null，谁再拿它取色谁就重现本 bug。
    // 只看代码、不看注释（注释里有两句正是在解释「为何弃用」）。
    expect(codeOnly).not.toMatch(/factionIndex/u);
  });

  it("节点色盘的依赖已进 useMemo/useCallback 依赖数组（否则切主题不重绘）", () => {
    // 截取 `paintNode` 的依赖数组：从 `],\n  )` 前最后一段 `[` 开始。
    const dependencyBlock = /\[\s*\n\s*dominantCategory[\s\S]*?\n\s*\]/u.exec(source);
    expect(dependencyBlock).not.toBeNull();
    const block = dependencyBlock?.[0] ?? "";
    expect(block).toContain("nodeColors");
    expect(block).toContain("dominantCategory");
  });

  it("立体球绘制真的被调用（不得退化成纯色圆 —— 那正是「贴片感」）", () => {
    // 变异实验：把 `paintSphereNode(...)` 换成 `ctx.arc + ctx.fill`，
    // 3D 效果全丢，而 776 条测试全绿 —— 说明此前没有一条断言盯着这个调用点。
    expect(codeOnly).toContain("paintSphereNode(ctx,");
    // 调用点必须把「球体的三色信息」都传进去（缺一色就画不出体积）。
    const call = /paintSphereNode\(ctx,\s*\{[\s\S]*?\}\)/u.exec(codeOnly);
    expect(call).not.toBeNull();
    const args = call?.[0] ?? "";
    expect(args).toContain("fill");
    expect(args).toContain("foreground");
    expect(args).toContain("background");
    expect(args).toContain("radius");
  });
});
