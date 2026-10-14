"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位（表单标签组件）：
 * - 文件路径：`src/components/ui/label.tsx`
 * - 所属层次：前端基础表单组件层（客户端组件）。
 *
 * 核心职责：
 * - 封装 Radix Label，提供统一文本与禁用态样式；
 * - 通过 `peer-disabled` 与 `group-data-[disabled]` 联动输入控件状态。
 *
 * 设计原因：
 * - 使用 Radix 保留无障碍语义（关联 `htmlFor`、键盘可达性）；
 * - 项目层统一 `data-slot` 便于样式覆盖与自动化测试定位。
 */
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Label };
