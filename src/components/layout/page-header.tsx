import { cn } from "@/lib/utils";

/**
 * 文件定位（共享布局基础组件）：
 * - 文件路径：`src/components/layout/page-header.tsx`
 * - 所属层：前端展示层 / 通用布局组件层。
 *
 * 核心职责：
 * - 提供管理端与阅读端复用的页面基础结构组件：
 *   1) `PageHeader`：页标题区（标题、描述、面包屑、右侧操作区）；
 *   2) `PageContainer`：统一内容宽度与外边距；
 *   3) `PageSection`：页面内分区块（标题、副标题、操作插槽、正文）。
 *
 * 与 Next.js / React 的关系：
 * - 本文件未声明 `"use client"`，默认可被 Server Component 直接使用；
 * - 同时也可被 Client Component 引用，因为内部不依赖 Node 专属 API 或服务端能力；
 * - 组件本身无状态、无副作用，属于纯展示型函数组件，渲染结果完全由 props 决定。
 *
 * 维护注意：
 * - 该文件是“页面骨架语义”的统一入口，修改 class 可能影响全站大量页面视觉一致性；
 * - 面包屑当前使用原生 `<a>`，会触发完整页面跳转，这是现有行为约定，改为 `next/link` 前需评估使用场景。
 */

/**
 * 面包屑项定义。
 */
interface BreadcrumbItem {
  /**
   * 展示文本：
   * - 用于告知用户当前层级节点名称。
   */
  label: string;
  /**
   * 可选跳转地址：
   * - 有值：渲染为可点击链接；
   * - 无值：表示当前页节点，仅展示文本不跳转。
   */
  href?: string;
}

interface PageHeaderProps {
  /** 页面主标题：通常对应业务模块名称。 */
  title       : string;
  /** 页面副标题：用于解释当前页面的业务目标或操作提示。 */
  description?: string;
  /** 头部右侧操作区插槽：常放按钮组（新增、导出、刷新等）。 */
  children?   : React.ReactNode;
  /** 额外样式类：用于调用方按场景扩展间距或对齐。 */
  className?  : string;
  /** 面包屑数据：用于跨层级导航与当前位置提示。 */
  breadcrumbs?: BreadcrumbItem[];
}

/**
 * 页面头部组件（展示型组件）。
 *
 * 业务语义：
 * - 统一页面标题区域结构，减少各页面重复实现；
 * - 通过可选面包屑与操作插槽，兼顾“定位”和“操作入口”。
 *
 * @param props 页面头部配置
 * @returns 头部区域 JSX
 */
export function PageHeader({
  title,
  description,
  children,
  className,
  breadcrumbs
}: PageHeaderProps) {
  return (
    <div className={cn("mb-8", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        /*
         * 分支原因：
         * - 只有在调用方显式传入面包屑且至少 1 项时才渲染导航条；
         * - 避免空容器占位影响页面垂直节奏。
         */
        <nav className="mb-4 text-sm text-muted-foreground">
          {breadcrumbs.map((crumb, i) => (
            <span key={i}>
              {crumb.href ? (
                /*
                 * 有 href：表示可回退路径，渲染为链接。
                 * 当前使用 `<a>` 是项目既有行为，适合管理后台“确定性跳转”场景。
                 */
                <a href={crumb.href} className="hover:text-foreground transition-colors">
                  {crumb.label}
                </a>
              ) : (
                // 无 href：表示当前层级，仅做文本高亮，不可点击。
                <span className="text-foreground">{crumb.label}</span>
              )}
              {i < breadcrumbs.length - 1 && (
                // 分隔符只出现在非最后一个节点后，避免尾部多余符号。
                <span className="mx-2">/</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          {description && (
            // 副标题可选：不是每个页面都需要说明文案，按需显示可减少信息噪声。
            <p className="mt-2 text-muted-foreground max-w-2xl">{description}</p>
          )}
        </div>
        {children && (
          // 操作区可选：仅在调用方提供操作节点时渲染右侧容器。
          <div className="flex items-center gap-2 shrink-0">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

interface PageContainerProps {
  /** 页面主体内容。 */
  children  : React.ReactNode;
  /** 自定义 className，允许页面按需追加布局样式。 */
  className?: string;
  /**
   * 是否全宽显示：
   * - false/undefined：使用统一最大宽度，保证阅读舒适度；
   * - true：取消 max-width，适合表格或大屏画布场景。
   */
  fullWidth?: boolean;
}

/**
 * 页面容器组件（展示型组件）。
 *
 * 业务语义：
 * - 统一横向留白与纵向间距，避免不同页面出现“边距风格漂移”；
 * - 通过 `fullWidth` 兼容高密度后台页面。
 */
export function PageContainer({ children, className, fullWidth }: PageContainerProps) {
  return (
    <div className={cn(
      "mx-auto px-6 py-8",
      // 默认限制最大宽度，保障大屏可读性；仅在调用方明确需要时放开。
      !fullWidth && "max-w-[1440px]",
      className
    )}>
      {children}
    </div>
  );
}

interface PageSectionProps {
  /** 分区标题（可选）。 */
  title?      : string;
  /** 分区说明文案（可选）。 */
  description?: string;
  /** 分区正文内容。 */
  children    : React.ReactNode;
  /** 额外样式类。 */
  className?  : string;
  /** 右上角操作区插槽（如“查看全部”“新增”按钮）。 */
  action?     : React.ReactNode;
}

/**
 * 页面分区组件（展示型组件）。
 *
 * 业务语义：
 * - 将长页面拆成语义化区块，帮助用户快速扫描信息层次；
 * - 可选 `title/description/action` 使同一组件适配“有头部”和“纯内容”两类区域。
 */
export function PageSection({
  title,
  description,
  children,
  className,
  action
}: PageSectionProps) {
  // 分区头部按需渲染：没有标题也没有操作时，直接输出正文，避免无意义结构。
  const hasSectionHeader = Boolean(title) || Boolean(action);

  return (
    <section className={cn("mb-8", className)}>
      {hasSectionHeader && (
        <div className="flex items-center justify-between mb-4">
          <div>
            {title && (
              <h2 className="text-lg font-medium">{title}</h2>
            )}
            {description && (
              // 仅在有标题语境下展示补充说明，帮助解释该区块承载的业务内容。
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
