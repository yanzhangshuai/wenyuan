import { type ReactNode } from "react";

/**
 * 图谱路由组布局（Route Group `(graph)`）。
 *
 * 设计意图（对齐 v1 `wen-yuan` 的 `(graph)` 路由组）：
 * - 图谱页是**沉浸式全屏**体验，页内自带 `graph-stage-header`（书名 / 规模 / 返回书库）；
 * - 若继续挂在 `(viewer)` 下，就会出现「全局顶栏 ＋ 图谱信息头」**两层 title**，
 *   既挤压图谱高度，也与 v1 版式不一致。
 * - 路由组名不参与 URL，因此 `/book/:id` 路径保持不变。
 *
 * 约束：
 * - Server Component，不要加 `"use client"`；
 * - 这里只做「占满视口」的容器，不引入任何导航栏。
 */
export default function GraphLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {children}
    </div>
  );
}
