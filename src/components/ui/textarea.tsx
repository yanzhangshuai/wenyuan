import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位（文本域输入组件）：
 * - 文件路径：`src/components/ui/textarea.tsx`
 * - 所属层次：前端基础表单组件层。
 *
 * 业务职责：
 * - 封装统一文本域样式、聚焦态、错误态与禁用态；
 * - 保持原生 `textarea` 语义，便于表单库与可访问性工具兼容。
 *
 * @param className 调用方追加样式
 * @param props 原生 `textarea` 属性（value/onChange/placeholder 等）
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
