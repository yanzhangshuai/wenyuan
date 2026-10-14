"use client";

import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位：
 * - 滚动区域基础组件封装，属于前端展示与交互基础设施。
 * - 作为 Client Component 运行，因为自定义滚动条与交互反馈依赖浏览器渲染行为。
 */

/**
 * ScrollArea 根组件。
 *
 * @param className 外部样式扩展。
 * @param children 可滚动内容。
 * @param props Radix Root 透传参数。
 *
 * 设计原因：
 * - 默认内置 `ScrollBar` 与 `Corner`，让调用方无需每次手动拼装完整结构。
 */
function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        // 保留 focus-visible ring，确保键盘用户可感知滚动区域焦点。
        className="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

/**
 * ScrollBar 组件。
 *
 * @param orientation 滚动条方向，默认 vertical。
 * @param className 外部样式扩展。
 * @param props Radix Scrollbar 参数。
 *
 * 分支说明：
 * - vertical/horizontal 走不同尺寸与边框样式，确保两种方向的命中区和视觉一致。
 */
function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
