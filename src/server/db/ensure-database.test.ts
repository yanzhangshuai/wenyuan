// @vitest-environment node
/**
 * `ensureDatabase` 集成测试。
 *
 * 为什么必须对着真实 PostgreSQL 测：
 * - 该模块的唯一职责是「库不存在就创建」，而 `CREATE DATABASE` 在
 *   PGlite 里**不可用**（PGlite 是单库实例，没有多数据库概念），
 *   所以不能像其他集成测试那样用 PGlite 代替；
 * - 因此这里用 `examples/docker-compose.yml` 起真实 PostgreSQL 时，
 *   走的是同一条 TCP 链路，行为与 `pnpm db:migrate` 完全一致。
 *
 * 跳过条件：未显式提供 `WENYUAN_TEST_DATABASE_URL` 时整体跳过。
 * 这样 CI 上无 Docker 也能保持全绿，而本机需要验证时只需导出该变量。
 *
 * 运行方式：
 *   WENYUAN_TEST_DATABASE_URL=postgres://plotweaver:plotweaver@127.0.0.1:5432/wenyuan_probe \
 *     pnpm vitest run src/server/db/ensure-database.test.ts
 */

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { ensureDatabase, resolveDatabaseName } from "./ensure-database";

/** 探针库连接串；未设置则跳过全部用例（PGlite 不支持 CREATE DATABASE）。 */
const PROBE_URL = process.env.WENYUAN_TEST_DATABASE_URL;

describe("resolveDatabaseName", () => {
  it("从连接串解析库名", () => {
    expect(resolveDatabaseName("postgres://u:p@127.0.0.1:5432/wenyuan_v3")).toBe("wenyuan_v3");
  });

  it("忽略查询参数并做 URL 解码", () => {
    expect(resolveDatabaseName("postgres://u:p@h:5/%E4%B8%AD%E6%96%87?sslmode=disable")).toBe("中文");
  });

  it("未指定库名时抛错", () => {
    expect(() => resolveDatabaseName("postgres://u:p@127.0.0.1:5432")).toThrow("未指定数据库名");
  });
});

describe.skipIf(!PROBE_URL)("ensureDatabase（需要真实 PostgreSQL）", () => {
  /** 每次运行使用独立库名，避免污染与并发冲突。 */
  const target = `${resolveDatabaseName(PROBE_URL ?? "postgres://u:p@h:5/x")}_probe`;

  /** 由 `target` 拼出的连接串。 */
  function targetUrl(): string {
    const url = new URL(PROBE_URL ?? "");
    url.pathname = `/${target}`;
    return url.toString();
  }

  /** 直接查 `pg_database`，绕开本模块自身以做独立断言。 */
  async function databaseExists(name: string): Promise<boolean> {
    const client = postgres(PROBE_URL ?? "", { max: 1 });
    try {
      const rows = await client<{ count: string }[]>`
        select count(*)::text as count from pg_database where datname = ${name}
      `;
      return rows[0]?.count !== "0";
    } finally {
      await client.end();
    }
  }

  it("库不存在时创建，再调用则报告已存在", async () => {
    expect(await databaseExists(target)).toBe(false);

    const first = await ensureDatabase(targetUrl());
    expect(first).toEqual({ database: target, created: true });
    expect(await databaseExists(target)).toBe(true);

    // 幂等：第二次必须走「已存在」分支，而不是抛 "already exists"。
    const second = await ensureDatabase(targetUrl());
    expect(second).toEqual({ database: target, created: false });
  });

  it("建出的库可直接承载迁移（CREATE SCHEMA 成功）", async () => {
    await ensureDatabase(targetUrl());
    const client = postgres(targetUrl(), { max: 1 });
    try {
      // 复刻 `drizzle-orm` 迁移器失败的那条语句。
      await client.unsafe('CREATE SCHEMA IF NOT EXISTS "drizzle"');
      const rows = await client<{ nspname: string }[]>`
        select nspname from pg_namespace where nspname = 'drizzle'
      `;
      expect(rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});
