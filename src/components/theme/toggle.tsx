"use client";

import { Palette } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { useHydratedTheme } from "@/hooks/use-hydrated-theme";
import { cn } from "@/lib/utils";
import { THEME_OPTIONS } from "@/theme";

/**
 * 文件定位（Client Component / 主题切换入口）：
 * - 用于头部区域的主题切换交互，驱动全站 CSS 变量主题变更。
 * - 依赖 `useHydratedTheme` 与点击事件，因此必须是客户端组件。
 */

export interface ThemeToggleProps {
  /** 触发按钮额外样式类，用于在不同 header 场景定制布局。 */
  triggerClassName?: string;
}

/** 主题色圆点映射：仅用于菜单视觉辅助，不参与真实主题计算。 */
const THEME_COLORS: Record<string, string> = {
  danqing : "bg-[#8b3a3a]",
  suya    : "bg-[#5a8a6c]",
  diancang: "bg-[#c9a227]",
  xingkong: "bg-[#6b8cae]"
};

/** 主题说明文案：帮助用户理解视觉风格差异。 */
const THEME_DESCRIPTIONS: Record<string, string> = {
  danqing : "深色古风，紫檀深褐，朱砂点缀",
  suya    : "暖调浅色，象牙纸底，竹青清雅",
  diancang: "暗色博物馆，深胡桃黑，黄铜金",
  xingkong: "深空暗色，宇宙黑底，银蓝星辉"
};

export function ThemeToggle({ triggerClassName }: ThemeToggleProps) {
  const { theme, setTheme, isHydrated } = useHydratedTheme();

  /**
   * 全屏 Portal 容器修复：
   * 浏览器全屏模式下，只有全屏元素（及其子树）可见。
   * DropdownMenuContent 默认通过 Portal 渲染到 document.body，
   * 会被全屏层遮挡导致下拉框不可见。
   * 监听 fullscreenchange 获取当前全屏元素，作为 Portal 容器，
   * 确保下拉框始终渲染在可见的全屏子树内。
   */
  const [fsContainer, setFsContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    function onFsChange() {
      setFsContainer((document.fullscreenElement as HTMLElement | null) ?? null);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => { document.removeEventListener("fullscreenchange", onFsChange); };
  }, []);

  if (!isHydrated) {
    // Hydration 前先渲染占位，避免服务端主题值与客户端真实值不一致造成闪烁。
    return <div className="h-9 w-9 animate-pulse rounded-md bg-muted/20" />;
  }

  const current = THEME_OPTIONS.find((o) => o.value === theme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("theme-toggle-trigger gap-2", triggerClassName)}
        >
          <Palette className="h-4 w-4" />
          <span className="hidden lg:inline">{current?.label ?? "主题"}</span>
        </Button>
      </DropdownMenuTrigger>
      {/* container={fsContainer} 保证全屏时下拉框渲染在全屏子树内 */}
      <DropdownMenuPortal container={fsContainer ?? undefined}>
        <DropdownMenuContent align="end" className="theme-toggle-menu w-56">
          {THEME_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => { setTheme(opt.value); }}
              data-selected={theme === opt.value ? "true" : "false"}
              className="theme-toggle-option flex cursor-pointer flex-col items-start gap-1 py-3"
            >
              <div className="flex items-center gap-2">
                <span className={cn("w-3 h-3 rounded-full", THEME_COLORS[opt.value] ?? "bg-primary")} />
                <span className="font-medium">{opt.label}</span>
              </div>
              <span className="pl-5 text-xs text-muted-foreground">
                {THEME_DESCRIPTIONS[opt.value] ?? ""}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
