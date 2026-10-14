"use client";

import { useEffect } from "react";

import { PageContainer } from "@/components/layout/page-header";
import { ErrorState } from "@/components/ui/states";

/**
 * 书库路由错误边界。
 *
 * 约束：
 * - Next.js 要求 `error.tsx` 必须是 Client Component；
 * - 只做「展示 + 重试」，不在边界内吞掉错误，保留控制台日志便于排查。
 */
export default function LibraryError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer>
      <ErrorState
        title="书库加载失败"
        description="读取书目数据时出现错误，请稍后重试。"
        onRetry={reset}
      />
    </PageContainer>
  );
}
