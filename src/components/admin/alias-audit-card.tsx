"use client";

import { EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AliasAuditRow } from "@/server/modules/admin/books-query";

/**
 * 别名体检卡片（Client Component）。
 *
 * 两个作用：
 * 1. **定位**：别名特别多的实体通常是错并（实测儒林 `姑丈` 7 个、红楼 `二姨` 12 个）；
 * 2. **处置**：对「根本不该存在的实体」直接写覆盖层隐藏 —— 这是少数能一键生效的操作之一。
 *
 * ⚠️ 「隐藏」是**覆盖层**，不是删除：图谱表原样保留，重跑解析后实体还在，
 * 覆盖依然生效（按规范名匹配）。确认框里必须说清这一点，否则用户会以为删掉了。
 */

export interface AliasAuditCardProps {
  bookId      : string;
  rows        : AliasAuditRow[];
  /** 在别名组里的名字（决定能否跳到配置页定位）。 */
  groupMembers: string[];
  className?  : string;
}

export function AliasAuditCard({ bookId, rows, groupMembers, className }: AliasAuditCardProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const inGroup = new Set(groupMembers);

  async function hideEntity(row: AliasAuditRow): Promise<void> {
    const confirmed = window.confirm(
      `隐藏「${row.canonical}」？\n\n` +
        "它会在图谱里消失，但**不删除任何数据**：解析结果原样保留，重跑后依然生效。\n" +
        "（想恢复的话，删掉 graph_overrides 里对应的记录即可。）"
    );
    if (!confirmed) return;

    setBusyId(row.entityId);
    try {
      const response = await fetch(`/api/admin/books/${bookId}/overrides`, {
        method : "POST",
        headers: { "content-type": "application/json" },
        body   : JSON.stringify({ targetName: row.canonical, payload: { kind: "hide_entity" } })
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok !== true) {
        toast.error(payload.message ?? "隐藏失败");
        return;
      }
      toast.success(`已隐藏「${row.canonical}」`, { description: "刷新图谱即可看到效果" });
      router.refresh();
    } catch {
      toast.error("隐藏失败：网络异常");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">别名体检</CardTitle>
        <CardDescription>
          别名特别多的实体，通常是错并 —— 把泛称或别人的称谓并了进来。按别名数排序，前几个最可疑。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => {
          const isBusy = busyId === row.entityId;
          const canLocate = inGroup.has(row.canonical);
          return (
            <div key={row.entityId} className="flex flex-wrap items-baseline gap-2 text-sm">
              {canLocate ? (
                <a
                  href={`#alias-${encodeURIComponent(row.canonical)}`}
                  className="hover:text-primary font-medium underline-offset-2 hover:underline"
                  title="点击定位到上方的别名组"
                >
                  {row.canonical}
                </a>
              ) : (
                <span className="font-medium" title="不在别名组里：错并来自抽取阶段，改配置修不了">
                  {row.canonical}
                  <span className="text-muted-foreground ml-1 text-[10px]">（不在组里）</span>
                </span>
              )}
              <Badge variant={row.aliases.length >= 8 ? "destructive" : "secondary"}>
                {row.aliases.length} 个
              </Badge>
              <span className="text-muted-foreground text-xs">
                {row.aliases.slice(0, 8).join(" / ")}
                {row.aliases.length > 8 ? ` …还有 ${String(row.aliases.length - 8)} 个` : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive ml-auto h-6 gap-1 px-1.5 text-[11px]"
                onClick={() => {
                  void hideEntity(row);
                }}
                disabled={isBusy}
                title="这个实体不该存在？在图谱里隐藏它（可恢复）"
              >
                {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
                隐藏
              </Button>
            </div>
          );
        })}
        <p className="text-muted-foreground border-t pt-2 text-xs">
          ⚠️ 别名 ≥ 8 个通常意味着错并。点名字可定位到上方的别名组（若它在组里）；
          「隐藏」只影响图谱显示，不删数据、重跑后仍生效。
        </p>
      </CardContent>
    </Card>
  );
}
