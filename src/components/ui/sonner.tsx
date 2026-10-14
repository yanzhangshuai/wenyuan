"use client";

import { toast, Toaster as Sonner, type ToasterProps } from "sonner";

import { useHydratedTheme } from "@/hooks/use-hydrated-theme";
import type { ThemeId } from "@/theme";

/**
 * 文件定位（Next.js）：
 * - 该文件是通知系统（Toast）在前端渲染层的主题适配器，属于 Client Component。
 * - 不负责业务逻辑本身，只负责把项目主题系统映射到 `sonner` 组件库的 `theme` 语义。
 *
 * 上下游关系：
 * - 上游：`useHydratedTheme` 提供当前已水合主题。
 * - 下游：页面/组件引用本文件导出的 `Toaster`，即可获得全局通知 UI 与主题一致性。
 */

/**
 * 业务规则：
 * - 当前仅 `suya` 被定义为亮色主题集，其余主题统一按暗色处理。
 * - 这是产品视觉规范，不是 sonner 的技术限制。
 */
const LIGHT_THEME_SET = new Set<ThemeId>(["suya"]);

/**
 * 将项目内部主题 ID 映射为 sonner 所需主题值。
 *
 * @param theme 当前主题 ID；在 hydration 前可能为 `null`。
 * @returns `sonner` 可识别的主题枚举（`light` / `dark`）。
 *
 * 分支原因：
 * - `!theme` 时回退 `dark`，目的是在首帧（尚未拿到真实主题）避免亮暗反复切换造成闪烁。
 * - 命中亮色集合才返回 `light`，其余保持 `dark`，确保主题策略可控且可扩展。
 */
function mapToSonnerTheme(theme: ThemeId | null): ToasterProps["theme"] {
  if (!theme) return "dark";
  return LIGHT_THEME_SET.has(theme) ? "light" : "dark";
}

/**
 * 项目通知容器组件。
 *
 * 组件职责：
 * - 读取当前“已水合”的主题状态，避免 SSR/CSR 主题不一致导致的样式抖动。
 * - 向 sonner 注入统一样式变量，确保通知颜色与设计系统变量同步。
 *
 * @param props 透传给 `sonner` 的原生参数（如位置、富交互配置等）。
 * @returns 可直接挂在应用根部的 Toaster 组件。
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { selectedTheme } = useHydratedTheme();

  return (
    <Sonner
      theme={mapToSonnerTheme(selectedTheme)}
      className="toaster group"
      style={
        {
          // 使用 CSS 变量而非硬编码色值，确保不同主题下通知外观与全局系统一致。
          "--normal-bg"    : "var(--popover)",
          "--normal-text"  : "var(--popover-foreground)",
          "--normal-border": "var(--border)"
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { toast, Toaster };
