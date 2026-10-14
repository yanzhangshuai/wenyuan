import * as React from "react";

/**
 * 业务断点定义：
 * - 小于 768 视为移动端；
 * - 与 Tailwind 常用 `md` 起点对齐，保证样式与逻辑判断一致。
 */
const MOBILE_BREAKPOINT = 768;

const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/** 订阅视口断点变化。 */
function subscribeToViewport(onStoreChange: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => {
    mql.removeEventListener("change", onStoreChange);
  };
}

/** 客户端快照：按当前视口宽度判定。 */
function getViewportSnapshot(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

/** 服务端快照：固定按桌面端渲染，避免 hydration 前后不一致。 */
function getServerViewportSnapshot(): boolean {
  return false;
}

/**
 * 视口是否为移动端。
 *
 * 实现说明：
 * - 使用 `useSyncExternalStore` 订阅 `matchMedia`，而不是 `useEffect + setState`；
 *   后者会在 effect 内同步写入状态并触发级联渲染（React 官方不推荐）。
 * - 服务端快照固定为 `false`，客户端 hydration 阶段与之一致，不会产生不一致告警。
 *
 * @returns 视口宽度小于 768px 时为 true
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribeToViewport,
    getViewportSnapshot,
    getServerViewportSnapshot
  );
}
