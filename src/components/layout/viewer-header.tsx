"use client";

import { BookOpen, Waypoints } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";

/**
 * 文件定位（Client Component / 访客端顶部导航）：
 * - 负责前台书库页的主导航与主题切换。
 * - 依赖浏览器路由状态（`usePathname`）驱动导航激活态，因此必须是 Client Component。
 *
 * 首版范围说明：不包含管理台与用户体系，故此处不渲染登录/退出入口。
 */

/** 主导航项定义：集中在一处，避免 JSX 内散落路径字面量。 */
const NAV_ITEMS = [{ href: "/", label: "书库", icon: BookOpen }] as const;

export function ViewerHeader() {
  // 读取当前 pathname 以驱动导航按钮激活态。
  const pathname = usePathname();

  return (
    <header className="viewer-header sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="viewer-header-inner mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="group flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/20 bg-primary/10 transition-colors group-hover:bg-primary/20">
            <span className="font-serif text-xl font-bold text-primary">淵</span>
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-semibold tracking-wide">文淵</span>
            <span className="text-[10px] tracking-widest text-muted-foreground">WEN YUAN</span>
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
          <ThemeToggle triggerClassName="viewer-header-theme-toggle" />
        </div>
      </div>
    </header>
  );
}
