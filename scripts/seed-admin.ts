import { eq } from "drizzle-orm";

import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { hashPassword } from "@/server/modules/auth/password";

/**
 * 创建/更新管理员账号（幂等）。
 *
 * 用法：
 *   pnpm seed:admin --email admin@example.com --password '至少8位' --name 管理员
 *
 * 也可用环境变量：`ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`。
 * 已存在同邮箱账号时**更新密码与角色**（便于找回访问权），不新建重复账号。
 */

interface Options {
  email   : string | null;
  password: string | null;
  name    : string | null;
  username: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { email: null, password: null, name: null, username: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1] ?? null;
    if (arg === "--email") options.email = next;
    if (arg === "--password") options.password = next;
    if (arg === "--name") options.name = next;
    if (arg === "--username") options.username = next;
  }
  return options;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const email = (cli.email ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = cli.password ?? process.env.ADMIN_PASSWORD ?? "";
  const name = (cli.name ?? process.env.ADMIN_NAME ?? "管理员").trim();
  const username = (cli.username ?? process.env.ADMIN_USERNAME ?? "admin").trim();

  if (email.length === 0 || password.length === 0) {
    console.error("[seed-admin] 需要 --email 与 --password（或 ADMIN_EMAIL / ADMIN_PASSWORD）");
    process.exitCode = 2;
    return;
  }
  if (password.length < 8) {
    console.error("[seed-admin] 密码至少 8 位");
    process.exitCode = 2;
    return;
  }

  const db = getDatabase();
  const passwordHash = await hashPassword(password);

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    const id = existing[0]?.id;
    if (id === undefined) return;
    await db
      .update(users)
      .set({
        passwordHash,
        name,
        role     : AUTH_ADMIN_ROLE,
        isActive : true,
        updatedAt: new Date()
      })
      .where(eq(users.id, id));
    console.log(`[seed-admin] 已更新管理员：${email}`);
    return;
  }

  await db.insert(users).values({
    email,
    username,
    name,
    passwordHash,
    role    : AUTH_ADMIN_ROLE,
    isActive: true
  });
  console.log(`[seed-admin] 已创建管理员：${email}（用户名 ${username}）`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
