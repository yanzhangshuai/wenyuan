import { describe, expect, it } from "vitest";

import { createLoginRateLimiter, resolveClientIp } from "./rate-limit";

/**
 * 登录限流测试。
 *
 * 用注入时钟而非 `sleep`：时间相关行为必须可确定性复现。
 */

/** 构造一个可控时钟。 */
function createClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now    : () => current,
    advance: (ms: number) => {
      current += ms;
    }
  };
}

describe("createLoginRateLimiter", () => {
  it("5 次失败内允许，第 6 次拒绝", () => {
    const clock = createClock();
    const limiter = createLoginRateLimiter({ maxFailures: 5, windowMs: 1000, now: clock.now });

    for (let i = 0; i < 5; i += 1) {
      expect(limiter.check("1.1.1.1").allowed).toBe(true);
      limiter.recordFailure("1.1.1.1");
    }
    const decision = limiter.check("1.1.1.1");
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("窗口过期后恢复", () => {
    const clock = createClock();
    const limiter = createLoginRateLimiter({ maxFailures: 2, windowMs: 1000, now: clock.now });

    limiter.recordFailure("ip");
    limiter.recordFailure("ip");
    expect(limiter.check("ip").allowed).toBe(false);

    clock.advance(1000);
    expect(limiter.check("ip").allowed).toBe(true);
  });

  it("成功登录清零计数", () => {
    const clock = createClock();
    const limiter = createLoginRateLimiter({ maxFailures: 2, windowMs: 1000, now: clock.now });

    limiter.recordFailure("ip");
    limiter.recordFailure("ip");
    limiter.clear("ip");
    expect(limiter.check("ip").allowed).toBe(true);
  });

  it("不同 IP 互不影响", () => {
    const clock = createClock();
    const limiter = createLoginRateLimiter({ maxFailures: 1, windowMs: 1000, now: clock.now });

    limiter.recordFailure("a");
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("retryAfterSeconds 随时间递减且不小于 1", () => {
    const clock = createClock();
    const limiter = createLoginRateLimiter({ maxFailures: 1, windowMs: 10_000, now: clock.now });

    limiter.recordFailure("ip");
    expect(limiter.check("ip").retryAfterSeconds).toBe(10);

    clock.advance(9_500);
    expect(limiter.check("ip").retryAfterSeconds).toBe(1);
  });
});

describe("resolveClientIp", () => {
  it("优先取 x-forwarded-for 首段", () => {
    const headers = new Headers({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8", "x-real-ip": "9.9.9.9" });
    expect(resolveClientIp(headers)).toBe("1.2.3.4");
  });

  it("回退到 x-real-ip", () => {
    expect(resolveClientIp(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("都没有时归为 unknown（宁可共享桶，也不放行无限尝试）", () => {
    expect(resolveClientIp(new Headers())).toBe("unknown");
  });
});
