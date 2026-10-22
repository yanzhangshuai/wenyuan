import "server-only";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { AUTH_COOKIE_NAME, AUTH_TOKEN_TTL_SECONDS } from "@/lib/auth";
import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";

import type { AuthenticatedUser } from "./service";
import { issueAuthToken, verifyAuthToken } from "./token";

/**
 * 会话管理（Cookie 读写 + 服务端上下文）。
 *
 * 双层鉴权的第二层在这里：`getAuthContext()` 不只验签，还**回查数据库**，
 * 因此「停用账号」能立即失效，而不必等令牌过期。
 */

/** Cookie 属性（集中一处，避免登录/登出两处漂移）。 */
function cookieOptions(): {
  httpOnly: boolean;
  sameSite: "lax";
  secure  : boolean;
  path    : string;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    // 生产环境走 HTTPS 才加 secure；本地 http 开发若加会直接丢 Cookie。
    secure  : process.env.NODE_ENV === "production",
    path    : "/"
  };
}

/**
 * 建立会话：签发令牌并写入 httpOnly Cookie。
 *
 * @param user 已认证用户
 */
export async function createSession(user: AuthenticatedUser): Promise<void> {
  const token = await issueAuthToken(
    { sub: user.id, role: user.role, name: user.name },
    AUTH_TOKEN_TTL_SECONDS
  );
  const jar = await cookies();
  jar.set(AUTH_COOKIE_NAME, token, { ...cookieOptions(), maxAge: AUTH_TOKEN_TTL_SECONDS });
}

/** 销毁会话：清除 Cookie。 */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(AUTH_COOKIE_NAME);
}

/**
 * 读取当前会话上下文。
 *
 * @returns 已认证用户；未登录、令牌非法、账号被停用时返回 `null`
 */
export async function getAuthContext(): Promise<AuthenticatedUser | null> {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE_NAME)?.value;
  if (token === undefined || token.length === 0) return null;

  const claims = await verifyAuthToken(token);
  if (claims === null) return null;

  const db = getDatabase();
  const rows = await db
    .select({
      id      : users.id,
      email   : users.email,
      name    : users.name,
      role    : users.role,
      isActive: users.isActive
    })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);

  const row = rows[0];
  if (!row?.isActive) return null;

  return { id: row.id, email: row.email, name: row.name, role: row.role };
}
