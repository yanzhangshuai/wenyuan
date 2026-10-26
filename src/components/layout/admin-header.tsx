"use client";

import { BookOpen, LayoutDashboard, LogOut, MessageSquareWarning, Plus, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { AUTH_ROLE_LABELS, type AuthRole } from "@/lib/auth";
import { logout } from "@/lib/services/auth";

/**
 * 后台顶部导航（Client Component）。
 *
 * 为什么用 header 而不是侧边栏：一级模块数量少（仪表盘 / 书籍 / 反馈 / 用户），
 * 侧边栏会恒定吃掉约 240px 宽度，而书籍表有 7 列，宽度比导航更稀缺。
 * 扩展条件：一级模块 ≥5 时再换侧边栏（导航项已集中为 `NAV_ITEMS`，改壳不改页）。
 * 当前 4 项（仪表盘/书籍/反馈/用户）在 1440px 下仍宽裕。
 */

/** 一级导航（单一来源，避免 JSX 里散落路径字面量）。 */
const NAV_ITEMS = [
  { href: "/admin", label: "仪表盘", icon: LayoutDashboard, exact: true },
  { href: "/admin/books", label: "书籍", icon: BookOpen, exact: false },
  { href: "/admin/feedback", label: "反馈", icon: MessageSquareWarning, exact: false },
  { href: "/admin/users", label: "用户", icon: Users, exact: false }
] as const;

export interface AdminHeaderProps {
  /** 当前登录用户展示名。 */
  userName: string;
  /** 当前角色。 */
  role    : AuthRole;
}

export function AdminHeader({ userName, role }: AdminHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const isActive = (href: string, exact: boolean): boolean =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  async function handleLogout(): Promise<void> {
    setIsLoggingOut(true);
    try {
      await logout();
      router.replace("/login");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <header className="admin-header bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 w-full border-b border-border/40 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="group flex items-center gap-3">
            <div className="border-primary/20 bg-primary/10 group-hover:bg-primary/20 flex h-9 w-9 items-center justify-center rounded-md border transition-colors">
              <span className="text-primary font-serif text-xl font-bold">淵</span>
            </div>
            {/* 只留中文名。两行叠放时行盒合计 43px > 方块 36px，上下各溢出 3.5px，
                看起来像「文字比 logo 大一圈」；去掉英文副标题后单行自然居中。 */}
            <span className="text-lg font-semibold tracking-wide">文淵管理</span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href, item.exact);
              return (
                <Button
                  key={item.href}
                  asChild
                  variant="ghost"
                  size="sm"
                  data-active={active ? "true" : "false"}
                  className="admin-header-nav-button gap-2"
                >
                  <Link href={item.href}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href="/admin/books/import">
              <Plus className="h-4 w-4" />
              导入书籍
            </Link>
          </Button>
          <ThemeToggle />
          <div className="ml-1 hidden flex-col items-end leading-tight sm:flex">
            <span className="text-sm font-medium">{userName}</span>
            {/* 名称与角色同名时（默认管理员名就叫「管理员」）不重复显示，
                否则右上角会出现两行完全相同的「管理员」。与 viewer-header 同规则。 */}
            {userName === AUTH_ROLE_LABELS[role] ? null : (
              <span className="text-muted-foreground text-[11px]">{AUTH_ROLE_LABELS[role]}</span>
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
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden lg:inline">退出</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
