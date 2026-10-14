import { notFound } from "next/navigation";
import { Suspense, use } from "react";


import { GraphView } from "@/components/graph/GraphView";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { GraphSkeleton } from "@/components/ui/states";
import { loadGraphSnapshot } from "@/server/modules/graph/read-graph";

/**
 * 作品人物关系图谱页。
 *
 * RSC 边界设计（遵循 `rsc-default-server` 与 `data-render-reads-use`）：
 * - 本文件是 Server Component，负责 `await params` 并创建取数 Promise；
 * - `GraphSection` 同样在服务端执行，用 `use()` 解包 Promise 并交给 Suspense；
 * - 只有真正需要交互的 `GraphView` 及其子组件才标记 `"use client"`。
 *
 * 为什么不直接 `await`：把 `await` 放在 `GraphSection` 里会让整个页面段阻塞在取数上；
 * 拆出 Promise + Suspense 后，页头与骨架屏可以先到达浏览器。
 */

interface WorkGraphPageProps {
  params: Promise<{ workId: string }>;
}

export default async function WorkGraphPage({ params }: WorkGraphPageProps) {
  const { workId } = await params;

  // Promise 在此创建、在 GraphSection 内消费 —— 服务端组件不会重渲染，因此不会重复请求。
  const snapshotPromise = loadGraphSnapshot(workId);

  return (
    <PageContainer fullWidth>
      <PageHeader
        title="人物关系图谱"
        description="节点大小代表关联人物数量，连线颜色代表关系类别。点击节点查看该实体的关系与原文依据。"
        breadcrumbs={[{ label: "书库", href: "/" }, { label: "关系图谱" }]}
      />
      <Suspense fallback={<GraphSkeleton />}>
        <GraphSection snapshotPromise={snapshotPromise} />
      </Suspense>
    </PageContainer>
  );
}

interface GraphSectionProps {
  snapshotPromise: ReturnType<typeof loadGraphSnapshot>;
}

/**
 * 图谱数据分区（服务端）。
 *
 * @param props 由页面创建的取数 Promise
 * @returns 图谱视图；作品不存在时抛 `notFound()`
 */
function GraphSection({ snapshotPromise }: GraphSectionProps) {
  const snapshot = use(snapshotPromise);

  if (snapshot === null) {
    notFound();
  }

  return <GraphView snapshot={snapshot} />;
}
