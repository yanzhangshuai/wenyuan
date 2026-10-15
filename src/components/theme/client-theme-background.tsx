"use client";

import { ThemeBackground } from "./theme-background";

/**
 * 主题背景挂载壳。
 *
 * 职责：提供一个 `fixed` 宿主容器承载主题背景层，使其脱离页面内容流。
 *
 * 实现说明（相对 v1 的改动）：
 * - v1 用 `createPortal` 把背景挂到 `document.body` 的临时节点上；
 * v3 改为**声明式宿主容器** —— DOM 属性与层级完全一致，但不再需要
 * `useEffect` 内同步 `setState`（那会触发级联渲染，React 官方不推荐）。
 *
 * 层级（关键，勿改回 `z-0`）：
 * - 本组件在 `app/layout.tsx` 中挂在 `{children}` **之后**，是 `<body>` 的**最后**一个子节点；
 * - 宿主是 `position: fixed` 的**定位元素**，而各页面内容（`main`、`.graph-stage` 等）
 *   多为**非定位**元素 → 按 CSS 绘制顺序（附录 E），定位元素在 step 6 绘制，
 *   非定位内容在 step 3 绘制 ⇒ **宿主会盖住整页内容**；
 * - 星空主题的背景画布自带**不透明**深色渐变，一旦盖住内容就是「整页全黑、只剩星点」
 *   （图谱页/书库页均中招；其余三主题背景为半透明，故此前未暴露）。
 * - 故宿主必须用**负 z-index** 降到 step 2（根背景之上、所有内容之下）——
 *   这样背景装饰才真正"在内容之下"，`-z-10` 是承重件，不可回退为 `z-0`。
 *
 * 约束（重要）：本组件必须是 `<body>` 的直接子节点，且祖先链上不得出现
 * `transform` / `filter` / `perspective` —— 这些属性会成为 `position: fixed`
 * 的包含块，导致背景层脱离视口。根布局 `app/layout.tsx` 已满足该约束。
 */
export function ClientThemeBackground() {
  return (
    <div
      className="theme-background-host pointer-events-none fixed inset-0 -z-10"
      aria-hidden="true"
    >
      <ThemeBackground />
    </div>
  );
}
