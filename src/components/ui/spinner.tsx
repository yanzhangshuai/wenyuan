import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 文件定位（加载旋转图标）：
 * - 文件路径：`src/components/ui/spinner.tsx`
 * - 所属层次：前端基础反馈组件层。
 *
 * 业务职责：
 * - 提供统一 Loading 图标，减少各处重复实现；
 * - 带无障碍语义（`role=status` 与 `aria-label`），便于读屏器识别加载状态。
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
