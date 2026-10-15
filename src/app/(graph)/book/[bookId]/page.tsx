import { notFound } from "next/navigation";
import { Suspense, use } from "react";

import { GraphView } from "@/components/graph/GraphView";
import { GraphSkeleton } from "@/components/ui/states";
import { loadGraphSnapshot } from "@/server/modules/graph/read-graph";

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

  return (
    <Suspense fallback={<GraphSkeleton />}>
      <GraphSection bookId={bookId} snapshotPromise={snapshotPromise} />
    </Suspense>
  );
}

interface GraphSectionProps {
  bookId         : string;
  snapshotPromise: ReturnType<typeof loadGraphSnapshot>;
}

/**
 * 图谱数据分区（服务端）。
 *
 * @param props 由页面创建的取数 Promise
 * @returns 图谱视图；作品不存在时抛 `notFound()`
 */
function GraphSection({ bookId, snapshotPromise }: GraphSectionProps) {
  const snapshot = use(snapshotPromise);

  if (snapshot === null) {
    notFound();
  }

  return <GraphView bookId={bookId} snapshot={snapshot} />;
}
