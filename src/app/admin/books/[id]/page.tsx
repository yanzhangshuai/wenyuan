import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AnalysisProgressPanel } from "@/components/admin/analysis-progress";
import { PackEditor } from "@/components/admin/pack-editor";
import { getDatabase } from "@/server/db/client";
import { bookPacks } from "@/server/db/schema";
import { loadAnalysisStatus } from "@/server/modules/admin/analysis-status";
import { loadAliasAudit, loadBookDetail } from "@/server/modules/admin/books-query";
import { loadWorkPack } from "@/server/modules/analysis/genre-pack/load";

/**
 * 书籍详情（只读）。
 *
 * 信息分层：规模指标 → 解析运行记录 → 章节清单。
 * 不在此页触发任何写操作（解析走终端），避免把付费长任务塞进请求生命周期。
 */
/**
 * 显式声明「本路由阻塞渲染」。
 *
 * v3 开启了 `cacheComponents`：未缓存的数据访问（DB / Cookie）默认会阻塞预渲染并报警。
 * 后台与登录页都必须读到实时数据，因此这里按 Next 16 的建议声明 `instant = false`，
 * 而不是把整页塞进 Suspense 做无意义的骨架屏。
 */
export const instant = false;

export const metadata: Metadata = { title: "书籍详情" };

/** 状态中文名与徽标变体。 */
const STATUS_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pending: { label: "待解析", variant: "secondary" },
  parsing: { label: "解析中", variant: "secondary" },
  ready  : { label: "已就绪", variant: "default" },
  failed : { label: "失败", variant: "destructive" }
};

/** 运行状态中文名。 */
const RUN_LABELS: Record<string, string> = {
  running  : "运行中",
  succeeded: "成功",
  failed   : "失败",
  canceled : "已取消"
};

/** 成本格式（`null` 显示破折号）。 */
function formatCost(value: string | null): string {
  if (value === null) return "—";
  return `$${value}`;
}

/** 时间格式。 */
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

