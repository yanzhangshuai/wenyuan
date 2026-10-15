import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 图谱页浮层叠放契约（`globals.css`）。
 *
 * ## 为什么需要这个测试
 *
 * 视图切换条（`.graph-stage-modes`）与矩阵详情抽屉（`.graph-stage-drawer`）
 * **共用同一个锚点**（`right: 1rem; top: 1rem`）。若抽屉的 `z-index` 高于
 * 切换条、且起始位置也更高，抽屉就会**整块盖住**切换条 ——
 * 用户一旦进入矩阵视图，就**看不到也点不到**「全图/聚焦/矩阵」按钮，
 * 表现为「进得去、出不来」。
 *
 * 这是**纯 CSS 层级问题**：jsdom 不做布局计算，组件测试（render + click）
 * 抓不到它 —— 只有把「叠放关系」当成显式契约钉住才防得住回归。
 *
 * ## 断言的是「关系」而不是「具体数值」
 *
 * 只要求「切换条的 z-index 严格大于抽屉」＋「抽屉起点在切换条下方」，
 * 不锁死 30 / 3.5rem，避免正常的视觉微调被判红。
 */

// ⚠️ 用 `process.cwd()` 而非 `import.meta.url`：本套件跑在 jsdom 环境下，
// `import.meta.url` 不是 `file:` scheme，`fileURLToPath` 会直接抛错。
// vitest 的 cwd 恒为项目根（`vitest.config.ts` 所在目录）。
const CSS_PATH = path.resolve(process.cwd(), "src/app/globals.css");
const css = readFileSync(CSS_PATH, "utf8");

