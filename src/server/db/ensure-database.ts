import postgres from "postgres";

/**
 * 确保目标数据库存在（不存在则创建）。
 *
 * 设计原因：
 * - `postgres:17-alpine` 只在**首次初始化数据卷**时执行 `POSTGRES_DB`。
 *   若数据卷是早先用另一套库名创建的，`docker compose up` 之后
 *   `POSTGRES_DB` 已被初始化逻辑跳过 —— 表现为 "database does not exist"，
 *   而容器本身却是健康的，排查方向极易被误导；
 * - `CREATE DATABASE` **不能**在事务中执行，也无法用 `IF NOT EXISTS`，
 *   因此必须在连到 `postgres` 维护库后先查 `pg_database` 再决定是否创建。
 *
 * 与 `pnpm db:migrate` 的分工：本模块只负责「库存在」，建表由迁移负责。
 */

/** `postgres.js` 的实例类型（迁移与建库各自持有独立连接）。 */
type Sql = ReturnType<typeof postgres>;

/** 建库结果，供调用方区分「已存在」与「新建」。 */
export interface EnsureDatabaseResult {
  database: string;
  created : boolean;
}

/**
 * 把连接串里的库名替换为 `postgres` 维护库，并去掉可能存在的查询参数。
 *
 * @param connectionString 原始连接串（形如 `postgres://user:pw@host:port/db`）
 * @returns 指向 `postgres` 库的连接串
 */
function toMaintenanceUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  url.search = "";
  return url.toString();
}

/**
 * 从连接串中解析库名。
 *
 * @param connectionString 原始连接串
 * @returns 库名
 * @throws 当连接串未指定库名时抛出
 */
export function resolveDatabaseName(connectionString: string): string {
  const name = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
  if (!name) {
    throw new Error("DATABASE_URL 未指定数据库名");
  }
  return name;
}

/**
 * 若目标库不存在则创建。
 *
 * @param connectionString 目标库的连接串
 * @returns 库名与是否新建
 */
export async function ensureDatabase(connectionString: string): Promise<EnsureDatabaseResult> {
  const database = resolveDatabaseName(connectionString);

  // 维护库连接：不做池化，用完即关。标识符无法参数化，故用 duckdb 风格的
  // 引号拼接 —— 库名已在 resolveDatabaseName 中取自 URL，此处再转义一次双引号。
  const client: Sql = postgres(toMaintenanceUrl(connectionString), { max: 1 });
  try {
    const existing = await client<{ count: string }[]>`
      select count(*)::text as count from pg_database where datname = ${database}
    `;
    if (existing[0]?.count !== "0") {
      return { database, created: false };
    }

    // CREATE DATABASE 不支持参数占位符，只能拼接；双引号按 SQL 规则转义。
    await client.unsafe(`CREATE DATABASE "${database.replaceAll("\"", "\"\"")}"`);
    return { database, created: true };
  } finally {
    await client.end();
  }
}
