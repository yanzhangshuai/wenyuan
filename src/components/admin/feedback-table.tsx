"use client";

import { Check, ExternalLink, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FeedbackRow } from "@/server/modules/feedback/service";

/**
 * 反馈队列（Client Component）。
 *
 * 每条只给两个动作：接受 / 拒绝。**不做「一键改配置」** ——
 * 配置修改仍走配置页的显式保存，这样「谁改了什么」有明确操作记录，
 * 而不是被一条反馈悄悄触发。
 */

export interface FeedbackTableProps {
  rows: FeedbackRow[];
}

/** 类型 → 中文标签。 */
const KIND_LABELS: Record<string, string> = {
  wrong_merge   : "错并",
  missing_entity: "漏人",
  wrong_type    : "类型错",
  missing_alias : "缺别名"
};

/** 载荷 → 一句话摘要（管理员一眼看懂要改什么）。 */
function summarize(row: FeedbackRow): string {
  const payload = row.payload;
  switch (payload.kind) {
    case "wrong_merge":
      return payload.names.join(" ≠ ");
    case "missing_entity":
      return `漏了「${payload.name}」${payload.chapterHint === undefined ? "" : `（${payload.chapterHint}）`}`;
    case "wrong_type":
      return `「${payload.name}」应为 ${payload.expectedType}`;
    case "missing_alias":
      return `「${payload.name}」还叫「${payload.alias}」`;
    default:
      return "";
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function FeedbackTable({ rows }: FeedbackTableProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function resolve(id: string, status: "accepted" | "rejected"): Promise<void> {
    setBusyId(id);
    try {
      const response = await fetch(`/api/admin/feedback/${id}`, {
        method : "PATCH",
        headers: { "content-type": "application/json" },
        body   : JSON.stringify({ status, note: notes[id] ?? "" })
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok !== true) {
        toast.error(payload.message ?? "处理失败");
        return;
      }
      toast.success(status === "accepted" ? "已接受，记得去配置页改" : "已拒绝");
      router.refresh();
    } catch {
      toast.error("处理失败：网络异常");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        暂无待处理反馈。读者在图谱里标记的问题会出现在这里。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const isBusy = busyId === row.id;
        return (
          <div key={row.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={row.kind === "wrong_merge" ? "destructive" : "secondary"}>
                {KIND_LABELS[row.kind] ?? row.kind}
              </Badge>
              <span className="font-medium">{summarize(row)}</span>
              <Link
                href={`/admin/books/${row.bookId}`}
                className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-xs"
              >
                《{row.bookTitle}》
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>

            <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-3 text-xs">
              <span>{row.submittedName}</span>
              <span>{formatTime(row.createdAt)}</span>
              {row.status === "pending" ? null : (
                <Badge variant="outline">{row.status === "accepted" ? "已接受" : "已拒绝"}</Badge>
              )}
            </div>

            {row.status === "pending" ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 max-w-xs text-xs"
                  placeholder="备注（可选，接受时写改了什么）"
                  value={notes[row.id] ?? ""}
                  onChange={(event) => {
                    setNotes((prev) => ({ ...prev, [row.id]: event.target.value }));
                  }}
                  disabled={isBusy}
                />
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    void resolve(row.id, "accepted");
                  }}
                  disabled={isBusy}
                >
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  接受
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    void resolve(row.id, "rejected");
                  }}
                  disabled={isBusy}
                >
                  <X className="h-3.5 w-3.5" />
                  拒绝
                </Button>
              </div>
            ) : row.note === null ? null : (
              <p className="text-muted-foreground mt-2 text-xs">备注：{row.note}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
