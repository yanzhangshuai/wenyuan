import Link from "next/link";

import { PageContainer } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

/**
 * 全局 404 页面。
 *
 * 说明：未使用 `EmptyState`，因为其 action 需要传入函数，而本文件是 Server Component，
 * 无法向 Client Component 传递事件处理器；此处用 `Button asChild` + `Link` 表达同一语义。
 */
export default function NotFound() {
  return (
    <PageContainer>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="font-mono text-5xl font-semibold text-primary">404</p>
        <h1 className="mt-4 text-xl font-medium">页面不存在</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          你访问的页面已被移除，或从未存在。
        </p>
        <Button asChild variant="outline" size="sm" className="mt-6">
          <Link href="/">返回书库</Link>
        </Button>
      </div>
    </PageContainer>
  );
}
