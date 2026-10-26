/**
 * 鉴权模块自己的配置读取（不并入全局 `infraEnvSchema`）。
 *
 * 理由与 `JWT_SECRET` 一致：这些是**鉴权功能自己的开关**，
 * 放进全局必填项会让「只想跑一次 CLI 解析」的人也被迫配置。
 */

/**
 * 是否开放注册。
 *
 * **默认开放**（未配置时返回 true）：这是产品决定 ——
 * 先让人能进来，再靠角色（VIEWER 只能看图谱、提反馈）控制能做什么。
 *
 * 要关闭时在 `.env` 里写 `ALLOW_REGISTRATION=0`（`false` / `off` 也认）。
 */
export function isRegistrationOpen(): boolean {
  const raw = process.env.ALLOW_REGISTRATION;
  if (raw === undefined || raw.trim().length === 0) return true;
  const normalized = raw.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off";
}
