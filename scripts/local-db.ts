// 仅本机开发使用的零依赖数据库：在内核分配的端口上起一个 PGlite（WASM 版真实 PostgreSQL 17）实例。
// 这不是生产路径 —— 生产用 docker compose；本脚本存在的意义是「本机没装 Docker 也能跑通迁移与管线」。
// 用法：pnpm db:local   （前台常驻，Ctrl+C 停止；连接串打印在 stdout）

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

/** 数据目录：与项目同级的本地目录，可删除以重置数据库。 */
const DATA_DIR = process.env.PGLITE_DATA_DIR ?? "data/pglite";

/** 监听端口；默认对齐 `.env` 的 5432。 */
const PORT = Number(process.env.PGLITE_PORT ?? "5432");

const db = new PGlite(DATA_DIR);
await db.waitReady;

const server = new PGLiteSocketServer({
  db,
  port          : PORT,
  host          : "127.0.0.1",
  maxConnections: 10
});

await server.start();

console.log("[db:local] PGlite 已启动");
console.log(`[db:local] 数据目录: ${DATA_DIR}`);
console.log(
  `[db:local] 连接串(DATABASE_URL): postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`
);
console.log("[db:local] Ctrl+C 停止。使用前请把上面这行写入 .env");

/** 优雅退出：停服务并落盘。 */
async function shutdown(): Promise<void> {
  console.log("\n[db:local] 正在停止…");
  await server.stop();
  await db.close();
  process.exit(0);
}

/** 信号处理器只接同步函数，避免 eslint 的 no-misused-promises。 */
function handleSignal(): void {
  void shutdown();
}

process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);
