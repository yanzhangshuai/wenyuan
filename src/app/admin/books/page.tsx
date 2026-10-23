import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AutoRefresh } from "@/components/admin/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listBooksForAdmin } from "@/server/modules/admin/books-query";

/**
 * 书籍列表（只读）。
 *
 * 列的选择依据：运营真正关心的是「规模 + 是否解析过 + 花了多少钱」，
 * 因此保留 7 列而不是把 run 详情塞进列表（详情在单本页）。
 */
/**
 * 显式声明「本路由阻塞渲染」。
 *
 * v3 开启了 `cacheComponents`：未缓存的数据访问（DB / Cookie）默认会阻塞预渲染并报警。
 * 后台与登录页都必须读到实时数据，因此这里按 Next 16 的建议声明 `instant = false`，
 * 而不是把整页塞进 Suspense 做无意义的骨架屏。
 */
export const instant = false;

export const metadata: Metadata = { title: "书籍" };

/** 状态中文名与徽标变体。 */
const STATUS_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pending: { label: "待解析", variant: "secondary" },
  parsing: { label: "解析中", variant: "secondary" },
  ready  : { label: "已就绪", variant: "default" },
  failed : { label: "失败", variant: "destructive" }
};

/** 时间格式（本地化，仅到分钟）。 */
function formatTime(value: Date | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year  : "numeric",
    month : "2-digit",
    day   : "2-digit",
    hour  : "2-digit",
    minute: "2-digit"
  }).format(value);
}

export default async function AdminBooksPage() {
  const books = await listBooksForAdmin();

  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 py-8">
      {/* 有作品在解析时每 5s 重渲染，状态列与百分比自动跟上。 */}
      <AutoRefresh enabled={books.some((book) => book.status === "parsing")} />
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">书籍</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">共 {books.length} 部作品</p>
        </div>
        <Button asChild className="gap-2">
          <Link href="/admin/books/import">
            <Plus className="h-4 w-4" />
            导入书籍
          </Link>
        </Button>
      </div>

      {books.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          还没有作品。点击右上角「导入书籍」，或在终端运行 <code>pnpm import:book</code>。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">书名</th>
                <th className="px-4 py-3 text-left font-medium">状态</th>
                <th className="px-4 py-3 text-right font-medium">章数</th>
                <th className="px-4 py-3 text-right font-medium">实体</th>
                <th className="px-4 py-3 text-right font-medium">关系</th>
                <th className="px-4 py-3 text-left font-medium">最近解析</th>
                <th className="px-4 py-3 text-right font-medium">成本</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {books.map((book) => {
                const meta = STATUS_META[book.status] ?? { label: book.status, variant: "secondary" as const };
                return (
                  <tr key={book.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link href={`/admin/books/${book.id}`} className="font-medium hover:underline">
                        {book.title}
                      </Link>
                      {book.author === null ? null : (
                        <span className="text-muted-foreground ml-2 text-xs">{book.author}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={meta.variant}>
                        {meta.label}
                        {book.status === "parsing" && book.lastRunPercent > 0
                          ? ` ${String(book.lastRunPercent)}%`
                          : ""}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{book.chapterCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{book.entityCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{book.relationCount}</td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {formatTime(book.lastRunAt)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {book.lastRunCostUsd === null ? "—" : `$${book.lastRunCostUsd}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
