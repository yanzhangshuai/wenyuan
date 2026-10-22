import { z } from "zod";

import { resolvePostLoginRedirect } from "@/lib/auth";
import { jsonFail, jsonOk, readJson } from "@/server/http/json";
import {
  loginRateLimiter,
  resolveClientIp
} from "@/server/modules/auth/rate-limit";
import { authenticate } from "@/server/modules/auth/service";
import { createSession } from "@/server/modules/auth/session";

/**
 * POST /api/auth/login
 *
 * 流程：限流检查 → 入参校验 → 账号密码认证 → 签发会话 → 返回跳转目标。
 *
 * 安全语义：
 * - 认证失败**统一**返回「账号或密码错误」，不区分「账号不存在」与「密码错误」；
 * - 被停用账号返回同样的 401（避免暴露账号状态）；
 * - 限流按 IP，触发后返回 429 并给出 `retryAfter`。
 */

/** 请求体 Schema。 */
const loginSchema = z.object({
  identifier: z.string().min(1),
  password  : z.string().min(1),
  redirect  : z.string().optional()
});

export async function POST(request: Request): Promise<Response> {
  const ip = resolveClientIp(request.headers);
  const decision = loginRateLimiter.check(ip);
  if (!decision.allowed) {
    return jsonFail("rate_limited", "尝试过于频繁，请稍后再试", 429, {
      retryAfter: decision.retryAfterSeconds
    });
  }

  const body = await readJson(request);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonFail("invalid_request", "请求格式不正确", 400);
  }

  const result = await authenticate(parsed.data.identifier, parsed.data.password);
  if (!result.ok) {
    loginRateLimiter.recordFailure(ip);
    return jsonFail("invalid_credentials", "账号或密码错误", 401);
  }

  loginRateLimiter.clear(ip);
  await createSession(result.value);

  return jsonOk({
    // 落点按角色决定：管理员进后台，普通用户进书库；普通用户带 /admin 的回跳会被拦下。
    redirect: resolvePostLoginRedirect(parsed.data.redirect, result.value.role),
    user    : { name: result.value.name, role: result.value.role }
  });
}
