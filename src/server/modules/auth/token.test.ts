import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getJwtSecret, issueAuthToken, verifyAuthToken } from "./token";

/**
 * 令牌测试。
 *
 * 覆盖四条安全语义：
 * 1. 正常签发/校验；
 * 2. 过期拒绝；
 * 3. 篡改签名拒绝；
 * 4. `alg: none` 伪造拒绝（JWT 最经典的绕过手法）。
 */

const SECRET = "test-secret-with-at-least-32-bytes-length!!";
const TTL = 3600;

/**
 * base64url 编码（UTF-8 安全）。
 *
 * 不能用 `btoa(JSON.stringify(...))` 直接编中文——`btoa` 只接受 Latin-1，
 * 遇到汉字会抛 InvalidCharacterError。
 */
function base64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

describe("JWT（HS256，Web Crypto 实现）", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it("签发后可校验，载荷字段完整", async () => {
    const token = await issueAuthToken({ sub: "u1", role: "ADMIN", name: "管理员" }, TTL, 1000);
    const claims = await verifyAuthToken(token, 1000);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe("u1");
    expect(claims?.role).toBe("ADMIN");
    expect(claims?.name).toBe("管理员");
    expect(claims?.exp).toBe(1000 + TTL);
  });

  it("过期后拒绝", async () => {
    const token = await issueAuthToken({ sub: "u1", role: "ADMIN", name: "管理员" }, TTL, 1000);
    expect(await verifyAuthToken(token, 1000 + TTL)).toBeNull();
    expect(await verifyAuthToken(token, 1000 + TTL - 1)).not.toBeNull();
  });

  it("篡改载荷或签名后拒绝", async () => {
    const token = await issueAuthToken({ sub: "u1", role: "VIEWER", name: "访客" }, TTL, 1000);
    const [header, body, signature] = token.split(".");

    const forgedBody = base64Url(
      JSON.stringify({ sub: "u1", role: "ADMIN", name: "访客", iat: 1000, exp: 9999 })
    );

    expect(await verifyAuthToken(`${header}.${forgedBody}.${signature}`, 1000)).toBeNull();
    expect(await verifyAuthToken(`${header}.${body}.${signature?.replace(/.$/u, "A")}`, 1000)).toBeNull();
  });

  it("拒绝 alg=none 的伪造令牌", async () => {
    const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
    const body = base64Url(
      JSON.stringify({ sub: "u1", role: "ADMIN", name: "攻击者", iat: 1000, exp: 9999 })
    );
    expect(await verifyAuthToken(`${header}.${body}.`, 1000)).toBeNull();
    expect(await verifyAuthToken(`${header}.${body}.sig`, 1000)).toBeNull();
  });

  it("alg 声明必须与实现一致（HS512 头 + HS256 签名也拒绝）", async () => {
    // 没有这道校验时，攻击者可以把 header 改成任意算法名而签名仍按 HS256 计算，
    // 结果照样通过——这正是「算法混淆」类漏洞的入口。
    const header = base64Url(JSON.stringify({ alg: "HS512", typ: "JWT" }));
    const body = base64Url(JSON.stringify({ sub: "u1", role: "ADMIN", name: "x", iat: 1000, exp: 9999 }));

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBytes = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`))
    );
    let binary = "";
    for (const byte of signatureBytes) binary += String.fromCharCode(byte);
    const signature = btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");

    expect(await verifyAuthToken(`${header}.${body}.${signature}`, 1000)).toBeNull();
  });

  it("结构非法直接拒绝", async () => {
    expect(await verifyAuthToken("", 1000)).toBeNull();
    expect(await verifyAuthToken("a.b", 1000)).toBeNull();
    expect(await verifyAuthToken("a.b.c.d", 1000)).toBeNull();
    expect(await verifyAuthToken("!!!.???.###", 1000)).toBeNull();
  });

  it("密钥缺失或过短时拒绝（不降级到默认密钥）", async () => {
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/u);

    process.env.JWT_SECRET = "too-short";
    expect(() => getJwtSecret()).toThrow(/至少/u);

    // 校验路径返回 null 而非抛错，避免把配置错误暴露成 500 堆栈。
    process.env.JWT_SECRET = SECRET;
    const token = await issueAuthToken({ sub: "u1", role: "ADMIN", name: "x" }, TTL, 1000);
    delete process.env.JWT_SECRET;
    expect(await verifyAuthToken(token, 1000)).toBeNull();
  });
});
