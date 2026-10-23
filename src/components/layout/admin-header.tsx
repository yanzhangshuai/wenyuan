"use client";

import { BookOpen, LayoutDashboard, LogOut, Plus } from "lucide-react";
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
 * 为什么用 header 而不是侧边栏：本期一级模块只有 2 个（仪表盘 / 书籍），
 * 侧边栏会恒定吃掉约 240px 宽度，而书籍表有 7 列，宽度比导航更稀缺。
 * 扩展条件：一级模块 ≥4 时再换侧边栏（导航项已集中为 `NAV_ITEMS`，改壳不改页）。
 */

/** 一级导航（单一来源，避免 JSX 里散落路径字面量）。 */
const NAV_ITEMS = [
  { href: "/admin", label: "仪表盘", icon: LayoutDashboard, exact: true },
  { href: "/admin/books", label: "书籍", icon: BookOpen, exact: false }
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
            {/* 两行文字的**行盒高度之和必须等于方块高度（36px）**：
                text-lg 默认行高 28 + text-[10px] 默认行高 15 = 43，比 36px 的方块高出 7px，
                上下各溢出 3.5px —— 实测 rect 为 y10.5~53.5 vs 方块 y14~50，看起来就是「文字比 logo 大一圈」。
                钉成 20 + gap4 + 12 = 36 后，两块上下边缘完全重合。 */}
            <div className="flex flex-col gap-1">
              <span className="text-lg leading-5 font-semibold tracking-wide">文淵管理</span>
              <span className="text-muted-foreground text-[10px] leading-3 tracking-widest">ADMIN</span>
            </div>
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
