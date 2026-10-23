"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * 自动刷新（Client Component）。
 *
 * 为什么用它而不是给每一行做客户端轮询：书籍列表是**服务端渲染的表格**，
 * 一旦把状态列改成客户端组件，整张表的排序、空态、列宽都要重新接一遍。
 * 而「有作品在解析」这个状态本来就该让整页数据重新算（实体数、成本也会变），
 * 所以 `router.refresh()` 反而语义更准。
 *
 * 代价：每 5s 重渲染一次整页（服务端）。列表最多几十行，可接受；
 * 没有解析任务时组件不渲染，零开销。
 */
export interface AutoRefreshProps {
  /** 是否启用。 */
  enabled: boolean;
  /** 刷新间隔（毫秒）。 */
  intervalMs?: number;
}

export function AutoRefresh({ enabled, intervalMs = 5000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, intervalMs, router]);

  return null;
}
