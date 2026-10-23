"use client";

import { BookOpen, LayoutDashboard, LogIn, LogOut, Waypoints } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { AUTH_ROLE_LABELS, isAdminRole, type AuthRole } from "@/lib/auth";
import { logout } from "@/lib/services/auth";

/**
 * 文件定位（Client Component / 访客端顶部导航）：
 * - 负责前台书库页的主导航、登录入口与主题切换。
 * - 依赖浏览器路由状态（`usePathname`）驱动导航激活态，因此必须是 Client Component。
 *
 * 登录状态由服务端注入（`auth` prop）：
 * - `null` → 显示「登录」入口；
 * - 管理员 → 额外显示「后台」；
 * - 任何已登录用户 → 显示名称与「退出」。
 */

/** 主导航项定义：集中在一处，避免 JSX 内散落路径字面量。 */
const NAV_ITEMS = [{ href: "/", label: "书库", icon: BookOpen }] as const;

/** 已登录用户的最小信息（与 `getAuthContext()` 对齐，避免把邮箱等字段带到前端）。 */
export interface ViewerAuth {
  name: string;
  role: AuthRole;
}

export interface ViewerHeaderProps {
  /** 当前登录用户；未登录为 `null`。 */
  auth?: ViewerAuth | null;
}

export function ViewerHeader({ auth = null }: ViewerHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout(): Promise<void> {
    setIsLoggingOut(true);
    try {
      await logout();
      router.replace("/");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <header className="viewer-header border-border/40 bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 w-full border-b backdrop-blur">
      <div className="viewer-header-inner mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="group flex items-center gap-3">
          <div className="border-primary/20 bg-primary/10 group-hover:bg-primary/20 flex h-9 w-9 items-center justify-center rounded-md border transition-colors">
            <span className="text-primary font-serif text-xl font-bold">淵</span>
          </div>
          {/* 行盒高度钉成 20 + 4 + 12 = 36，与 h-9 方块等高（与 admin-header 同规则）。 */}
          <div className="flex flex-col gap-1">
            <span className="text-lg leading-5 font-semibold tracking-wide">文淵</span>
            <span className="text-muted-foreground text-[10px] leading-3 tracking-widest">WEN YUAN</span>
          </div>
        </Link>

        {/* Navigation Links */}
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.href}
                asChild
                variant="ghost"
                size="sm"
                data-active={pathname === item.href ? "true" : "false"}
                className="viewer-header-nav-button gap-2"
              >
                <Link href={item.href}>
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="gap-2" title="关系图谱">
            <Link href="/graph">
              <Waypoints className="h-4 w-4" />
              <span className="hidden lg:inline">图谱</span>
            </Link>
          </Button>

          {auth === null ? (
            <Button asChild size="sm" className="gap-2">
              <Link href="/login">
                <LogIn className="h-4 w-4" />
                登录
              </Link>
            </Button>
          ) : (
            <>
              {isAdminRole(auth.role) ? (
                <Button asChild variant="ghost" size="sm" className="gap-2" title="管理后台">
                  <Link href="/admin">
                    <LayoutDashboard className="h-4 w-4" />
                    <span className="hidden lg:inline">后台</span>
                  </Link>
                </Button>
              ) : null}
              <div className="ml-1 hidden flex-col items-end leading-tight sm:flex">
                <span className="text-sm font-medium">{auth.name}</span>
                {/* 名称与角色同名时（如默认管理员账号名就叫「管理员」）不重复显示。 */}
                {auth.name === AUTH_ROLE_LABELS[auth.role] ? null : (
                  <span className="text-muted-foreground text-[11px]">{AUTH_ROLE_LABELS[auth.role]}</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={() => {
                  void handleLogout();
                }}
                disabled={isLoggingOut}
                title="退出登录"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          )}

          <ThemeToggle triggerClassName="viewer-header-theme-toggle" />
        </div>
      </div>
    </header>
  );
}
