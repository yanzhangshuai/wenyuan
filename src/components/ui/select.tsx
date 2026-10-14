"use client";

/**
 * =============================================================================
 * 文件定位（设计系统 - 选择器 Select）
 * -----------------------------------------------------------------------------
 * 文件路径：`src/components/ui/select.tsx`
 *
 * 项目角色：
 * - 封装 Radix Select，统一“触发器 + 下拉内容 + 选项项”交互模型；
 * - 面向表单输入和筛选场景，属于前端渲染层基础控件。
 *
 * 为什么必须客户端执行：
 * - 打开/关闭、键盘导航、滚动按钮显示、选中状态同步都依赖浏览器事件；
 * - 因此该组件维持 `use client`，避免在服务端渲染阶段引入行为缺失。
 *
 * 维护建议：
 * - 选中图标、滚动按钮、分组标签是可访问性与可用性的重要组成，不建议删减；
 * - 若调整 className 结构，请同时验证浮层定位与移动端触控体验。
 * =============================================================================
 */

import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const SELECT_EMPTY_VALUE = "__SELECT_EMPTY__";

function isSelectEmptyValue(value: string) {
  return value === SELECT_EMPTY_VALUE;
}

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  /**
   * 组件职责：
   * - Select 根容器，管理当前值、展开状态与键盘交互。
   */
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  /**
   * 业务语义：
   * - 用于组织分组选项，适合“按类别筛选”的下拉场景。
   */
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  /**
   * 组件职责：
   * - 渲染触发器中当前选中值，是调用方展示最终选择结果的出口位。
   */
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  /**
   * 触发器尺寸：
   * - `default`：常规表单高度；
   * - `sm`：紧凑场景（工具栏、筛选条）。
   */
  size?: "sm" | "default"
}) {
  /**
   * 组件职责：
   * - 下拉选择触发器，统一占位态、错误态、禁用态和尺寸语义。
   *
   * 设计原因：
   * - `data-size` 通过属性驱动样式，避免为尺寸创建多套组件。
   */
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-placeholder:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive bg-background flex w-fit items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  /**
   * 组件职责：
   * - 渲染下拉浮层内容，并在可视区内处理定位与滚动。
   *
   * 参数语义：
   * - `position = "popper"`：默认采用 popper 定位，跟随触发器动态贴边。
   *
   * 分支原因：
   * - `position === "popper"` 时补充位移与 viewport 尺寸绑定，
   *   是为了解决不同方向弹出时的视觉贴合问题，属于体验规则。
   */
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-32 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width) scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  /**
   * 组件职责：
   * - 分组标题，帮助用户快速理解选项分类。
   */
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  /**
   * 组件职责：
   * - 单个可选项，包含选中指示图标与文本区。
   *
   * 设计原因：
   * - 右侧固定 `ItemIndicator` 保证不同长度文本下对齐一致，降低扫读成本。
   */
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectEmptyItem({
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Item>, "value">) {
  return <SelectItem value={SELECT_EMPTY_VALUE} {...props} />;
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  /**
   * 组件职责：
   * - 分隔不同选项组，构建清晰的信息边界。
   */
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  /**
   * 组件职责：
   * - 当选项超长时提供向上滚动入口，保障键盘与鼠标两种操作都可达。
   */
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  /**
   * 组件职责：
   * - 当选项超长时提供向下滚动入口，避免“看不见的选项无法选择”问题。
   */
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectEmptyItem,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  SELECT_EMPTY_VALUE,
  isSelectEmptyValue
};
