import { AUTH_ROLES, type AuthRole } from "@/lib/auth";

/**
 * 会话令牌（JWT / HS256）。
 *
 * ## 两个关键取舍
 * 1. **不引入 `jose`**：v3 的依赖要同时装进 WSL（Linux）与 Windows 镜像两套 `node_modules`，
 *    新增依赖是本项目风险最高的一步。HS256 只需一次 HMAC，手写约 80 行即可，且完全可单测。
 * 2. **用 Web Crypto（`crypto.subtle`）而非 `node:crypto`**：同一份实现要同时跑在
 *    Route Handler（Node）与 `middleware`（Edge）里。`node:crypto` 在 Edge 不可用，
 *    若为中间件再写一份实现，就会出现「两套验签逻辑」的漂移风险。
 *
 * ## 安全约束
 * - 只接受 `alg=HS256`，**显式拒绝 `alg=none`**（JWT 最经典的伪造入口）；
 * - 用 `subtle.verify` 做常量时间比较，不手写比较循环；
 * - 密钥缺失或短于 32 字节时**直接抛错**，绝不降级到默认密钥。
 */

/** 令牌载荷（写入 JWT 的业务字段）。 */
export interface AuthTokenPayload {
  /** 用户 id。 */
  sub : string;
  /** 角色。 */
  role: AuthRole;
  /** 展示名。 */
  name: string;
}

/** 解码后的完整载荷（含时间字段）。 */
export interface AuthTokenClaims extends AuthTokenPayload {
  iat: number;
  exp: number;
}

/** 算法标识（固定值，不接受外部指定）。 */
const JWT_ALGORITHM = "HS256";

/** 密钥最小长度（字节）。 */
const MIN_SECRET_BYTES = 32;

const encoder = new TextEncoder();

/**
 * 把 `Uint8Array` 复制为独立 `ArrayBuffer`。
 *
 * 为什么需要：TypeScript 5.7 起 `Uint8Array` 带 `ArrayBufferLike` 泛型，
 * 而 Web Crypto 的 `BufferSource` 要求 `ArrayBuffer`；直接传会被 tsc 拒绝。
 * 复制一次（几十字节）比写类型断言更安全，也避免共享底层缓冲区。
 *
 * @param bytes 源字节
 * @returns 独立 ArrayBuffer
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/** 字节 → base64url（`btoa` 在 Node 16+ 与 Edge 均可用）。 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** base64url → 字节；非法输入返回 `null`。 */
function base64UrlToBytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) return null;
  const normalized = text.replace(/-/gu, "+").replace(/_/gu, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  try {
    const binary = atob(normalized + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * 读取签名密钥。
 *
 * @returns 密钥字节
 * @throws 缺少 `JWT_SECRET` 或长度不足时抛出
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("缺少鉴权环境变量：JWT_SECRET");
  }
  const bytes = encoder.encode(secret);
  if (bytes.byteLength < MIN_SECRET_BYTES) {
    throw new Error(`JWT_SECRET 至少需要 ${String(MIN_SECRET_BYTES)} 字节`);
  }
  return bytes;
}

/** 导入 HMAC 密钥。 */
async function importKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify"
  ]);
}

/** 计算签名（base64url）。 */
async function sign(data: string, secret: Uint8Array): Promise<string> {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, toArrayBuffer(encoder.encode(data)));
  return bytesToBase64Url(new Uint8Array(signature));
}

/**
 * 签发令牌。
 *
 * @param payload 业务载荷
 * @param ttlSeconds 有效期（秒）
 * @param nowSeconds 当前时间（秒），默认取系统时间；显式传入便于测试
 * @returns JWT 字符串
 */
export async function issueAuthToken(
  payload: AuthTokenPayload,
  ttlSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ alg: JWT_ALGORITHM, typ: "JWT" })));
  const body = bytesToBase64Url(
    encoder.encode(
      JSON.stringify({
        sub : payload.sub,
        role: payload.role,
        name: payload.name,
        iat : nowSeconds,
        exp : nowSeconds + ttlSeconds
      })
    )
  );
  const signature = await sign(`${header}.${body}`, getJwtSecret());
  return `${header}.${body}.${signature}`;
}

/**
 * 校验令牌。
 *
 * @param token JWT 字符串
 * @param nowSeconds 当前时间（秒），默认取系统时间
 * @returns 合法则返回载荷，否则 `null`
 */
export async function verifyAuthToken(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<AuthTokenClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerText, bodyText, signatureText] = parts;
  if (headerText === undefined || bodyText === undefined || signatureText === undefined) return null;

  const headerBytes = base64UrlToBytes(headerText);
  if (headerBytes === null) return null;
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    return null;
  }
  if (typeof header !== "object" || header === null) return null;
  if ((header as { alg?: unknown }).alg !== JWT_ALGORITHM) return null;

  let secret: Uint8Array;
  try {
    secret = getJwtSecret();
  } catch {
    return null;
  }

  const signatureBytes = base64UrlToBytes(signatureText);
  if (signatureBytes === null) return null;

  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(encoder.encode(`${headerText}.${bodyText}`))
  );
  if (!valid) return null;

  const bodyBytes = base64UrlToBytes(bodyText);
  if (bodyBytes === null) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;

  const record = claims as Record<string, unknown>;
  const { sub, role, name, iat, exp } = record;
  if (typeof sub !== "string" || sub.length === 0) return null;
  if (typeof role !== "string" || !(AUTH_ROLES as readonly string[]).includes(role)) return null;
  if (typeof name !== "string") return null;
  if (typeof iat !== "number" || typeof exp !== "number") return null;
  if (exp <= nowSeconds) return null;

  return { sub, role: role as AuthRole, name, iat, exp };
}
