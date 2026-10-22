import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminHeader } from "@/components/layout/admin-header";
import { AUTH_ADMIN_ROLE, sanitizeRedirectPath } from "@/lib/auth";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * 后台布局（第二层鉴权）。
 *
 * 为什么 middleware 之外还要再校验一次：
 * - middleware 是入口门禁，但它的 matcher 一旦被误改就会静默放行；
 * - 布局层是业务兜底，且这里是**唯一回查 `is_active` 的地方**——
 *   停用账号即使持有未过期令牌也会被挡下。
 *
 * 为什么这里要求 ADMIN：
 * 后台是**管理员专用**。普通用户（自助注册的 VIEWER）登录后落点是书库首页，
 * 不应看到后台；即使手动访问 `/admin` 也会被弹回首页。
 * 早期版本曾允许 VIEWER 只读，但那样会让「用户登录」落到一个他不该看到的后台界面。
 */
/**
 * 显式声明「本路由阻塞渲染」。
 *
 * v3 开启了 `cacheComponents`：未缓存的数据访问（DB / Cookie）默认会阻塞预渲染并报警。
 * 后台与登录页都必须读到实时数据，因此这里按 Next 16 的建议声明 `instant = false`，
 * 而不是把整页塞进 Suspense 做无意义的骨架屏。
 */
export const instant = false;

export const metadata: Metadata = {
  title : { default: "管理后台", template: "%s — 文渊管理" },
  robots: { index: false, follow: false }
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext();
  if (auth === null) {
    redirect(`/login?redirect=${encodeURIComponent(sanitizeRedirectPath("/admin"))}`);
  }
  if (auth.role !== AUTH_ADMIN_ROLE) {
    // 已登录但不是管理员：回书库首页，不暴露后台任何内容。
    redirect("/");
  }

  return (
    <div className="relative z-[1] flex min-h-dvh flex-col">
      <AdminHeader userName={auth.name} role={auth.role} />
      {/* 必须高于主题背景层，否则 xingkong 的 fixed canvas 会盖住后台内容区。 */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
