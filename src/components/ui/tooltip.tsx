"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位：
 * - Tooltip 基础组件封装，属于前端交互提示层。
 * - 依赖 hover/focus 事件与浮层定位，因此必须是 Client Component。
 */

/**
 * TooltipProvider：
 * - 统一控制 tooltip 触发延迟，避免每个 tooltip 单独配置造成体验不一致。
 *
 * @param delayDuration 悬停到显示的延迟毫秒，默认 0（即时反馈）。
 */
function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

/**
 * Tooltip 根组件。
 * - 内部自动包一层 `TooltipProvider`，确保即使单独使用也有一致的延迟策略。
 * - 注意：若页面外层已有统一 Provider，这里嵌套通常仍可工作，但建议保持单一来源以简化维护。
 */
function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

/**
 * Tooltip 触发器。
 * - 常用于图标按钮、缩写文本、禁用操作说明等“轻提示”场景。
 */
function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/**
 * Tooltip 内容层。
 *
 * @param sideOffset 内容与触发器间距，默认 0（由箭头与样式共同控制观感）。
 * @param className 外部样式扩展。
 * @param children 提示文本或轻量结构。
 *
 * 设计原因：
 * - 使用 Portal 避免被父级布局裁剪；
 * - 内置箭头提升提示来源感知，减少用户理解成本。
 */
function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
