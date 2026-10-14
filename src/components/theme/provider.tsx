"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

/**
 * 文件定位（主题系统 Provider 封装）：
 * - 文件路径：`src/components/theme/provider.tsx`
 * - 所属层次：前端渲染层（全局主题能力接入点）。
 *
 * 核心职责：
 * 1) 作为项目内统一的主题上下文入口，对 `next-themes` 进行轻量封装；
 * 2) 让上层布局（通常是 `app/layout.tsx`）以统一方式注入主题能力；
 * 3) 降低业务组件对第三方库 API 的直接耦合，便于后续替换实现或集中调整参数。
 *
 * Next.js / React 语义说明：
 * - 本文件声明 `"use client"`，这是业务必需而非技术偶然：
 *   `next-themes` 依赖浏览器环境（如 `window`、`localStorage`、`matchMedia`）读取/持久化主题偏好，
 *   因此必须在客户端组件中运行，不能放在 Server Component 中直接执行。
 * - 该 Provider 一般位于应用较高层级，用于给整棵子树提供主题上下文，驱动主题切换与样式响应。
 *
 * 上下游关系：
 * - 上游输入：布局层传入的 `ThemeProviderProps`（例如属性选择器、默认主题、系统主题开关等）以及 `children`；
 * - 下游输出：通过 React Context 将主题状态与切换能力提供给后续主题相关组件/Hook。
 *
 * 维护注意：
 * - 该封装当前是“透明透传”策略（props 不改写），这是为了保持与 `next-themes` 行为一致；
 * - 若未来要增加项目默认配置（如默认主题），应评估对 SSR/CSR 首屏一致性的影响，避免 hydration 闪烁。
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  /**
   * 业务语义：
   * - `children`：需要共享主题能力的整段 UI 子树；
   * - `...props`：由上层按业务场景传入的主题策略，保持原样转交底层 Provider。
   *
   * 设计原因：
   * - 保持“薄封装”可以确保行为可预测：项目层不在这里偷偷改默认值，
   *   从而减少“为什么主题行为和官方文档不一致”的排查成本。
   */
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
