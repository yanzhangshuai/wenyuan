/**
 * 登录失败限流（进程内）。
 *
 * 定位：**降低暴力破解噪音**，不是安全边界。进程重启后计数归零是可接受的降级
 * （真正的账号保护依赖密码强度与 Argon2/scrypt 的计算成本）。
 *
 * 设计：工厂函数 + 可注入时钟，让「第 5 次失败后拒绝」「窗口过期后恢复」这类
 * 时间相关行为可以被确定性地单测，而不是靠 `sleep`。
 */

/** 限流配置。 */
export interface LoginRateLimitOptions {
  /** 窗口内允许的最大失败次数。 */
  maxFailures: number;
  /** 统计窗口（毫秒）。 */
  windowMs   : number;
  /** 当前时间（毫秒），便于测试注入。 */
  now?       : () => number;
}

/** 单个 IP 的计数状态。 */
interface Bucket {
  failures       : number;
  windowStartedAt: number;
}

/** 检查结果。 */
export interface RateLimitDecision {
  allowed          : boolean;
  /** 被拒绝时建议的等待秒数（向上取整）。 */
  retryAfterSeconds: number;
}

/** 限流器接口。 */
export interface LoginRateLimiter {
  check        : (ip: string) => RateLimitDecision;
  recordFailure: (ip: string) => void;
  clear        : (ip: string) => void;
}

/**
 * 创建限流器。
 *
 * @param options 配置
 * @returns 限流器实例
 */
export function createLoginRateLimiter(options: LoginRateLimitOptions): LoginRateLimiter {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  const current = (ip: string): Bucket | null => {
    const bucket = buckets.get(ip);
    if (bucket === undefined) return null;
    // 窗口过期即视为全新计数，避免「昨天的失败拖累今天」。
    if (now() - bucket.windowStartedAt >= options.windowMs) {
      buckets.delete(ip);
      return null;
    }
    return bucket;
  };

  return {
    check(ip: string): RateLimitDecision {
      const bucket = current(ip);
      if (bucket === null || bucket.failures < options.maxFailures) {
        return { allowed: true, retryAfterSeconds: 0 };
      }
      const remainingMs = options.windowMs - (now() - bucket.windowStartedAt);
      return {
        allowed          : false,
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000))
      };
    },

    recordFailure(ip: string): void {
      const bucket = current(ip);
      if (bucket === null) {
        buckets.set(ip, { failures: 1, windowStartedAt: now() });
        return;
      }
      bucket.failures += 1;
    },

    clear(ip: string): void {
      buckets.delete(ip);
    }
  };
}

/** 默认策略：15 分钟内 5 次失败即锁定到窗口结束。 */
export const loginRateLimiter = createLoginRateLimiter({
  maxFailures: 5,
  windowMs   : 15 * 60 * 1000
});

/**
 * 解析客户端 IP。
 *
 * 优先取反向代理写入的 `x-forwarded-for` 首段；缺失时退回 `x-real-ip`，
 * 再缺失则归为 `unknown`（宁可共享一个桶，也不放行无限尝试）。
 *
 * @param headers 请求头
 * @returns IP 字符串
 */
export function resolveClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp !== null && realIp.length > 0) return realIp;
  return "unknown";
}
