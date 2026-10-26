import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { UserTable } from "@/components/admin/user-table";
import { listUsers } from "@/server/modules/auth/admin";
import { getAuthContext } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "用户 — 文渊管理" };

/**
 * 用户管理页（`/admin/users`）。
 *
 * 只做「改角色 / 停用」两件事 —— 新建账号走注册（`ALLOW_REGISTRATION` 控制是否开放）
 * 或 `pnpm db:seed`（建初始管理员）。密码重置暂不做：本期没有邮件通道，
 * 做出来也只能是「管理员看明文」这种不安全的形式。
 */
export default async function UsersPage(): Promise<React.ReactElement> {
  const auth = await getAuthContext();
  if (auth === null) redirect("/login");

  const users = await listUsers();
  const activeCount = users.filter((user) => user.isActive).length;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 py-8">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-semibold">用户</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          共 {users.length} 个账号（{activeCount} 个启用）。管理员可管理书籍与解析；
          查看者只能浏览图谱与提交反馈。
        </p>
      </div>

      <UserTable users={users} currentUserId={auth.id} />
    </div>
  );
}
