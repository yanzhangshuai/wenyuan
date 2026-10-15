"use client";

import { BookOpen, Users, GitBranch, Info } from "lucide-react";

import { BookCard, type BookCardData } from "@/components/library/book-card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";

/**
 * =============================================================================
 * 文件定位（阅读端首页 - 书库聚合视图）
 * -----------------------------------------------------------------------------
 * 在 Next.js 项目中的角色：
 * - 这是阅读端首页的 Client Component 容器，用于接收上游已获取的书籍列表并渲染；
 * - 自身不发起数据请求，不承担路由定义，属于“前端渲染层（展示 + 轻计算）”。
 *
 * 业务职责：
 * - 根据书籍状态展示空态、统计概览、书卡网格和项目说明；
 * - 将“可阅读（已就绪）”与“解析中”两类书籍在同一视图中分层呈现。
 *
 * 版式来源：与 v1 `wen-yuan` 的 `components/library/library-home.tsx` 保持 1:1。
 * `library-ambient`（首页氛围背景，含星空/典藏等主题专属效果）与 `library-section`
 * 的视觉细节定义在 `src/theme/tokens/<主题>/index.css`，随主题自动切换。
 *
 * 维护约束（业务规则，不是技术限制）：
 * - `status === "ready"` 才可视为可阅读，这是产品流程约束；
 * - 顶部统计口径依赖“已就绪书籍集合”，修改前需同步产品口径和后端字段定义。
 * =============================================================================
 */

export interface LibraryHomeProps {
  /**
   * 书库首页数据源。
   * - 来源：上游页面/容器组件注入；
   * - 语义：包含展示书卡与计算概览统计所需的全部字段。
   */
  books: BookCardData[];
}

/** 空态：书库无数据时占满视口高度，避免出现「半屏空白」的割裂感。 */
function LibraryEmptyState() {
  return (
    <section className="library-empty-state flex min-h-[calc(100dvh-64px)] flex-col items-center justify-center px-4 text-center">
      <div className="mb-6 rounded-full bg-primary-subtle p-6">
        <BookOpen className="h-12 w-12 text-primary" strokeWidth={1.5} />
      </div>
      <h2 className="mb-3 text-2xl font-bold tracking-tight text-foreground">暂无可阅读书籍</h2>
      <p className="max-w-md text-base leading-relaxed text-muted-foreground">
        书库目前空空如也。
        <br />
        请联系管理员在后台导入并解析书籍。
      </p>
      <div className="pointer-events-none mt-8 grid w-full max-w-lg grid-cols-3 gap-4 opacity-15 select-none">
        <div className="aspect-2/3 animate-pulse rounded bg-border" style={{ animationDelay: "75ms" }} />
        <div className="aspect-2/3 animate-pulse rounded bg-border" style={{ animationDelay: "150ms" }} />
        <div className="aspect-2/3 animate-pulse rounded bg-border" style={{ animationDelay: "300ms" }} />
      </div>
    </section>
  );
}

export function LibraryHome({ books }: LibraryHomeProps) {
  // 空数组视为“暂无可阅读内容”。
  // 这里提前返回可避免后续统计计算对空集做无意义遍历。
  if (books.length === 0) {
    return <LibraryEmptyState />;
  }

  // 业务规则：只有「已就绪」进入阅读链路，其他状态统一视为“待完成”。
  const completedBooks = books.filter((book) => book.status === "ready");
  const pendingBooks = books.filter((book) => book.status !== "ready");
  // 汇总已就绪书籍的规模，用于 Hero 统计。
  const totalEntities = completedBooks.reduce((acc, book) => acc + book.entityCount, 0);
  const totalRelations = completedBooks.reduce((acc, book) => acc + book.relationCount, 0);

  return (
    <div className="library-home library-ambient min-h-[calc(100dvh-64px)]">
      <div className="library-home-inner mx-auto max-w-[1440px] px-6 py-8">
        {/* Hero：主标题 + 副标题 + 三项统计 + 免责声明，构成首页的视觉重心。 */}
        <section className="library-hero mb-12 border-b border-border py-12 text-center">
          <h1 className="mb-4 text-3xl font-bold tracking-tight text-balance">中国古典文学人物关系图谱</h1>
          <p className="mx-auto max-w-2xl leading-relaxed text-muted-foreground">
            通过 AI 技术从古代长篇小说中提取人物、关系、事件与时间线，
            <br className="hidden lg:block" />
            构建可交互的知识图谱与人物档案系统
          </p>

          <div className="mt-8 flex items-center justify-center gap-8">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 text-sm">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{completedBooks.length}</span>
                    <span className="text-muted-foreground">部书籍</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>已完成解析的书籍数量</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{totalEntities.toLocaleString()}</span>
                    <span className="text-muted-foreground">个实体</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>已解析的实体总数</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 text-sm">
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{totalRelations.toLocaleString()}</span>
                    <span className="text-muted-foreground">条关系</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>已建立的人物关系数</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
            <Info className="h-3 w-3" />
            <span>数据由 AI 自动解析生成，可能存在误差，欢迎校对纠正</span>
          </div>
        </section>

        {/* 书库：标题行（含状态徽标）+ 响应式网格。 */}
        <section className="library-section p-6 md:p-8">
          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                书库
                <span className="text-sm font-normal text-muted-foreground">{books.length} 部典籍</span>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">点击书籍封面进入人物关系图谱</p>
            </div>

            <div className="flex items-center gap-3">
              <Badge variant="outline" className="px-3 py-1 font-normal">
                {completedBooks.length} 已完成
              </Badge>
              {pendingBooks.length > 0 && (
                <Badge variant="secondary" className="px-3 py-1 font-normal">
                  {pendingBooks.length} 解析中
                </Badge>
              )}
            </div>
          </div>

          <div className="library-grid grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 md:gap-6 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        </section>

        <footer className="mt-16 border-t border-border pt-8 text-center">
          <div className="mx-auto max-w-xl">
            <h3 className="mb-2 text-sm font-medium">关于文淵</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              「文淵」是一个非商业化的个人爱好项目，旨在利用 AI 技术构建中国古典文学的人物知识图谱。
              项目持续开发中，数据仅供研究与学习参考使用。
            </p>
            <div className="mt-4 text-xs text-muted-foreground/60">© 2024 Wen Yuan Project</div>
          </div>
        </footer>
      </div>
    </div>
  );
}
