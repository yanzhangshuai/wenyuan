"use client";

/**
 * =============================================================================
 * 文件定位（设计系统 - 通用状态视图）
 * -----------------------------------------------------------------------------
 * 文件路径：`src/components/ui/states.tsx`
 *
 * 组件职责：
 * - 提供统一空态、错误态、加载骨架屏组件；
 * - 让页面在 `empty/error/loading/success` 状态切换时保持一致的语义和视觉反馈。
 *
 * 业务意义：
 * - 状态组件是用户理解系统当前进度与可操作性的关键节点；
 * - 统一状态文案和按钮样式，有助于降低跨页面认知成本。
 *
 * 维护约束：
 * - 预置文案是业务语境的一部分，不建议随意替换为泛化文本；
 * - `onRetry` / `onAction` 等回调代表用户恢复路径，请确保交互链路可达。
 * =============================================================================
 */

import { 
  AlertCircle, 
  BookOpen, 
  FileQuestion, 
  Inbox, 
  RefreshCw, 
  Search,
  Users 
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ========================================
   Empty State
   ======================================== */

interface EmptyStateProps {
  /** 可选状态图标；未传时使用默认收纳盒图标。 */
  icon?       : React.ReactNode
  /** 状态标题，直接告诉用户“当前是什么状态”。 */
  title       : string
  /** 状态说明，补充下一步预期或原因。 */
  description?: string
  /** 可选主动作按钮（例如导入、创建、返回）。 */
  action?: {
    /** 按钮文案。 */
    label  : string
    /** 点击动作回调。 */
    onClick: () => void
  }
  /** 外层附加样式。 */
  className?: string
}

export function EmptyState({ 
  icon, 
  title, 
  description, 
  action,
  className 
}: EmptyStateProps) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center py-16 px-4 text-center",
      className
    )}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        {icon ?? <Inbox className="h-8 w-8 text-muted-foreground" />}
      </div>
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      {description && (
        // 描述可选：部分空态只需标题即可表达清楚，避免冗余文案。
        <p className="text-sm text-muted-foreground max-w-sm mb-4">{description}</p>
      )}
      {action && (
        <Button onClick={action.onClick} variant="outline" size="sm">
          {action.label}
        </Button>
      )}
    </div>
  );
}

// Preset empty states
export function EmptyBooks({ onAction }: { onAction?: () => void }) {
  return (
    <EmptyState
      icon={<BookOpen className="h-8 w-8 text-muted-foreground" />}
      title="暂无书籍"
      description="书库中还没有任何书籍，导入一本古典小说开始探索吧"
      action={onAction ? { label: "导入书籍", onClick: onAction } : undefined}
    />
  );
}

export function EmptyCharacters() {
  return (
    <EmptyState
      icon={<Users className="h-8 w-8 text-muted-foreground" />}
      title="暂无人物"
      description="该书籍尚未解析出任何人物数据"
    />
  );
}

export function EmptySearch({ query }: { query: string }) {
  return (
    <EmptyState
      icon={<Search className="h-8 w-8 text-muted-foreground" />}
      title="未找到结果"
      description={`没有找到与"${query}"相关的内容`}
    />
  );
}

export function EmptyReview() {
  return (
    <EmptyState
      icon={<FileQuestion className="h-8 w-8 text-muted-foreground" />}
      title="暂无待审核项"
      description="所有数据均已审核完成"
    />
  );
}

/* ========================================
   Error State
   ======================================== */

interface ErrorStateProps {
  /** 错误标题，默认提供通用“加载失败”。 */
  title?      : string
  /** 错误说明，默认给出可恢复预期。 */
  description?: string
  /** 可选重试动作；无重试场景时可省略。 */
  onRetry?    : () => void
  className?  : string
}

export function ErrorState({ 
  title = "加载失败", 
  description = "数据加载时出现错误，请稍后重试", 
  onRetry,
  className 
}: ErrorStateProps) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center py-16 px-4 text-center",
      className
    )}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 mb-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
      </div>
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-4">{description}</p>
      {onRetry && (
        // 仅在调用方提供恢复动作时展示按钮，避免“可点击但无效果”的伪交互。
        <Button onClick={onRetry} variant="outline" size="sm" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          重试
        </Button>
      )}
    </div>
  );
}

/* ========================================
   Loading Skeletons
   ======================================== */

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border bg-card p-4 space-y-3", className)}>
      <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
      <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
      <div className="h-3 w-2/3 bg-muted rounded animate-pulse" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  // 默认 5 行，兼顾首屏占位完整度与渲染成本。
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Header */}
      <div className="border-b bg-muted/30 px-4 py-3 flex gap-4">
        <div className="h-4 w-24 bg-muted rounded animate-pulse" />
        <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        <div className="h-4 w-20 bg-muted rounded animate-pulse" />
        <div className="h-4 w-16 bg-muted rounded animate-pulse ml-auto" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b last:border-0 px-4 py-3 flex gap-4 items-center">
          <div className="h-4 w-28 bg-muted rounded animate-pulse" />
          <div className="h-4 w-40 bg-muted rounded animate-pulse" />
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
          <div className="h-8 w-20 bg-muted rounded animate-pulse ml-auto" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  // 默认 3 行符合常见段落占位，调用方可按场景覆盖。
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div 
          key={i} 
          className="h-4 bg-muted rounded animate-pulse"
          style={{ width: `${[70, 85, 75, 90, 80][i % 5]}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonGraph() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative w-64 h-64">
        {/* Center node */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-muted animate-pulse" />
        {/* Surrounding nodes */}
        {[0, 60, 120, 180, 240, 300].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          const x = Math.cos(rad) * 80;
          const y = Math.sin(rad) * 80;
          return (
            <div
              key={angle}
              className="absolute w-10 h-10 rounded-full bg-muted animate-pulse"
              style={{
                top           : `calc(50% + ${y}px)`,
                left          : `calc(50% + ${x}px)`,
                transform     : "translate(-50%, -50%)",
                animationDelay: `${angle * 2}ms`
              }}
            />
          );
        })}
        {/* Loading text */}
        <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-sm text-muted-foreground">
          加载图谱中...
        </div>
      </div>
    </div>
  );
}

/**
 * 图谱页专用的骨架屏。
 *
 * 与 `SkeletonGraph` 的差异：后者依赖父级提供定位上下文，
 * 此处补齐相对定位容器与最小高度，使它可以被直接用作 `Suspense` 的 fallback。
 */
export function GraphSkeleton() {
  return (
    <div className="relative h-[70vh] min-h-[480px] rounded-lg border bg-card">
      <SkeletonGraph />
    </div>
  );
}
