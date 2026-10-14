import { cn } from "@/lib/utils";

/**
 * 文件定位（键盘快捷键视觉组件）：
 * - 文件路径：`src/components/ui/kbd.tsx`
 * - 所属层次：前端基础展示组件层。
 *
 * 业务职责：
 * - `Kbd`：渲染单个按键视觉块；
 * - `KbdGroup`：组合多个按键块，表达组合快捷键（如 `Ctrl + K`）。
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "bg-muted w-fit text-muted-foreground pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-sm px-1 font-sans text-xs font-medium select-none",
        "[&_svg:not([class*='size-'])]:size-3",
        "[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background",
        className
      )}
      {...props}
    />
  );
}

/**
 * 快捷键分组容器。
 * 设计原因：统一组合键间距与排列，避免页面内各处手写样式不一致。
 */
function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
