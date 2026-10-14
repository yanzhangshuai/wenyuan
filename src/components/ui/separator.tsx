"use client";

import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位（分隔线组件）：
 * - 文件路径：`src/components/ui/separator.tsx`
 * - 所属层次：前端基础布局组件层（客户端组件）。
 *
 * 业务职责：
 * - 在信息块之间提供视觉分隔；
 * - 支持横向/纵向两种方向，满足列表与面板布局场景。
 *
 * 参数业务语义：
 * - `orientation`：分隔线方向，默认横向；
 * - `decorative`：是否仅装饰用途。默认 `true`，表示不被读屏器当作语义内容读取。
 */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className
      )}
      {...props}
    />
  );
}

export { Separator };
