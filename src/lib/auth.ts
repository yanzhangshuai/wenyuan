/**
 * 鉴权共享常量与纯函数（前后端共用，**不得 import server-only**）。
 *
 * 设计原因：
 * - 角色取值同时被 Drizzle 枚举、Zod 校验、Cookie 校验与 UI 文案消费，集中一处避免漂移；
 * - `sanitizeRedirectPath` 是登录安全边界，必须能在 Edge 中间件里运行，因此保持纯函数、零依赖。
 */

/** 系统角色（与数据库枚举 `app_role` 严格一致）。 */
export const AUTH_ROLES = ["ADMIN", "VIEWER"] as const;

/** 角色类型。 */
export type AuthRole = (typeof AUTH_ROLES)[number];

/** 管理员角色（后台唯一可写角色）。 */
export const AUTH_ADMIN_ROLE: AuthRole = "ADMIN";

/** 只读角色（自助注册的默认角色）。 */
export const AUTH_VIEWER_ROLE: AuthRole = "VIEWER";

/** 会话 Cookie 名。 */
export const AUTH_COOKIE_NAME = "wenyuan_session";

/** 令牌有效期（秒）：7 天。 */
export const AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

/** 角色中文名（UI 与审计日志共用）。 */
export const AUTH_ROLE_LABELS: Record<AuthRole, string> = {
  ADMIN : "管理员",
  VIEWER: "用户"
};

/** 是否管理员。 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === AUTH_ADMIN_ROLE;
}

/** 管理员登录后的默认落点。 */
export const AUTH_DEFAULT_REDIRECT = "/admin";

/** 普通用户登录后的默认落点（书库首页）。 */
export const AUTH_USER_HOME = "/";

/**
 * 按角色给出登录后的默认落点。
 *
 * 管理员进后台，普通用户进前台书库——两者看到的是完全不同的界面，
 * 因此不能共用一个默认值。
 *
 * @param role 角色
 * @returns 默认路径
 */
export function defaultRedirectForRole(role: AuthRole): string {
  return role === AUTH_ADMIN_ROLE ? AUTH_DEFAULT_REDIRECT : AUTH_USER_HOME;
}

/**
 * 清洗登录后的跳转目标。
 *
 * 规则（任一不满足即回退默认值）：
 * 1. 必须是站内绝对路径（以 `/` 开头）；
 * 2. 拒绝协议相对地址（`//evil.com`）与反斜杠变体（`/\evil.com`）；
 * 3. 拒绝回到登录页（避免「登录 → 又回登录页」的循环）。
 *
 * @param value 原始 `redirect` 查询参数
 * @param fallback 非法时回退的路径（默认后台首页）
 * @returns 可安全跳转的站内路径
 */
export function sanitizeRedirectPath(
  value: string | null | undefined,
  fallback: string = AUTH_DEFAULT_REDIRECT
): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value === "/login" || value.startsWith("/login?")) return fallback;
  return value;
}

/**
 * 计算登录后的最终落点（含越权拦截）。
 *
 * 规则：
 * 1. 先按角色给出默认落点；
 * 2. 若带了 `redirect`，清洗后采用；
 * 3. **普通用户不能落到 `/admin` 下**（否则会被后台守卫弹回，形成一次无意义的跳转）。
 *
 * @param requested 原始 `redirect` 参数
 * @param role 已认证角色
 * @returns 可安全跳转的路径
 */
export function resolvePostLoginRedirect(
  requested: string | null | undefined,
  role: AuthRole
): string {
  const fallback = defaultRedirectForRole(role);
  const target = sanitizeRedirectPath(requested, fallback);
  if (role !== AUTH_ADMIN_ROLE && (target === "/admin" || target.startsWith("/admin/"))) {
    return fallback;
  }
  return target;
}

/** 密码最小长度。 */
export const AUTH_PASSWORD_MIN_LENGTH = 8;

/** 用户名长度上限（与数据库 text 列无强约束，这里只做产品侧限制）。 */
export const AUTH_USERNAME_MAX_LENGTH = 32;

/** 邮箱格式校验（宽松但拒绝明显非法值；不追求 RFC 5322 完整实现）。 */
export function isValidEmail(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

/** 用户名规则：字母、数字、下划线、连字符，3–32 位。 */
export function isValidUsername(value: string): boolean {
  if (value.length < 3 || value.length > AUTH_USERNAME_MAX_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/u.test(value);
}

/** 密码强度：至少 8 位，且不能全为同一字符。 */
export function isAcceptablePassword(value: string): boolean {
  if (value.length < AUTH_PASSWORD_MIN_LENGTH) return false;
  return new Set(value).size > 1;
}

/** 邮箱归一化（去空格 + 小写），保证唯一索引与查询口径一致。 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** 用户名归一化（去空格，保持大小写）。 */
export function normalizeUsername(value: string): string {
  return value.trim();
}
