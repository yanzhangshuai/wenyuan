"use client";

import { useEffect } from "react";

import { PageContainer } from "@/components/layout/page-header";
import { ErrorState } from "@/components/ui/states";
import { toErrorMessage } from "@/lib/errors";

/**
 * 图谱路由错误边界。
 *
 * 约束：
 * - App Router 要求 `error.tsx` 必须是 Client Component；
 * - 错误文案遵循 `error-api-message-first`：业务错误展示后端 message，其余用兜底文案，
 *   避免把堆栈或英文技术信息直接抛给用户；
 * - 只在控制台留档，不在边界内吞掉错误。
 */
export default function BookGraphError({
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
        title="图谱加载失败"
        description={toErrorMessage(error, "读取图谱数据时出现错误，请稍后重试。")}
        onRetry={reset}
      />
    </PageContainer>
  );
}
