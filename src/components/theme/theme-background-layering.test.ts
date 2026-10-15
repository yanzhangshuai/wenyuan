import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 主题背景层的叠放契约（全站性遮挡事故）。
 *
 * ## 为什么需要这个测试
 *
 * `ClientThemeBackground` 在根布局 `app/layout.tsx` 中挂在 `{children}` **之后**，
 * 是 `<body>` 的最后一个子节点；宿主自身是 `position: fixed` 的**定位元素**，
 * 而各页面主体（`main`、`.graph-stage`）多为**非定位**元素。
 *
 * 按 CSS 绘制顺序（CSS 2.1 附录 E）：非定位内容在 step 3 绘制，
 * 定位元素在 step 6 绘制 —— 因此宿主若为 `z-0` / `auto`，会**整块盖住页面内容**。
 *
 * 星空主题的背景画布自带**不透明**深色渐变底（见 `theme-background.tsx` 的
 * `linear-gradient(to bottom, #000103 ...)`），一旦盖住内容就是
 * 「整页全黑、只剩星点」—— 图谱页与书库页**同时中招**。
 * 其余三主题（丹青/素雅/典藏）的背景是半透明光晕，故此前未暴露。
 *
 * ## 断言的是「关系」而不是「具体数值」
 *
 * 只要求宿主的 `z-index` **为负**（降到所有内容之下），不锁死 `-10`，
 * 避免正常的视觉微调被判红。
 *
 * ⚠️ jsdom 不做布局计算，组件测试（render + click）抓不到这类纯 CSS 遮挡 ——
 * 只有把「叠放关系」当成显式契约钉住才防得住回归。
 */

// ⚠️ 用 `process.cwd()` 而非 `import.meta.url`：本套件跑在 jsdom 环境下，
// `import.meta.url` 不是 `file:` scheme，`fileURLToPath` 会直接抛错。
const THEME_DIR = path.resolve(process.cwd(), "src/components/theme");
const LAYOUT_PATH = path.resolve(process.cwd(), "src/app/layout.tsx");

const hostSrc = readFileSync(path.join(THEME_DIR, "client-theme-background.tsx"), "utf8");
const backgroundSrc = readFileSync(path.join(THEME_DIR, "theme-background.tsx"), "utf8");
const layoutSrc = readFileSync(LAYOUT_PATH, "utf8");

/** 取出宿主 `className` 的字面值；找不到时返回空串。 */
const hostClassName =
  /className="(theme-background-host[^"]*)"/u.exec(hostSrc)?.[1] ?? "";

describe("主题背景宿主：必须位于所有内容之下", () => {
  it("宿主类名可被解析（改名/删除会导致契约失效）", () => {
    expect(hostClassName).not.toBe("");
  });

  it("宿主带负 z-index（承重件：降到 step 2，根背景之上、所有内容之下）", () => {
    expect(hostClassName).toMatch(/(?:^|\s)-z-\d+(?:\s|$)/u);
  });

  it("宿主不得回退为 `z-0`（反例守卫：正是事故发生时的写法）", () => {
    expect(hostClassName).not.toMatch(/(?:^|\s)z-0(?:\s|$)/u);
  });

  it("宿主仍是 fixed 全视口（负 z-index 不能靠缩小覆盖面来换）", () => {
    expect(hostClassName).toMatch(/(?:^|\s)fixed(?:\s|$)/u);
    expect(hostClassName).toMatch(/(?:^|\s)inset-0(?:\s|$)/u);
  });
});

describe("星空画布不透明底：宿主层级为何是承重件", () => {
  it("星空背景画布存在且自带内联背景", () => {
    expect(backgroundSrc).toMatch(/theme-background-canvas/u);
    expect(backgroundSrc).toMatch(/background:\s*"linear-gradient\(/u);
  });

  it("其余三主题的背景层走半透明装饰（因此此前未暴露该缺陷）", () => {
    // 三个 `theme-background-layer-*` 各自带 `opacity-[0.0x]` 的装饰元素；
    // 这里只钉住「层名存在」，避免有人把星空也改成纯 CSS 而漏掉层级问题。
    for (const theme of ["danqing", "suya", "diancang"]) {
      expect(backgroundSrc).toMatch(new RegExp(`theme-background-layer-${theme}`, "u"));
    }
  });
});

describe("根布局的挂载顺序：背景层在 children 之后", () => {
  it("`<ClientThemeBackground />` 出现在 `{children}` 之后（顺序是层级判断的前提）", () => {
    const childrenIndex = layoutSrc.indexOf("{children}");
    const backgroundIndex = layoutSrc.indexOf("<ClientThemeBackground />");
    expect(childrenIndex).toBeGreaterThan(-1);
    expect(backgroundIndex).toBeGreaterThan(-1);
    // 🔑 因为排在 children 之后，宿主才需要负 z-index 才不会盖住内容。
    expect(backgroundIndex).toBeGreaterThan(childrenIndex);
  });
});
