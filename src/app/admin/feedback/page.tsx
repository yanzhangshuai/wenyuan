import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FeedbackTable } from "@/components/admin/feedback-table";
import { listFeedback } from "@/server/modules/feedback/service";
import { getAuthContext } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "反馈 — 文渊管理" };

/**
 * 反馈队列（`/admin/feedback`）。
 *
 * 只列 `pending`。已处理的不在这里 —— 需要查历史时走接口
 * `GET /api/admin/feedback?status=accepted`。
 */
export default async function FeedbackPage(): Promise<React.ReactElement> {
  const auth = await getAuthContext();
  if (auth === null) redirect("/login");

  const pending = await listFeedback({ status: "pending" });

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-semibold">反馈</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          读者在图谱里标记的问题。共 {pending.length} 条待处理。
          接受只是记账，配置仍要在书籍详情页手动改 —— 这样每一步改动都有明确的操作人。
        </p>
      </div>

      <FeedbackTable rows={pending} />
    </div>
  );
}
