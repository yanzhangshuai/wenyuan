"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位（开关组件）：
 * - 文件路径：`src/components/ui/switch.tsx`
 * - 所属层次：前端基础表单组件层（客户端组件）。
 *
 * 核心职责：
 * - 封装布尔型输入交互（开/关）；
 * - 统一聚焦态、禁用态、深浅色主题表现。
 *
 * React/Radix 语义：
 * - 由 `data-[state=checked|unchecked]` 驱动样式切换；
 * - 透传 props，允许下游以受控/非受控方式使用。
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        // 位移规则体现状态变化：checked 时滑块移动到右侧终点。
        className={
          "bg-background pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        }
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
