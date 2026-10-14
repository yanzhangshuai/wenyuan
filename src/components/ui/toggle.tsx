"use client";

import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位：
 * - 前端基础 Toggle（开关按钮）封装，属于可复用交互组件层。
 * - 作为 Client Component 运行在浏览器，响应点击后 `data-state` 会驱动样式变化。
 *
 * 设计目标：
 * - 通过 `cva` 把变体（variant/size）配置集中管理，避免业务页面散落重复 class。
 */
const toggleVariants = cva(
  "ui-toggle inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none transition-[color,box-shadow] aria-invalid:ring-destructive/20 aria-invalid:border-destructive whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground"
      },
      size: {
        default: "h-9 px-2 min-w-9",
        sm     : "h-8 px-1.5 min-w-8",
        lg     : "h-10 px-2.5 min-w-10"
      }
    },
    defaultVariants: {
      // 默认视觉策略：普通背景 + 标准尺寸，兼顾多数表单/工具栏场景。
      variant: "default",
      size   : "default"
    }
  }
);

export interface ToggleProps
  extends React.ComponentProps<typeof TogglePrimitive.Root>,
    VariantProps<typeof toggleVariants> {}

/**
 * Toggle 主组件。
 *
 * @param className 外部样式扩展。
 * @param variant 视觉变体（默认/描边）。
 * @param size 尺寸变体（sm/default/lg）。
 * @param props Radix Toggle 原生参数（pressed/defaultPressed/onPressedChange 等）。
 *
 * 返回语义：
 * - 渲染一个可切换“开/关”状态的按钮节点。
 * - 状态变化由 Radix 管理并通过 `data-state` 暴露给样式系统。
 */
function Toggle({
  className,
  variant,
  size,
  ...props
}: ToggleProps) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      data-variant={variant ?? "default"}
      data-size={size ?? "default"}
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
