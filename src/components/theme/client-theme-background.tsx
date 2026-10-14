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
 * 约束（重要）：本组件必须是 `<body>` 的直接子节点，且祖先链上不得出现
 * `transform` / `filter` / `perspective` —— 这些属性会成为 `position: fixed`
 * 的包含块，导致背景层脱离视口。根布局 `app/layout.tsx` 已满足该约束。
 */
export function ClientThemeBackground() {
  return (
    <div
      className="theme-background-host pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    >
      <ThemeBackground />
    </div>
  );
}
