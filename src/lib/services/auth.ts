import { AUTH_DEFAULT_REDIRECT, sanitizeRedirectPath } from "@/lib/auth";

/**
 * 鉴权相关的客户端请求封装。
 *
 * 约定：
 * - 失败统一抛 `AuthRequestError`（含服务端文案），由页面转成提示条；
 * - 成功后只返回「跳转目标」，由页面决定用 `replace` 还是 `push`。
 */

/** 登录入参。 */
export interface LoginInput {
  identifier: string;
  password  : string;
  redirect? : string;
}

/** 注册入参。 */
export interface RegisterInput {
  email   : string;
  username: string;
  name?   : string;
  password: string;
}

/** 请求失败（含服务端可展示文案）。 */
export class AuthRequestError extends Error {
  /** 服务端错误码（用于区分可提示与需记录的情况）。 */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthRequestError";
    this.code = code;
  }
}

/** 统一解析响应体。 */
async function parseResponse(response: Response): Promise<{ redirect: string }> {
  let payload: unknown = null;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    payload = null;
  }

  const record = (payload ?? {}) as Record<string, unknown>;
  if (!response.ok || record.ok !== true) {
    const code = typeof record.code === "string" ? record.code : "request_failed";
    const message = typeof record.message === "string" ? record.message : "请求失败，请稍后再试";
    throw new AuthRequestError(code, message);
  }

  const redirect = typeof record.redirect === "string" ? record.redirect : AUTH_DEFAULT_REDIRECT;
  return { redirect: sanitizeRedirectPath(redirect) };
}

/**
 * 登录。
 *
 * @param input 邮箱 + 密码 + 可选回跳地址
 * @returns 跳转目标（已清洗）
 */
export async function login(input: LoginInput): Promise<{ redirect: string }> {
  const response = await fetch("/api/auth/login", {
    method : "POST",
    headers: { "content-type": "application/json" },
    body   : JSON.stringify(input)
  });
  return parseResponse(response);
}

/**
 * 注册（成功后服务端会直接建立会话）。
 *
 * @param input 注册信息
 * @returns 跳转目标（已清洗）
 */
export async function register(input: RegisterInput): Promise<{ redirect: string }> {
  const response = await fetch("/api/auth/register", {
    method : "POST",
    headers: { "content-type": "application/json" },
    body   : JSON.stringify(input)
  });
  return parseResponse(response);
}

/** 退出登录（清除 Cookie）。 */
export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
