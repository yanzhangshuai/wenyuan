"use client";

import { useHydratedTheme } from "@/hooks/use-hydrated-theme";

import { MuseumGlow } from "./museum-glow";
import { PaperTexture } from "./paper-texture";
import { StarDust } from "./star-dust";
import { SuyaBackground } from "./suya-background";

/**
 * 文件定位（主题装饰分发层）：
 * - 文件路径：`src/components/theme/decorative/decorative-layer.tsx`
 * - 所属层次：前端视觉装饰容器层（客户端组件）。
 *
 * 氛围装饰层 — 按主题自动选择装饰效果
 * danqing:  水墨纹理 + 朱砂光晕
 * suya:     宣纸纹理 + 竹青光晕
 * diancang: 黄铜渐变 + 回纹底纹
 * xingkong: Canvas 星空 + 流星
 *
 * 上下游关系：
 * - 上游：`useHydratedTheme` 提供“是否已完成 hydration”与“当前选中主题”；
 * - 下游：返回具体主题装饰组件，挂载到页面背景层。
 *
 * 分支策略说明：
 * - 未 hydration 或未拿到主题时返回 `null`，避免 SSR/CSR 初始主题不一致产生闪烁；
 * - `switch` 分发保持显式，便于后续新增主题时直观看到缺失分支。
 */
export function DecorativeLayer() {
  const { isHydrated, selectedTheme } = useHydratedTheme();
  if (!isHydrated || !selectedTheme) return null;

  switch (selectedTheme) {
    case "danqing":
      return <PaperTexture />;
    case "suya":
      return <SuyaBackground />;
    case "diancang":
      return <MuseumGlow />;
    case "xingkong":
      return <StarDust />;
    default:
      return null;
  }
}
