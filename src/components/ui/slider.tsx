"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 文件定位：
 * - Slider 基础组件封装，属于前端交互输入层。
 * - 必须是 Client Component：拖拽手柄、实时数值反馈等行为依赖浏览器事件。
 */

/**
 * 滑块组件。
 *
 * @param className 外部样式扩展。
 * @param defaultValue 非受控初始值（数组，支持单点或区间）。
 * @param value 受控值（数组）。
 * @param min 最小值，默认 0。
 * @param max 最大值，默认 100。
 * @param props 其余 Radix Slider 参数（步长、方向、回调等）。
 *
 * 设计关键：
 * - `_values` 用于计算“应渲染几个 thumb”：
 *   1) 优先使用受控 `value`；
 *   2) 否则回退非受控 `defaultValue`；
 *   3) 再不行回退 `[min, max]`（双滑块），保证结构稳定。
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    // 依赖数组说明：
    // - value/defaultValue/min/max 任一变化都可能影响 thumb 数量与位置，需重新计算。
    [value, defaultValue, min, max]
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={
          "bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
        }
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={
            "bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          }
        />
      </SliderPrimitive.Track>
      {/* 按值数量渲染 thumb：
          - 单值场景渲染 1 个；
          - 区间场景渲染 2 个；
          这是业务语义映射，不是技术限制。 */}
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
