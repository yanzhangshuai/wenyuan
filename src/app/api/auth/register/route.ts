import { z } from "zod";

import { AUTH_DEFAULT_REDIRECT } from "@/lib/auth";
import { jsonFail, jsonOk, readJson } from "@/server/http/json";
import { registerUser } from "@/server/modules/auth/service";
import { createSession } from "@/server/modules/auth/session";

/**
 * POST /api/auth/register
 *
 * 自助注册：**角色恒为 `VIEWER`**（只读），首个管理员由 `scripts/seed-admin.ts` 创建。
 * 注册成功后直接建立会话，省去「注册完再登录一次」的摩擦。
 */

/** 请求体 Schema。 */
const registerSchema = z.object({
  email   : z.string().min(1),
  username: z.string().min(1),
  name    : z.string().optional(),
  password: z.string().min(1)
});

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return jsonFail("invalid_request", "请求格式不正确", 400);
  }

  const result = await registerUser(parsed.data);
  if (!result.ok) {
    switch (result.reason) {
      case "email_taken":
        return jsonFail("email_taken", "该邮箱已注册", 409);
      case "username_taken":
        return jsonFail("username_taken", "该用户名已被占用", 409);
      case "weak_password":
        return jsonFail("weak_password", "密码至少 8 位，且不能全为同一字符", 400);
      default:
        return jsonFail("invalid_input", "邮箱或用户名格式不正确", 400);
    }
  }

  await createSession(result.value);
  return jsonOk({
    redirect: AUTH_DEFAULT_REDIRECT,
    user    : { name: result.value.name, role: result.value.role }
  }, 201);
}
