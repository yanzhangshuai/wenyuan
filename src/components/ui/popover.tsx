"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位：
 * - Popover（气泡层）基础组件封装，属于前端交互层。
 * - 该组件依赖浏览器事件与定位计算，因此必须是 Client Component。
 *
 * 协作关系：
 * - 上游业务组件提供触发节点与内容。
 * - 下游由 Radix 管理可访问性、焦点与弹层生命周期。
 */

/**
 * Popover 根容器，负责建立触发器与内容层的状态关联。
 */
function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

/**
 * Popover 触发器。
 * - 业务常见场景：点击按钮展开筛选面板、说明浮层、快捷菜单等。
 */
function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

/**
 * Popover 内容层。
 *
 * @param className 外部样式扩展。
 * @param align 对齐方式，默认 center 让浮层中心与触发器中心对齐。
 * @param sideOffset 偏移距离，默认 4 让浮层与触发器留出呼吸感。
 *
 * 设计原因：
 * - 使用 Portal 提升层级，避免父容器 `overflow: hidden` 裁剪弹层。
 * - 提供默认动画/尺寸类，保证跨业务模块外观一致。
 */
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/**
 * Popover 锚点组件。
 * - 用于高级定位场景：触发器与实际定位参照点分离时，可显式指定 anchor。
 */
function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
