import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/** 骨架占位标识：用稳定常量避免数组下标作为 key。 */
const PLACEHOLDER_IDS = ["slot-a", "slot-b", "slot-c"] as const;

/**
 * 书库首页加载态。
 *
 * 设计原因：
 * - 骨架数量固定为 3，与首版「单书为主」的信息密度匹配，避免大面积空骨架造成闪烁。
 */
export default function LibraryLoading() {
  return (
    <PageContainer>
      <PageHeader title="书库" description="正在读取书目…" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLACEHOLDER_IDS.map((id) => (
          <Skeleton key={id} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    </PageContainer>
  );
}
