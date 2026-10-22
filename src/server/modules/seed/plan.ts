/**
 * 种子数据的**纯函数**决策层（无 IO，可单测）。
 *
 * 为什么单独一层：种子命令要在生产环境跑，最容易出错的地方不是 SQL，
 * 而是「配置缺一半」「密码太短」「显式跳过」这些分支。把这些判断做成纯函数，
 * 就能在不连库的情况下覆盖全部分支。
 */

/** 管理员种子配置。 */
export interface SeedAdminInput {
  email   : string;
  password: string;
  name    : string;
  username: string;
}

/** 执行计划。 */
export interface SeedPlan {
  /** 只检查不写入。 */
  dryRun       : boolean;
  /** 是否同步关系类型字典（总是 true，保留字段便于将来扩展）。 */
  relationTypes: boolean;
  /** 管理员配置；`null` 表示本次跳过。 */
  admin        : SeedAdminInput | null;
  /** 跳过管理员的原因（用于输出，不是错误）。 */
  adminSkipReason: string | null;
  /** 配置错误（非空则命令以退出码 2 结束，且**不执行任何写入**）。 */
  errors       : string[];
}

/** 密码最小长度（与注册校验保持一致）。 */
const PASSWORD_MIN_LENGTH = 8;

/** 邮箱格式（与 `@/lib/auth` 同规则，避免脚本与运行时口径漂移）。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/**
 * 解析命令行与环境变量，得到执行计划。
 *
 * 规则：
 * 1. `--dry-run` 只检查；
 * 2. `--skip-admin` 显式跳过管理员；
 * 3. `ADMIN_EMAIL` + `ADMIN_PASSWORD` 齐全 → 建/更新管理员；
 * 4. 只给其中一个 → **报错**（半个配置比没有配置更危险，容易被误认为已建号）；
 * 5. 密码不足 8 位 / 邮箱非法 → 报错。
 *
 * @param argv 进程参数（不含 node 与脚本路径）
 * @param env 环境变量
 * @returns 执行计划
 */
export function resolveSeedPlan(
  argv: readonly string[],
  env: Record<string, string | undefined>
): SeedPlan {
  const dryRun = argv.includes("--dry-run");
  const skipAdmin = argv.includes("--skip-admin");

  const email = (env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = env.ADMIN_PASSWORD ?? "";
  const name = (env.ADMIN_NAME ?? "管理员").trim();
  const username = (env.ADMIN_USERNAME ?? "admin").trim();

  const errors: string[] = [];

  if (skipAdmin) {
    return {
      dryRun,
      relationTypes   : true,
      admin           : null,
      adminSkipReason : "已指定 --skip-admin",
      errors
    };
  }

  const hasEmail = email.length > 0;
  const hasPassword = password.length > 0;

  if (!hasEmail && !hasPassword) {
    return {
      dryRun,
      relationTypes   : true,
      admin           : null,
      adminSkipReason : "未设置 ADMIN_EMAIL / ADMIN_PASSWORD（仅同步关系类型字典）",
      errors
    };
  }

  if (hasEmail !== hasPassword) {
    errors.push("ADMIN_EMAIL 与 ADMIN_PASSWORD 必须同时提供（当前只给了一个）");
    return { dryRun, relationTypes: true, admin: null, adminSkipReason: null, errors };
  }

  if (!EMAIL_PATTERN.test(email)) {
    errors.push(`ADMIN_EMAIL 格式不正确：${email}`);
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`ADMIN_PASSWORD 至少 ${String(PASSWORD_MIN_LENGTH)} 位`);
  }

  if (errors.length > 0) {
    return { dryRun, relationTypes: true, admin: null, adminSkipReason: null, errors };
  }

  return {
    dryRun,
    relationTypes   : true,
    admin           : { email, password, name, username },
    adminSkipReason : null,
    errors
  };
}

/**
 * 把数据库连接串转成**可安全打印**的摘要（隐藏账号密码）。
 *
 * 生产环境日志里绝不能出现完整连接串；这里只保留「主机:端口/库名」。
 *
 * @param url 连接串
 * @returns 形如 `db.internal:5432/wenyuan_v3`；无法解析时返回 `(无法解析)`
 */
export function describeDatabaseUrl(url: string | undefined): string {
  if (typeof url !== "string" || url.length === 0) return "(未设置 DATABASE_URL)";
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//u, "");
    return `${parsed.hostname}:${parsed.port.length > 0 ? parsed.port : "5432"}/${database}`;
  } catch {
    return "(无法解析)";
  }
}
