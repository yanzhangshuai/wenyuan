import { ArrowRight, BookOpen, GitBranch, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listBooksForAdmin } from "@/server/modules/admin/books-query";
import { loadOverviewStats } from "@/server/modules/admin/overview";

/**
 * 后台仪表盘。
 *
 * 只读：展示规模与最近解析状态；解析本身仍在终端执行（付费长任务不进 HTTP 请求）。
 */
/**
 * 显式声明「本路由阻塞渲染」。
 *
 * v3 开启了 `cacheComponents`：未缓存的数据访问（DB / Cookie）默认会阻塞预渲染并报警。
 * 后台与登录页都必须读到实时数据，因此这里按 Next 16 的建议声明 `instant = false`，
 * 而不是把整页塞进 Suspense 做无意义的骨架屏。
 */
export const instant = false;

export const metadata: Metadata = { title: "仪表盘" };

/** 状态中文名。 */
const STATUS_LABELS: Record<string, string> = {
  pending: "待解析",
  parsing: "解析中",
  ready  : "已就绪",
  failed : "失败"
};

export default async function AdminDashboardPage() {
  const [stats, books] = await Promise.all([loadOverviewStats(), listBooksForAdmin()]);
  const recent = books.slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 py-8">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-semibold">仪表盘</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          当前共 {stats.books} 部作品 · {stats.entities} 个实体 · {stats.relationships} 条关系
        </p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card className="gap-0 py-5">
          <CardHeader className="pb-0">
            <CardDescription className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              作品
            </CardDescription>
            <CardTitle className="text-3xl tabular-nums">{stats.books}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="gap-0 py-5">
          <CardHeader className="pb-0">
            <CardDescription className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              实体
            </CardDescription>
            <CardTitle className="text-3xl tabular-nums">{stats.entities}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="gap-0 py-5">
          <CardHeader className="pb-0">
            <CardDescription className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              关系
            </CardDescription>
            <CardTitle className="text-3xl tabular-nums">{stats.relationships}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        {/* 用 CardHeader 自带的 grid + CardAction，而不是把 CardHeader 改成 flex：
            改成 flex 后 CardTitle/CardDescription 会落进同一个子节点，丢掉 header 的 gap，
            表现为标题与说明紧贴。CardAction 由组件自带，右侧按钮仍是右对齐。 */}
        <CardHeader>
          <CardTitle className="text-lg">最近作品</CardTitle>
          <CardDescription>解析状态与最近一次运行</CardDescription>
          <CardAction className="self-center">
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link href="/admin/books">
                全部作品
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              还没有作品。先到「导入书籍」上传 txt，或在终端运行 <code>pnpm import:book</code>。
            </p>
          ) : (
            <ul className="divide-y">
              {recent.map((book) => (
                <li key={book.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/admin/books/${book.id}`} className="truncate font-medium hover:underline">
                      {book.title}
                    </Link>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {book.chapterCount} 章 · {book.entityCount} 实体 · {book.relationCount} 关系
                      {book.lastRunCostUsd === null ? "" : ` · 最近成本 $${book.lastRunCostUsd}`}
                    </div>
                  </div>
                  <Badge variant={book.status === "ready" ? "default" : "secondary"}>
                    {STATUS_LABELS[book.status] ?? book.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
        提示：解析是付费长任务（一次约 $0.21–0.66），按项目纪律不在 Web 进程内触发。
        导入完成后，请在终端运行 <code className="mx-1">pnpm analyze &lt;bookId&gt;</code> 再回本页查看结果。
      </p>
    </div>
  );
}
