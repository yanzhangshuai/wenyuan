import { Check } from "lucide-react";
import * as React from "react";


import { cn } from "@/lib/utils";

/**
 * 复选框（原生 input + 视觉层）。
 *
 * ## 为什么不用 `@radix-ui/react-checkbox`
 * v3 的依赖必须同时装进 WSL 与 Windows 镜像两套 `node_modules`，新增依赖是本项目
 * 风险最高的一步。视觉上原生 input 加 `appearance-none` 已能 1:1 复刻 v1 的方块样式，
 * 且原生元素自带键盘与无障碍语义，因此选择零依赖实现。
 *
 * 用法与 v1 一致：`<Checkbox id="remember" />` + 独立的 `<Label htmlFor="remember">`。
 */
function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        data-slot="checkbox"
        className={cn(
          "peer border-input size-4 appearance-none rounded-[4px] border bg-transparent shadow-xs transition-[color,box-shadow] outline-none",
          "checked:bg-primary checked:border-primary",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="text-primary-foreground pointer-events-none absolute size-3 opacity-0 peer-checked:opacity-100"
      />
    </span>
  );
}

export { Checkbox };
