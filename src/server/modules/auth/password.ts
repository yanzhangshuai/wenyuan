import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

/**
 * 密码哈希（scrypt）。
 *
 * ## 为什么不用 argon2
 * v1 用 Argon2id，但它是**原生模块**；v3 的门禁必须在 Windows 镜像跑，
 * 原生二进制装不上会直接卡住 `tsc/vitest`。scrypt 是 Node 内置、跨平台、
 * 且同为内存硬 KDF，安全强度可调到同量级。
 *
 * ## 为什么哈希串要自带参数
 * 格式 `scrypt$N$r$p$saltHex$hashHex`。参数写进串里意味着：
 * - 未来调参（提高 N）时，**老密码仍可验证**，不需要强制所有人重设；
 * - 校验逻辑不依赖代码里的常量，避免「改了常量导致存量密码全部失效」。
 */

/** 内存成本参数（约 16 MB：128 × N × r）。 */
const SCRYPT_N = 16384;
/** 块大小。 */
const SCRYPT_R = 8;
/** 并行度。 */
const SCRYPT_P = 1;
/** 派生密钥长度（字节）。 */
const KEY_LENGTH = 32;
/** 盐长度（字节）。 */
const SALT_LENGTH = 16;
/** scrypt 允许的最大内存（字节）：留出余量，避免不同 Node 版本默认值差异。 */
const SCRYPT_MAX_MEM = 64 * 1024 * 1024;
/** 哈希串算法前缀。 */
const HASH_PREFIX = "scrypt";

/**
 * 把回调式 `scrypt` 包成 Promise。
 *
 * 不用 `promisify`：其类型签名只接受 3 个参数，带 `options` 调用会被 tsc 判为
 * 「Expected 3 arguments, but got 4」；手写 Promise 既类型安全也无需断言。
 *
 * @param password 明文
 * @param salt 盐
 * @param keylen 派生长度
 * @param options scrypt 参数
 * @returns 派生密钥
 */
function scryptDerive(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/**
 * 对明文密码做 scrypt 哈希。
 *
 * @param password 明文密码
 * @returns 自描述哈希串（可直接落库）
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptDerive(password, salt, KEY_LENGTH, {
    N     : SCRYPT_N,
    r     : SCRYPT_R,
    p     : SCRYPT_P,
    maxmem: SCRYPT_MAX_MEM
  });

  return [
    HASH_PREFIX,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("hex"),
    derived.toString("hex")
  ].join("$");
}

/** 解析后的哈希串。 */
interface ParsedHash {
  n      : number;
  r      : number;
  p      : number;
  salt   : Buffer;
  derived: Buffer;
}

/**
 * 解析哈希串；格式非法返回 `null`（不抛错，交由调用方按「验证失败」处理）。
 *
 * @param stored 数据库中的哈希串
 * @returns 解析结果或 `null`
 */
export function parsePasswordHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6) return null;
  const [prefix, nText, rText, pText, saltHex, hashHex] = parts;
  if (
    prefix === undefined ||
    nText === undefined ||
    rText === undefined ||
    pText === undefined ||
    saltHex === undefined ||
    hashHex === undefined
  ) {
    return null;
  }
  if (prefix !== HASH_PREFIX) return null;

  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (n <= 0 || r <= 0 || p <= 0) return null;
  // 防御性上限：避免被构造的超大参数拖死进程（DoS）。
  if (n > 1 << 20 || r > 32 || p > 16) return null;

  if (!/^[0-9a-f]+$/u.test(saltHex) || !/^[0-9a-f]+$/u.test(hashHex)) return null;
  if (saltHex.length === 0 || hashHex.length === 0) return null;

  return {
    n,
    r,
    p,
    salt   : Buffer.from(saltHex, "hex"),
    derived: Buffer.from(hashHex, "hex")
  };
}

/**
 * 校验明文密码与哈希串是否匹配。
 *
 * 任何异常（格式非法、参数越界、长度不等）都返回 `false`，
 * 让上层只看到「验证失败」这一种语义，避免泄漏内部细节。
 *
 * @param password 用户输入的明文
 * @param stored 数据库中的哈希串
 * @returns 是否匹配
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (parsed === null) return false;

  const candidate = await scryptDerive(password, parsed.salt, parsed.derived.length, {
    N     : parsed.n,
    r     : parsed.r,
    p     : parsed.p,
    maxmem: SCRYPT_MAX_MEM
  });

  // 长度不等时 timingSafeEqual 会抛错，必须先挡掉。
  if (candidate.length !== parsed.derived.length) return false;
  return timingSafeEqual(candidate, parsed.derived);
}
