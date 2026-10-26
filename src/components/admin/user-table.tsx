"use client";

import { Loader2, ShieldCheck, ShieldOff, UserCheck, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AdminUserRow } from "@/server/modules/auth/admin";

/**
 * 用户管理表（Client Component）。
 *
 * 交互只做两件事：改角色、停用/启用。两者都由服务端护栏兜底
 * （不能动自己、不能没有管理员），这里禁用按钮只是提前告知。
 */

export interface UserTableProps {
  users        : AdminUserRow[];
  currentUserId: string;
}

/** 时间显示（本地化，只到分钟）。 */
function formatTime(iso: string | null): string {
  if (iso === null) return "从未登录";
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function UserTable({ users, currentUserId }: UserTableProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patch(id: string, body: { role?: "ADMIN" | "VIEWER"; isActive?: boolean }): Promise<void> {
    setBusyId(id);
    try {
      const response = await fetch(`/api/admin/users/${id}`, {
        method : "PATCH",
        headers: { "content-type": "application/json" },
        body   : JSON.stringify(body)
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok !== true) {
        toast.error(payload.message ?? "更新失败");
        return;
      }
      toast.success("已更新");
      router.refresh();
    } catch {
      toast.error("更新失败：网络异常");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr className="text-left">
            <th className="px-4 py-3 font-medium">用户</th>
            <th className="px-4 py-3 font-medium">角色</th>
            <th className="px-4 py-3 font-medium">状态</th>
            <th className="px-4 py-3 font-medium">最后登录</th>
            <th className="px-4 py-3 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            const isBusy = busyId === user.id;
            return (
              <tr key={user.id} className="border-t">
                <td className="px-4 py-3">
                  <div className="font-medium">
                    {user.name}
                    {isSelf ? <span className="text-muted-foreground ml-2 text-xs">（当前账号）</span> : null}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {user.email} · @{user.username}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={user.role === "ADMIN" ? "default" : "outline"}>
                    {user.role === "ADMIN" ? "管理员" : "查看者"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {user.isActive ? (
                    <span className="text-emerald-600">启用</span>
                  ) : (
                    <span className="text-muted-foreground">已停用</span>
                  )}
                </td>
                <td className="text-muted-foreground px-4 py-3 text-xs">{formatTime(user.lastLoginAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {isBusy ? <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" /> : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={isSelf || isBusy}
                      title={isSelf ? "不能修改自己的角色" : undefined}
                      onClick={() => {
                        void patch(user.id, { role: user.role === "ADMIN" ? "VIEWER" : "ADMIN" });
                      }}
                    >
                      {user.role === "ADMIN" ? (
                        <>
                          <ShieldOff className="h-3.5 w-3.5" />
                          降为查看者
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-3.5 w-3.5" />
                          设为管理员
                        </>
                      )}
                    </Button>
                    <Button
                      variant={user.isActive ? "outline" : "default"}
                      size="sm"
                      className="gap-1.5"
                      disabled={isSelf || isBusy}
                      title={isSelf ? "不能停用自己的账号" : undefined}
                      onClick={() => {
                        void patch(user.id, { isActive: !user.isActive });
                      }}
                    >
                      {user.isActive ? (
                        <>
                          <UserX className="h-3.5 w-3.5" />
                          停用
                        </>
                      ) : (
                        <>
                          <UserCheck className="h-3.5 w-3.5" />
                          启用
                        </>
                      )}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
