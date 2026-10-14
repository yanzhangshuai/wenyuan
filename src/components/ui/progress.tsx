"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位（进度条组件）：
 * - 文件路径：`src/components/ui/progress.tsx`
 * - 所属层次：前端基础反馈组件层（客户端组件）。
 *
 * 业务职责：
 * - 展示任务完成度（上传、分析进度、批处理状态等）；
 * - 对 Radix Progress 做统一样式封装。
 *
 * 参数说明：
 * - `value`：完成百分比（通常 0~100），为空时按 0 处理。
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-primary h-full w-full flex-1 transition-all"
        // 通过平移实现进度变化：`value=100` 时平移 0，`value=0` 时平移 -100%。
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
