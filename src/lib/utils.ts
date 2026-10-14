import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 文件定位（前端通用工具函数）：
 * - 文件路径：`src/lib/utils.ts`
 * - 所属层次：前端公共工具层。
 *
 * 核心职责：
 * - 提供 className 合并工具；
 * - 提供字符串哈希工具，服务稳定色彩/分组等场景。
 */

/**
 * 统一拼接条件 className，处理 Tailwind 类名冲突。
 *
 * @param inputs 可包含字符串、条件对象、数组等 clsx 支持输入
 * @returns 冲突消解后的 className 字符串
 *
 * 设计原因：
 * - `clsx` 负责条件拼接；
 * - `twMerge` 负责 Tailwind 冲突规则（例如两个 `px-*` 只保留后者）。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * 计算字符串哈希（32 位整数）。
 *
 * @param str 输入字符串
 * @returns 非负整数哈希值
 *
 * 业务用途：
 * - 常用于把稳定文本映射为稳定颜色索引或分桶编号；
 * - 同一输入在同一实现下保证稳定输出。
 */
export function getStringHash(str: string): number {
  let hash = 0;
  // 空字符串直接返回 0，避免进入循环产生不必要开销。
  if (str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    // 压缩为 32 位有符号整数，保持跨运行时一致性。
    hash = hash & hash;
  }
  // 返回非负值，便于后续用于数组下标或取模。
  return Math.abs(hash);
}


