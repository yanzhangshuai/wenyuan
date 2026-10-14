import { cn } from "@/lib/utils";

/**
 * 文件定位（骨架屏占位组件）：
 * - 文件路径：`src/components/ui/skeleton.tsx`
 * - 所属层次：前端基础 UI 反馈组件层。
 *
 * 核心职责：
 * - 在数据加载期间提供结构占位，降低页面跳动感；
 * - 使用统一样式类，保证各主题下占位观感一致。
 *
 * @param className 调用方扩展样式
 * @param props 原生 `div` 属性（如 `aria-*`、`style`）
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      /* 使用 bg-muted 而非 bg-accent，避免在丹青/典藏等主题下
         accent 颜色为强饱和主题色导致骨架屏大面积红色/金色问题 */
      className={cn("bg-muted animate-pulse rounded-md", className)}
      {...props}
    />
  );
}

export { Skeleton };
