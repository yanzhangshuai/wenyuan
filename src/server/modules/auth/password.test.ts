import { describe, expect, it } from "vitest";

import { hashPassword, parsePasswordHash, verifyPassword } from "./password";

/**
 * 密码哈希测试。
 *
 * 关注三件事：
 * 1. 正确密码通过、错误密码失败；
 * 2. 哈希串**自带参数**（改参数后旧串仍可验证）；
 * 3. 篡改/畸形哈希串一律返回 `false` 而非抛错（上层只看到「验证失败」）。
 */

describe("hashPassword / verifyPassword", () => {
  it("同一密码两次哈希不同（随机盐），但都能验证通过", async () => {
    const first = await hashPassword("Wenyuan@2026");
    const second = await hashPassword("Wenyuan@2026");
    expect(first).not.toBe(second);
    expect(await verifyPassword("Wenyuan@2026", first)).toBe(true);
    expect(await verifyPassword("Wenyuan@2026", second)).toBe(true);
  });

  it("错误密码不通过", async () => {
    const stored = await hashPassword("Wenyuan@2026");
    expect(await verifyPassword("Wenyuan@2027", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("哈希串格式自描述：scrypt$N$r$p$salt$hash", async () => {
    const stored = await hashPassword("Wenyuan@2026");
    const parsed = parsePasswordHash(stored);
    expect(parsed).not.toBeNull();
    expect(parsed?.n).toBe(16384);
    expect(parsed?.r).toBe(8);
    expect(parsed?.p).toBe(1);
    expect(stored.startsWith("scrypt$")).toBe(true);
  });

  it("篡改哈希或盐后验证失败", async () => {
    const stored = await hashPassword("Wenyuan@2026");
    const parts = stored.split("$");
    const tamperedHash = [...parts.slice(0, 5), parts[5]?.replace(/^./u, "0")].join("$");
    const tamperedSalt = [...parts.slice(0, 4), parts[4]?.replace(/^./u, "1"), parts[5]].join("$");
    expect(await verifyPassword("Wenyuan@2026", tamperedHash)).toBe(false);
    expect(await verifyPassword("Wenyuan@2026", tamperedSalt)).toBe(false);
  });

  it("畸形哈希串返回 false（不抛错）", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plain-text")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$abcd")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$16384$8$1$aa$bb")).toBe(false);
    expect(await verifyPassword("x", "scrypt$0$8$1$aa$bb")).toBe(false);
  });

  it("拒绝被构造的超大参数（DoS 防护）", () => {
    expect(parsePasswordHash("scrypt$1048577$8$1$aa$bb")).toBeNull();
    expect(parsePasswordHash("scrypt$16384$64$1$aa$bb")).toBeNull();
    expect(parsePasswordHash("scrypt$16384$8$32$aa$bb")).toBeNull();
  });
});
