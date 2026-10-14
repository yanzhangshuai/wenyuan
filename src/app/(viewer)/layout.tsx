import { Suspense, type ReactNode } from "react";

import { ViewerHeader } from "@/components/layout/viewer-header";

/**
 * 访客端布局（Route Group `(viewer)`）。
 *
 * 约束：
 * - Server Component，不得添加 "use client"；
 * - 顶部导航自身是唯一交互入口，已声明为 Client Component，此处只做组装。
 *
 * `Suspense` 的必要性：`ViewerHeader` 内部使用 `usePathname()`，
 * 而 pathname 只有在真实请求到达时才可知。项目开启了 `cacheComponents`（PPR），
 * 若不包 `Suspense`，构建期预渲染会因「无法解析该 Client Hook」而直接失败
 * （见 `data-suspense-boundary`）。
 */
export default function ViewerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Suspense fallback={<ViewerHeaderFallback />}>
        <ViewerHeader />
      </Suspense>
      <main className="flex-1">{children}</main>
    </div>
  );
}

/**
 * 导航骨架。
 *
 * 保持与 `ViewerHeader` 相同的高度与边框，避免流式渲染完成时页面内容跳动。
 */
function ViewerHeaderFallback() {
  return (
    <header className="viewer-header sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur" />
  );
}
