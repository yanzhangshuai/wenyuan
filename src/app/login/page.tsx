import type { Metadata } from "next";

import { loadOverviewStats } from "@/server/modules/admin/overview";

import { LoginView, type LoginStats } from "./login-view";

/**
 * `/login`（服务端壳）。
 *
 * 职责：取真实统计后交给客户端视图；页面本身不含交互逻辑。
 * 统计取数失败时**降级为 0**，保证登录表单始终可用（登录是恢复访问的唯一入口）。
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
  title : "登录",
  robots: { index: false, follow: false }
};

const EMPTY_STATS: LoginStats = { books: 0, entities: 0, relationships: 0 };

export default async function LoginPage() {
  let stats: LoginStats = EMPTY_STATS;
  try {
    stats = await loadOverviewStats();
  } catch {
    stats = EMPTY_STATS;
  }

  return <LoginView stats={stats} />;
}
