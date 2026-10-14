import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ensureDatabase } from "@/server/db/ensure-database";
import { getServerEnv } from "@/server/env";

/**
 * 数据库迁移入口。
 *
 * 使用方式：
 * 1. `pnpm db:generate` 依据 schema 生成 SQL 到 `./drizzle`
 * 2. `pnpm db:migrate` 执行本文件：确保库存在 → 应用 SQL
 *
 * 为什么先建库：`psql` 的 `CREATE DATABASE` 不在迁移 SQL 里，
 * 而数据卷被复用（或 `POSTGRES_DB` 与 `DATABASE_URL` 不一致）时目标库并不存在，
 * 此时 `migrate()` 会在 `CREATE SCHEMA IF NOT EXISTS "drizzle"` 处失败。
 */
async function main(): Promise<void> {
  const { DATABASE_URL } = getServerEnv();

  const ensured = await ensureDatabase(DATABASE_URL);
  if (ensured.created) {
    console.log(`[migrate] 数据库 ${ensured.database} 不存在，已创建`);
  }

  // 迁移期间独占单连接：并发执行 DDL 会互相争锁，且 `CREATE SCHEMA` 不可重入。
  const client = postgres(DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("[migrate] 数据库结构已同步");
  } finally {
    await client.end();
  }
}

await main();