/** 抽出某个选择器规则块的正文；找不到时返回 null。 */
function ruleBody(selector: string): string | null {
  // 匹配 `<selector> {` 到其后第一个 `}`（这些规则块内没有嵌套块）。
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*\\{([^}]*)\\}`, "u");
  const match = pattern.exec(css);
  return match === null ? null : (match[1] ?? "");
}

/** 从规则块里取某个属性的数值（`px` / 无单位数）。 */
function numericProp(body: string, prop: string): number | null {
  const pattern = new RegExp(`${prop}\\s*:\\s*(-?[\\d.]+)`, "u");
  const match = pattern.exec(body);
  return match === null ? null : Number.parseFloat(match[1] ?? "");
}

describe("图谱页浮层叠放契约", () => {
  const modesBody = ruleBody(".graph-stage-modes");
  const drawerBody = ruleBody(".graph-stage-drawer");

  it("两个浮层的规则块都存在（改名/删除会导致契约失效）", () => {
    expect(modesBody).not.toBeNull();
    expect(drawerBody).not.toBeNull();
  });

  it("视图切换条的 z-index 严格高于矩阵详情抽屉", () => {
    const modesZ = numericProp(modesBody ?? "", "z-index");
    const drawerZ = numericProp(drawerBody ?? "", "z-index");
    expect(modesZ).not.toBeNull();
    expect(drawerZ).not.toBeNull();
    // 🔑 核心断言：抽屉不得盖住切换条，否则用户「进得去、出不来」。
    expect(modesZ ?? 0).toBeGreaterThan(drawerZ ?? 0);
  });

  it("矩阵详情抽屉的 top 起始位置在视图切换条下方", () => {
    const drawerTop = numericProp(drawerBody ?? "", "top");
    // 切换条本身只有 1rem 的 top，抽屉必须再往下让出一整条的高度。
    expect(drawerTop).not.toBeNull();
    expect(drawerTop ?? 0).toBeGreaterThanOrEqual(3);
  });
});

/**
 * 第二批契约：底部时间轴加入后，**左下图例**与它同处一条竖边。
 *
 * 时间轴的 `z-index` 高于图例，且贴着画布底边铺满整宽 ——
 * 若图例的 `bottom` 不让开它的高度，图例最后几行会被**永久遮住**
 * （与矩阵抽屉盖住切换条是同一类「纯 CSS 遮挡」事故）。
 */
describe("底部时间轴与左下图例的叠放契约", () => {
  const legendBody = ruleBody(".graph-stage-legend");
  const timelineBody = ruleBody(".graph-stage-timeline");

  it("两个浮层的规则块都存在", () => {
    expect(legendBody).not.toBeNull();
    expect(timelineBody).not.toBeNull();
  });

  it("图例的 bottom 让开了时间轴的高度（不重叠）", () => {
    const legendBottom = numericProp(legendBody ?? "", "bottom");
    const timelineZ = numericProp(timelineBody ?? "", "z-index");
    const legendZ = numericProp(legendBody ?? "", "z-index");
    expect(legendBottom).not.toBeNull();
    // 时间轴层级更高 ⇒ 必须靠位置避让，不能指望层级。
    expect(timelineZ ?? 0).toBeGreaterThan(legendZ ?? 0);
    // 时间轴总高约 3.25rem，图例至少要让出 4rem 才不压线。
    expect(legendBottom ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("图例是竖排一列（对齐 v1 graph-legend），而不是横排换行", () => {
    // 🔑 用户明确要求「图例排成一竖列（像 v1）」——
    // 若这里被改回 `row`/`wrap`，须有人显式看见并确认。
    expect(legendBody ?? "").toMatch(/flex-direction\s*:\s*column/u);
  });

  it("图例有最大高度与滚动，长列表不会顶穿画布", () => {
    expect(legendBody ?? "").toMatch(/max-height\s*:/u);
    expect(legendBody ?? "").toMatch(/overflow-y\s*:\s*auto/u);
  });
});

/**
 * 第三批契约：左上「工具栏」（v1 `graph-toolbar` 的 1:1 复刻）。
 *
 * ## 为什么单独钉住工具栏
 *
 * v3 此前把「搜索」与「视图切换」做成两个常驻浮层，观感与 v1 差得很远。
 * 现在搜索并入工具栏面板、左上只剩工具栏一列图标 ——
 * 一旦有人把它改回宽浮层，或把面板的毛玻璃/圆角/投影改掉，
 * 与 v1 的 1:1 就破了，且**不会**被功能测试抓到（纯视觉）。
 *
 * ## 同时守住「提示条不再被左侧浮层挤压」
 *
 * 左上浮层从 20rem 搜索框变成约 2.75rem 工具栏后，顶部提示条
 * 不再需要偏右让位；若被改回 `calc(50% + ...)`，说明有人误解了布局前提。
 */
describe("左上工具栏与顶部提示条的契约", () => {
  const toolbarBody = ruleBody(".graph-toolbar");
  const toolbarIconsBody = ruleBody(".graph-toolbar-icons");
  const toolbarBtnBody = ruleBody(".graph-toolbar-btn");
  const toolbarPanelBody = ruleBody(".graph-toolbar-panel");
  const noticeBody = ruleBody(".graph-stage-notice");

  it("工具栏及其关键规则块都存在（改名/删除会导致契约失效）", () => {
    expect(toolbarBody).not.toBeNull();
    expect(toolbarIconsBody).not.toBeNull();
    expect(toolbarBtnBody).not.toBeNull();
    expect(toolbarPanelBody).not.toBeNull();
  });

  it("工具栏贴在画布左上角，且不与时间轴同层（z-index 有值）", () => {
    expect(toolbarBody ?? "").toMatch(/position\s*:\s*absolute/u);
    expect(toolbarBody ?? "").toMatch(/left\s*:\s*1rem/u);
    expect(toolbarBody ?? "").toMatch(/top\s*:\s*1rem/u);
    expect(numericProp(toolbarBody ?? "", "z-index")).not.toBeNull();
  });

  it("图标列用 v1 的面板语言：圆角 + 60% 边 + 卡片底 + 模糊 + 投影", () => {
    // v1：`rounded-lg border-border/60 bg-card/80 backdrop-blur-md shadow-lg`
    expect(toolbarIconsBody ?? "").toMatch(/border-radius\s*:\s*0\.5rem/u);
    expect(toolbarIconsBody ?? "").toMatch(/border\s*:\s*1px solid color-mix\(in oklch/u);
    expect(toolbarIconsBody ?? "").toMatch(/backdrop-filter\s*:\s*blur/u);
    expect(toolbarIconsBody ?? "").toMatch(/box-shadow\s*:/u);
    expect(toolbarIconsBody ?? "").toMatch(/background-color\s*:\s*color-mix\(in oklch/u);
  });

  it("工具按钮用 accent 做 hover / 激活色（v1 `hover:bg-accent`）", () => {
    expect(css).toMatch(/\.graph-toolbar-btn:hover\s*\{[^}]*background-color\s*:\s*var\(--color-accent\)/u);
    expect(css).toMatch(
      /\.graph-toolbar-btn\[data-active="true"\]\s*\{[^}]*background-color\s*:\s*var\(--color-accent\)/u
    );
  });

  it("展开面板是 16rem（v1 `w-64`）并带投影", () => {
    expect(numericProp(toolbarPanelBody ?? "", "width")).toBe(16);
    expect(toolbarPanelBody ?? "").toMatch(/box-shadow\s*:/u);
  });

  it("顶部提示条回归真居中（左上已不再是 20rem 搜索框）", () => {
    expect(noticeBody ?? "").toMatch(/left\s*:\s*50%/u);
    // 反例守卫：不得再出现「为让开搜索框」的偏右写法。
    expect(noticeBody ?? "").not.toMatch(/left\s*:\s*calc\(50%\s*\+/u);
  });

  it("提示条在窄视口会被隐藏（不叠字）", () => {
    // 媒体查询块里必须出现 `.graph-stage-notice` 且 `display: none`。
    expect(css).toMatch(
      /@media[^{]*max-width[^{]*\{[^}]*\.graph-stage-notice\s*\{[^}]*display\s*:\s*none/u
    );
  });
});
