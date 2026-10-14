import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getServerEnv } from "@/server/env";

import * as schema from "./schema";

/**
 * 数据库客户端。
 *
 * 设计原因：
 * - 惰性初始化：模块被导入时不建立连接，避免构建期（`next build`）因缺少
 *   `DATABASE_URL` 而失败；
 * - 进程内单例：`postgres` 自带连接池，重复实例化会成倍消耗连接数。
 */

/** Drizzle 实例类型，供 service 层标注返回值。 */
export type Database = ReturnType<typeof createDatabase>;

function createDatabase(connectionString: string): ReturnType<typeof drizzle<typeof schema>> {
  const client = postgres(connectionString, {
    max            : 10,
    idle_timeout   : 20,
    connect_timeout: 10
  });
  return drizzle(client, { schema });
}

let database: Database | null = null;

/**
 * 获取进程内唯一的数据库实例。
 *
 * @returns Drizzle 实例
 * @throws 当 `DATABASE_URL` 缺失时抛出（由 `getServerEnv` 校验）
 */
export function getDatabase(): Database {
  if (database) {
    return database;
  }
  database = createDatabase(getServerEnv().DATABASE_URL);
  return database;
}
