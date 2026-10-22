import { Suspense, type ReactNode } from "react";

import { ViewerHeader } from "@/components/layout/viewer-header";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * 访客端布局（Route Group `(viewer)`）。
 *
 * 约束：
 * - Server Component，不得添加 "use client"；
 * - 顶部导航自身是交互入口，已声明为 Client Component，此处只做组装与鉴权读取。
 *
 * `Suspense` 的双重必要性：
 * 1. `ViewerHeader` 内部使用 `usePathname()`，pathname 只有真实请求到达时才可知；
 * 2. 登录态来自 Cookie（未缓存数据），必须包在 `Suspense` 内，
 *    否则 `cacheComponents`（PPR）下会阻塞预渲染并报错。
 * 两者共用同一个边界：骨架高度与导航一致，流式补齐时不跳动。
 */
export default function ViewerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Suspense fallback={<ViewerHeaderFallback />}>
        <ViewerHeaderWithAuth />
      </Suspense>
      <main className="flex-1">{children}</main>
    </div>
  );
}

/**
 * 读取登录态后渲染导航。
 *
 * 独立成 async 组件是为了把「未缓存数据访问」放进 `Suspense` 边界内；
 * 只下发 `name` 与 `role`，不把邮箱等字段带到前端。
 */
async function ViewerHeaderWithAuth() {
  const auth = await getAuthContext();
  return (
    <ViewerHeader
      auth={auth === null ? null : { name: auth.name, role: auth.role }}
    />
  );
}

/**
 * 导航骨架。
 *
 * 保持与 `ViewerHeader` 相同的高度与边框，避免流式渲染完成时页面内容跳动。
 */
function ViewerHeaderFallback() {
  return (
    <header className="viewer-header border-border/40 bg-background/95 sticky top-0 z-50 w-full border-b backdrop-blur" />
  );
}
