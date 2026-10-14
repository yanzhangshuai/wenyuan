import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位：
 * - Alert（提示框）基础展示组件，属于前端信息反馈层。
 * - 用于显示系统提示、风险提醒、操作结果等“块级提示信息”。
 */

/**
 * Alert 样式变体定义。
 * - `default`：一般信息提示；
 * - `destructive`：风险/错误提示，强调用户注意。
 */
const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "text-destructive bg-card [&>svg]:text-current *:data-[slot=alert-description]:text-destructive/90"
      }
    },
    defaultVariants: {
      // 默认提示类型，避免调用方每次显式声明。
      variant: "default"
    }
  }
);

/**
 * Alert 容器组件。
 *
 * @param variant 提示语义变体（默认/危险）。
 * @param className 外部样式扩展。
 * @param props 原生 div 属性。
 *
 * 无障碍说明：
 * - `role="alert"` 让辅助技术优先播报该内容，适用于需要被用户及时感知的提示信息。
 */
function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

/**
 * Alert 标题区域。
 * - 一般承载结论性信息，如“提交失败”“权限不足”。
 */
function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight",
        className
      )}
      {...props}
    />
  );
}

/**
 * Alert 描述区域。
 * - 展示上下文说明、修复建议、补充细节等。
 */
function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
