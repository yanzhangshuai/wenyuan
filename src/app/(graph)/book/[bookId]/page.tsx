import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense, use } from "react";

import { GraphView } from "@/components/graph/GraphView";
import { GraphSkeleton } from "@/components/ui/states";
import { loadGraphSnapshot } from "@/server/modules/graph/read-graph";
import { loadExternalKnowledgeForBook } from "@/server/modules/graph/read-knowledge";
import { loadUncertainty } from "@/server/modules/graph/read-uncertainty";
import { getAuthContext } from "@/server/modules/auth/session";

/**
 * 作品人物关系图谱页（`(graph)` 路由组 —— 沉浸式全屏，无全局顶栏）。
 *
 * RSC 边界设计（遵循 `rsc-default-server` 与 `data-render-reads-use`）：
 * - 本文件是 Server Component，负责 `await params` 并创建取数 Promise；
 * - `GraphSection` 同样在服务端执行，用 `use()` 解包 Promise 并交给 Suspense；
 * - 只有真正需要交互的 `GraphView` 及其子组件才标记 `"use client"`。
 *
 * 为什么不直接 `await`：把 `await` 放在 `GraphSection` 里会让整个页面段阻塞在取数上；
 * 拆出 Promise + Suspense 后，页头与骨架屏可以先到达浏览器。
 *
 * 版式说明（对齐 v1）：
 * - 本路由组不渲染 `ViewerHeader`，顶部**只有图谱自身的信息头一层**；
 * - 高度由 `(graph)/layout.tsx` 的 `h-dvh` 提供，画布铺满剩余视口。
 */

interface BookGraphPageProps {
  params: Promise<{ bookId: string }>;
}

export default async function BookGraphPage({ params }: BookGraphPageProps) {
  const { bookId } = await params;

  // Promise 在此创建、在 GraphSection 内消费 —— 服务端组件不会重渲染，因此不会重复请求。
  const snapshotPromise = loadGraphSnapshot(bookId);
  // 不确定性报告（设计文档 §5.3）：与 snapshot **并列**下发，读时派生、不写图谱表。
  const uncertaintyPromise = loadUncertainty(bookId);
  // 外部知识（三期判定层）：独立表、读时叠加，**不合并进 snapshot**（UI 分区展示）。
  const knowledgePromise = loadExternalKnowledgeForBook(bookId);
  // 导出需要登录（接口会校验），未登录就不渲染入口 —— 避免点了才报 401。
  const auth = await getAuthContext();

  return (
    <>
      <Suspense fallback={<GraphSkeleton />}>
        <GraphSection
          bookId={bookId}
          snapshotPromise={snapshotPromise}
          uncertaintyPromise={uncertaintyPromise}
          knowledgePromise={knowledgePromise}
        />
      </Suspense>
      {auth === null ? null : <ExportFab bookId={bookId} />}
    </>
  );
}

interface GraphSectionProps {
  bookId            : string;
  snapshotPromise   : ReturnType<typeof loadGraphSnapshot>;
  uncertaintyPromise: ReturnType<typeof loadUncertainty>;
  knowledgePromise  : ReturnType<typeof loadExternalKnowledgeForBook>;
}

/**
 * 图谱数据分区（服务端）。
 *
 * @param props 由页面创建的取数 Promise
 * @returns 图谱视图；作品不存在时抛 `notFound()`
 */
function GraphSection({ bookId, snapshotPromise, uncertaintyPromise, knowledgePromise }: GraphSectionProps) {
  const snapshot = use(snapshotPromise);
  const uncertainty = use(uncertaintyPromise);
  const externalKnowledge = use(knowledgePromise);

  if (snapshot === null) {
    notFound();
  }

  return (
    <GraphView
      bookId={bookId}
      snapshot={snapshot}
      uncertainty={uncertainty}
      externalKnowledge={externalKnowledge}
    />
  );
}

/**
 * 导出入口（服务端渲染，右下角浮动）。
 *
 * 为什么不做进图谱工具栏：工具栏是客户端组件（`GraphView` 内部），
 * 加一个纯链接的入口不值得把 `GraphView` 的 props 再扩一层。
 * 浮动面板用 `fixed` 定位，不受 `GraphLayout` 的 `overflow-hidden` 影响。
 */
function ExportFab({ bookId }: { bookId: string }) {
  const items = [
    { type: "entities", label: "实体 CSV" },
    { type: "relationships", label: "关系 CSV" },
    { type: "json", label: "JSON" }
  ] as const;

  return (
    <div className="border-border/60 bg-background/90 fixed right-4 bottom-4 z-40 flex items-center gap-0.5 rounded-lg border p-1 shadow-lg backdrop-blur">
      <span className="text-muted-foreground px-2 text-[11px]">导出</span>
      {items.map((item) => (
        <a
          key={item.type}
          href={`/api/books/${bookId}/export?type=${item.type}`}
          download
          className="hover:bg-muted flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors"
        >
          <Download className="h-3 w-3" />
          {item.label}
        </a>
      ))}
    </div>
  );
}
