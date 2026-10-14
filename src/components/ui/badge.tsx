import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位：
 * - Badge（徽标标签）基础组件，属于前端展示层原子组件。
 * - 不包含业务逻辑，职责是提供统一“状态标签/分类标签”视觉表达。
 */

/**
 * Badge 样式变体定义。
 * - `variant` 对应业务语义（默认、次级、危险、成功、警告等）。
 * - 将视觉语义集中在此，避免业务代码直接拼接大量 class 导致风格漂移。
 */
const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        success:
          "border-transparent bg-success text-white [a&]:hover:bg-success/90",
        warning:
          "border-transparent bg-warning text-white [a&]:hover:bg-warning/90"
      }
    },
    defaultVariants: {
      // 默认标签用于一般信息展示，不强调风险态。
      variant: "default"
    }
  }
);

/**
 * Badge 组件。
 *
 * @param className 业务扩展样式。
 * @param variant 标签语义变体。
 * @param asChild 是否复用子元素作为宿主节点：
 * - `false`：默认渲染 `span`；
 * - `true`：通过 Radix Slot 把样式“借给”子节点（如 `a`、`button`）。
 * @param props 原生 span 属性（或 asChild 时下沉到子节点）。
 *
 * 设计原因：
 * - `asChild` 让 Badge 能兼容更多语义化标签，减少额外包裹层，利于无障碍与 DOM 简洁性。
 */
function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
