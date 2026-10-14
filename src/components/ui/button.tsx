import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位：
 * - 全局 Button 原子组件，属于前端设计系统核心入口。
 * - 业务页面应优先复用该组件，以保证交互状态与视觉规范一致。
 */

/**
 * Button 样式变体定义。
 * - `variant` 描述业务语义（主按钮、危险按钮、幽灵按钮等）。
 * - `size` 描述尺寸语义（普通、小、大、图标按钮）。
 *
 * 维护注意：
 * - 这些变体类名是大量页面共同依赖的契约，随意调整可能引发全站视觉回归。
 */
const buttonVariants = cva(
  "ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default  : "h-9 px-4 py-2 has-[>svg]:px-3",
        sm       : "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg       : "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon     : "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10"
      }
    },
    defaultVariants: {
      // 默认组合满足绝大多数“主操作按钮”场景。
      variant: "default",
      size   : "default"
    }
  }
);

export interface ButtonProps extends React.ComponentProps<"button">,
  VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/**
 * Button 组件。
 *
 * @param className 业务层扩展样式。
 * @param variant 按钮视觉语义。
 * @param size 按钮尺寸语义。
 * @param asChild 是否复用子元素作为真实 DOM 节点（便于语义化标签/路由链接）。
 * @param props 原生 button 属性（type/onClick/disabled 等）。
 *
 * 设计原因：
 * - `asChild` 通过 Slot 去除不必要包裹层，保证按钮样式可复用于 `<a>`、`<Link>` 等组件。
 */
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  // 当 asChild=true 时，样式与行为下沉给子节点；否则使用原生 button。
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "default"}
      data-size={size ?? "default"}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
