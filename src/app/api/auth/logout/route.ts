import { jsonOk } from "@/server/http/json";
import { destroySession } from "@/server/modules/auth/session";

/**
 * POST /api/auth/logout
 *
 * 只做一件事：清除会话 Cookie。令牌本身是无状态的，因此服务端不维护黑名单
 * （代价是被停用账号仍持有有效签名——所以 `getAuthContext()` 会回查 `is_active`）。
 */
export async function POST(): Promise<Response> {
  await destroySession();
  return jsonOk({});
}
