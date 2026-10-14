import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { GraphSkeleton } from "@/components/ui/states";

/**
 * 图谱路由段的加载态。
 *
 * 设计原因（`data-route-loading`）：路由段切换属于导航级等待，
 * 应由 `loading.tsx` 承担，而不是在页面里用 `useState` 造全屏 spinner。
 * 骨架屏复用页面本身的容器与页头结构，避免加载完成时布局跳动。
 */
export default function BookGraphLoading() {
  return (
    <PageContainer fullWidth>
      <PageHeader
        title="人物关系图谱"
        description="节点大小代表关联人物数量，连线颜色代表关系类别。点击节点查看该实体的关系与原文依据。"
        breadcrumbs={[{ label: "书库", href: "/" }, { label: "关系图谱" }]}
      />
      <GraphSkeleton />
    </PageContainer>
  );
}
