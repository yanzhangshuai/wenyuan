import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE_NAME, sanitizeRedirectPath } from "@/lib/auth";
import { verifyAuthToken } from "@/server/modules/auth/token";

/**
 * 后台入口门禁（第一层）。
 *
 * 职责边界：
 * - **只验签**，不查库（保持轻量、不引入数据库连接）；
 * - 「账号是否被停用」由 `app/admin/layout.tsx` 的第二层校验负责。
 *
 * 未通过时重定向到 `/login?redirect=<原路径>`，登录成功后回跳。
 */
export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const claims = token === undefined ? null : await verifyAuthToken(token);
  if (claims !== null) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const target = sanitizeRedirectPath(`${pathname}${search}`);
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?redirect=${encodeURIComponent(target)}`;
  return NextResponse.redirect(url);
}

/** 只拦后台；登录页与公开图谱页不受影响。 */
export const config = {
  matcher: ["/admin/:path*"]
};