export default async function AdminBookDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadBookDetail(id);
  if (detail === null) notFound();

  const analysisStatus = await loadAnalysisStatus(id);
  const { book, chapters, runs } = detail;

  // 解析条件：库里存的（可编辑）与实际生效的（决定下次解析用哪份）。
  const db = getDatabase();
  const [packRow] = await db.select().from(bookPacks).where(eq(bookPacks.bookId, id)).limit(1);
  const effectivePack = await loadWorkPack(id, book.title);
  // 别名体检：别名特别多的实体通常是错并（实测儒林 `姑丈` 7 个、红楼 `二姨` 12 个）。
  const aliasAudit = book.entityCount > 0 ? await loadAliasAudit(id) : [];
  /**
   * 体检项里哪些名字**在别名组里**。
   *
   * 这决定「点名字能不能跳过去」：体检读的是图谱的 `entity_aliases`，
   * 而能改的只有配置的 `aliasGroups` —— 两者不是同一份数据。
   * 实测儒林 8 个体检项里只有 1 个（`杜慎卿`）在组里，其余 7 个的错并来自抽取阶段，
   * 改配置修不了。不给链接 + 写明原因，比点了没反应诚实。
   */
  const aliasGroupMembers = new Set((effectivePack.pack.aliasGroups ?? []).flat());

  /**
   * 库里没有配置、但命中内置包时，把内置包的内容**预填**到编辑器。
   *
   * 不预填的后果（实测踩到）：页面显示「135 个专名」，而两个文本框是空的；
   * 用户此时点「保存」会把**空配置**写进库 —— 内置包被一份空配置覆盖，
   * 下次解析直接退化成零词典，而且没有任何报错。
   */
  const builtinPack =
    packRow === undefined && effectivePack.origin === "builtin"
      ? {
          properNouns: effectivePack.pack.properNouns.map(([name, postag]) => ({ name, postag })),
          aliasGroups: (effectivePack.pack.aliasGroups ?? []).map((group) => [...group])
        }
      : null;
  const status = STATUS_META[book.status] ?? { label: book.status, variant: "secondary" as const };
  const totalChars = chapters.reduce((sum, chapter) => sum + chapter.charCount, 0);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 gap-2">
        <Link href="/admin/books">
          <ArrowLeft className="h-4 w-4" />
          返回书籍列表
        </Link>
      </Button>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-2xl font-semibold">{book.title}</h1>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {book.author ?? "作者未填"} · {book.chapterCount} 章 ·{" "}
            {totalChars.toLocaleString("zh-CN")} 字
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 导出：图谱已就绪才给入口（未解析时导出的是空表，容易让人以为坏了）。 */}
          {book.entityCount > 0 ? (
            <>
              <Button asChild variant="ghost" size="sm" className="gap-1.5 text-xs">
                <a href={`/api/books/${book.id}/export?type=entities`} download>
                  <Download className="h-3.5 w-3.5" />
                  实体 CSV
                </a>
              </Button>
              <Button asChild variant="ghost" size="sm" className="gap-1.5 text-xs">
                <a href={`/api/books/${book.id}/export?type=relationships`} download>
                  <Download className="h-3.5 w-3.5" />
                  关系 CSV
                </a>
              </Button>
              <Button asChild variant="ghost" size="sm" className="gap-1.5 text-xs">
                <a href={`/api/books/${book.id}/export?type=json`} download>
                  <Download className="h-3.5 w-3.5" />
                  JSON
                </a>
              </Button>
            </>
          ) : null}
          <Button asChild variant="outline" className="gap-2">
            <Link href={`/book/${book.id}`}>
              打开图谱
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-4">
        <Card className="gap-0 py-5">
          <CardHeader className="pb-0">
            <CardDescription>实体</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{book.entityCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="gap-0 py-5">
          <CardHeader className="pb-0">
            <CardDescription>关系</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{book.relationCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="gap-0 py-5">
          <CardHeader className="pb-0">
            <CardDescription>解析次数</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{runs.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="gap-0 py-5">
          <CardHeader className="pb-0">
            <CardDescription>最近成本</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatCost(book.lastRunCostUsd)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <PackEditor
        bookId={id}
        className="mb-6"
        builtinPack={builtinPack}
        canStart={analysisStatus !== null && analysisStatus.run === null && analysisStatus.bookStatus !== "parsing"}
        initialStored={
          packRow === undefined
            ? null
            : {
                source        : packRow.source,
                status        : packRow.status,
                properNouns   : packRow.properNouns,
                aliasGroups   : packRow.aliasGroups,
                suggestionNote: packRow.suggestionNote,
                metrics       : packRow.metrics,
                updatedAt     : packRow.updatedAt.toISOString()
              }
        }
        effective={{
          origin          : effectivePack.origin,
          packId          : effectivePack.pack.id,
          packLabel       : effectivePack.pack.label,
          properNounCount : effectivePack.properNounCount,
          aliasGroupCount : effectivePack.aliasGroupCount
        }}
      />

      {aliasAudit.length > 0 ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">别名体检</CardTitle>
            <CardDescription>
              别名特别多的实体，通常是错并 —— 把泛称或别人的称谓并了进来。按别名数排序，前几个最可疑。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {aliasAudit.map((row) => (
              <div key={row.entityId} className="flex flex-wrap items-baseline gap-2 text-sm">
                {/* 在别名组里 → 可跳转定位；不在 → 错并来自抽取阶段，改配置修不了。 */}
                {aliasGroupMembers.has(row.canonical) ? (
                  <a
                    href={`#alias-${encodeURIComponent(row.canonical)}`}
                    className="hover:text-primary font-medium underline-offset-2 hover:underline"
                    title="点击定位到上方的别名组"
                  >
                    {row.canonical}
                  </a>
                ) : (
                  <span className="font-medium" title="不在别名组里：错并来自抽取阶段，改配置修不了">
                    {row.canonical}
                    <span className="text-muted-foreground ml-1 text-[10px]">（不在组里）</span>
                  </span>
                )}
                <Badge variant={row.aliases.length >= 8 ? "destructive" : "secondary"}>
                  {row.aliases.length} 个
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {row.aliases.slice(0, 8).join(" / ")}
                  {row.aliases.length > 8 ? ` …还有 ${String(row.aliases.length - 8)} 个` : ""}
                </span>
              </div>
            ))}
            <p className="text-muted-foreground border-t pt-2 text-xs">
              ⚠️ 别名 ≥ 8 个通常意味着错并。点名字可定位到上方的别名组（若它在组里）；要修的话先「复制为自定义配置」，再删掉不属于这个人的写法。
            </p>
          </CardContent>
        </Card>
      ) : null}

      <AnalysisProgressPanel bookId={id} initial={analysisStatus} className="mb-6" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">解析运行</CardTitle>
          <CardDescription>按开始时间倒序；成本为该 run 全部调用的累计值</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              还没有解析记录。确认上方的解析条件后，点「开始解析」。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">开始</th>
                    <th className="px-2 py-2 text-left font-medium">状态</th>
                    <th className="px-2 py-2 text-left font-medium">提示词版本</th>
                    <th className="px-2 py-2 text-right font-medium">调用数</th>
                    <th className="px-2 py-2 text-right font-medium">成本</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td className="text-muted-foreground px-2 py-2 text-xs">{formatTime(run.startedAt)}</td>
                      <td className="px-2 py-2">{RUN_LABELS[run.status] ?? run.status}</td>
                      <td className="text-muted-foreground px-2 py-2 font-mono text-xs">{run.promptVersion}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{run.callCount}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatCost(run.costUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">章节</CardTitle>
          <CardDescription>回号 0 为前言等前置内容</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground sticky top-0 bg-background">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">回号</th>
                  <th className="px-2 py-2 text-left font-medium">标题</th>
                  <th className="px-2 py-2 text-right font-medium">字数</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {chapters.map((chapter) => (
                  <tr key={chapter.ordinal}>
                    <td className="px-2 py-2 tabular-nums">{chapter.ordinal}</td>
                    <td className="px-2 py-2">{chapter.title}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{chapter.charCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
