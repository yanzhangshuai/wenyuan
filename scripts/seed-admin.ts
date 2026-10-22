import { AUTH_ADMIN_ROLE } from "@/lib/auth";
import { ensureEnvLoaded } from "@/server/env";
import { seedAdminAccount } from "@/server/modules/auth/seed";

/**
 * 创建/重置管理员（`pnpm seed:admin`）。
 *
 * 用法：
 *   pnpm seed:admin --email admin@example.com --password '至少8位' [--name 管理员] [--username admin]
 *
 * 也可写进 `.env`（推荐）：`ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` / `ADMIN_USERNAME`。
 * 已存在同邮箱账号时**更新密码与角色**（生产找回访问权的标准路径），不新建重复账号。
 *
 * 完整种子数据请用 `pnpm db:seed`；本命令用于「只改管理员密码」。
 */

interface Options {
  email   : string | null;
  password: string | null;
  name    : string | null;
  username: string | null;
}

/** 解析命令行参数。 */
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
  // 同 `scripts/seed.ts`：先加载 `.env`，否则 `.env` 里的 ADMIN_* 读不到。
  ensureEnvLoaded();

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

  const outcome = await seedAdminAccount({ email, password, name, username });
  console.log(
    `[seed-admin] 已${outcome.action === "created" ? "创建" : "更新"}管理员：${outcome.email}（角色 ${AUTH_ADMIN_ROLE}）`
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
