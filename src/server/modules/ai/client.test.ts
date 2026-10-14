// @vitest-environment node
/**
 * 模型调用客户端：错误分类与重试语义。
 *
 * 为什么必须单独立这个文件：
 * `run.integration.test.ts` 用 `vi.mock` 把 `callWithRetry` **整体替换**掉，
 * 因此真实的「分类 → 重试」链路在那层测试里从未被执行。
 * 首轮全量解析暴露的缺陷（13 次 `empty_output` 一次都没被重试）
 * 正是落在这条未被覆盖的链路上，而当时 200 个用例全绿。
 *
 * 本文件**不 mock `callWithRetry`**，只 mock `fetch`，从而：
 * - 断言真实发出的 HTTP 请求**次数**（这才是重试语义的可观察量）；
 * - 断言重试后确实拿到了内容，而不是只看「有没有抛错」。
 *
 * 维护提示（变异自测）：把 `empty_output` 加回 `NON_RETRYABLE_KINDS`，
 * 「空响应会被重试」与「重试后成功返回内容」两条用例应立刻变红。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AiCallError, callWithRetry, isRetryableKind, type AiErrorKind } from "./client";

/**
 * 测试**不依赖**运行环境里的 `.env`：`getAiEnv()` 会在首次调用时校验并缓存
 * 一组 AI 变量，任一缺失就抛错，使本文件在「没有 .env 的机器」上全红
 * （实测：CI 与本地清掉 .env 后 8 个用例全失败）。
 * 这里显式补齐所需的全部变量，让测试自洽。
 */
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://postgres:postgres@127.0.0.1:5432/test");
  vi.stubEnv("AI_BASE_URL", "https://example.invalid/v1");
  vi.stubEnv("AI_API_KEY", "sk-test-key");
  vi.stubEnv("AI_MODEL_EXTRACT", "deepseek-flash");
  vi.stubEnv("AI_MODEL_REVIEW", "deepseek-flash");
  // 与生产默认一致（关闭思考）。`getAiEnv()` 会缓存首次解析结果，
  // 因此这里固定为同一值，避免用例之间互相污染。
  vi.stubEnv("AI_THINKING", "disabled");
});

/** 构造一份 OpenAI 兼容协议的成功响应体。 */
function completionBody(content: string, finishReason = "stop"): unknown {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage  : { prompt_tokens: 120, completion_tokens: 40 }
  };
}

/** 构造一个「内容为空」的响应体（实测中约 40% 概率出现）。 */
function emptyBody(): unknown {
  return completionBody("");
}

/** 用脚本化的响应序列替换全局 fetch，并返回调用计数。 */
function stubFetchSequence(
  bodies: readonly unknown[],
  init: { ok?: boolean; status?: number } = {}
): { readonly calls: () => number } {
  let index = 0;
  const spy = vi.fn(() => {
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    return Promise.resolve({
      ok    : init.ok ?? true,
      status: init.status ?? 200,
      json  : () => Promise.resolve(body),
      text  : () => Promise.resolve(JSON.stringify(body))
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", spy);
  return { calls: () => spy.mock.calls.length };
}

/** 让退避等待变成零，避免测试因真实 sleep 变慢。 */
const NO_DELAY = { baseDelayMs: 0 } as const;

/**
 * 用脚本化响应替换 fetch，并**捕获每次请求体**。
 *
 * 为什么需要它：思考模式开关的唯一可观察证据就是**实际发出的请求体**。
 * 只断言 `getAiEnv().thinking` 是不够的 —— 分类对了但没写进请求体，
 * 供应商照样按思考计费（这正是 `enable_thinking` 字段的教训）。
 */
function stubFetchCapturingBody(
  bodies: readonly unknown[]
): { readonly requestBodies: () => Record<string, unknown>[] } {
  let index = 0;
  const sent: Record<string, unknown>[] = [];
  const spy = vi.fn((_url: string, init?: { body?: string }) => {
    sent.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    return Promise.resolve({
      ok    : true,
      status: 200,
      json  : () => Promise.resolve(body),
      text  : () => Promise.resolve(JSON.stringify(body))
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", spy);
  return { requestBodies: () => sent };
}

/** 构造带思考用量的响应体。 */
function completionBodyWithReasoning(content: string, reasoningTokens: number): unknown {
  return {
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage  : {
      prompt_tokens            : 120,
      completion_tokens        : 40,
      completion_tokens_details: { reasoning_tokens: reasoningTokens }
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isRetryableKind 分类", () => {
  it("瞬时故障可重试：限流 / 超时 / 服务端 / 网络 / 空响应", () => {
    const retryable: AiErrorKind[] = [
      "rate_limit",
      "timeout",
      "server_error",
      "network",
      "empty_output"
    ];
    for (const kind of retryable) {
      expect(isRetryableKind(kind), `${kind} 应可重试`).toBe(true);
    }
  });

  it("不可重试分两类：请求不成立（auth/bad_request）与产出不可用（格式类）", () => {
    const nonRetryable: AiErrorKind[] = [
      "auth",
      "bad_request",
      "output_not_json",
      "truncated",
      "schema_invalid"
    ];
    for (const kind of nonRetryable) {
      expect(isRetryableKind(kind), `${kind} 不应重试`).toBe(false);
    }
  });

  it("空响应没有可修复的产物，因此不属于「交给修复工序」那一类", () => {
    // 这条断言把「empty_output ≠ 格式类错误」的判据钉死。
    // 若有人把 empty_output 挪回 NON_RETRYABLE_KINDS，此处变红。
    expect(isRetryableKind("empty_output")).toBe(true);
    expect(isRetryableKind("schema_invalid")).toBe(false);
  });
});

describe("callWithRetry 的重试语义", () => {
  const request = { model: "deepseek-flash", system: "sys", user: "usr" };

  it("空响应会被重试：只发 1 次即放弃是缺陷行为", async () => {
    // 首轮全量解析的真实故障：13 次空响应一次都没重发。
    const fetchStub = stubFetchSequence([emptyBody(), emptyBody(), emptyBody()]);

    await expect(
      callWithRetry(request, { maxRetries: 2, ...NO_DELAY })
    ).rejects.toBeInstanceOf(AiCallError);

    // 1 次首发 + 2 次重试 = 3 次。旧分类下这里会是 1。
    expect(fetchStub.calls()).toBe(3);
  });

  it("空响应后重试成功：返回内容而不是抛错", async () => {
    const fetchStub = stubFetchSequence([
      emptyBody(),
      completionBody("{\"entities\":[],\"relations\":[]}")
    ]);

    const result = await callWithRetry(request, { maxRetries: 2, ...NO_DELAY });

    expect(result.text).toContain("entities");
    expect(fetchStub.calls()).toBe(2);
    // 用量字段来自成功那一次响应，成本记账不应被失败尝试污染。
    expect(result.usage.tokensIn).toBe(120);
    expect(result.usage.tokensOut).toBe(40);
  });

  it("格式类错误不重试：立即抛出，交给确定性修复工序", async () => {
    // 返回体无法解析为 JSON → output_not_json，属不可重试。
    const spy = vi.fn(() =>
      Promise.resolve({
        ok    : true,
        status: 200,
        json  : () => Promise.reject(new Error("Unexpected token < in JSON")),
        text  : () => Promise.resolve("not json")
      } as unknown as Response)
    );
    vi.stubGlobal("fetch", spy);

    await expect(
      callWithRetry(request, { maxRetries: 2, ...NO_DELAY })
    ).rejects.toMatchObject({ kind: "output_not_json" });

    // 关键：没有重试，只有 1 次请求。
    expect(spy.mock.calls.length).toBe(1);
  });

  it("429 限流仍走重试（回归保护）", async () => {
    const spy = vi.fn(() =>
      Promise.resolve({
        ok    : false,
        status: 429,
        json  : () => Promise.resolve({}),
        text  : () => Promise.resolve("rate limited")
      } as unknown as Response)
    );
    vi.stubGlobal("fetch", spy);

    await expect(
      callWithRetry(request, { maxRetries: 1, ...NO_DELAY })
    ).rejects.toMatchObject({ kind: "rate_limit" });

    expect(spy.mock.calls.length).toBe(2);
  });

  it("onAttempt 记录每次尝试，便于审计失败次数", async () => {
    stubFetchSequence([emptyBody(), completionBody("{}")]);
    const attempts: number[] = [];

    await callWithRetry(request, {
      maxRetries: 2,
      ...NO_DELAY,
      onAttempt : (attempt) => attempts.push(attempt)
    });

    // 首发（attempt=0）+ 重试（attempt=1）。
    expect(attempts).toEqual([0, 1]);
  });
});

/**
 * 成本记账是预算闸门的唯一输入（`assertWithinBudget` 直接消费 `costUsd`），
 * 因此这里必须断言**具体数值**，而不是「非 null 即可」。
 *
 * 背景：早期单价表登记的是已废弃的 `deepseek-chat` / `deepseek-reasoner`，
 * 而真实配置用 `deepseek-flash` / `deepseek-v4-pro` —— 名字对不上，
 * 每次调用都返回 null、按 0 记账，预算闸门**静默失效**，
 * 首轮全量解析 116 次调用账面成本恒为 $0.0000，却没有任何告警被触发。
 */
describe("成本估算", () => {
  it("deepseek-flash 有单价，且按人民币→美元折算", async () => {
    stubFetchSequence([completionBody("{}")]);

    const result = await callWithRetry(
      { model: "deepseek-flash", system: "s", user: "u" },
      NO_DELAY
    );

    // usage 来自 completionBody：输入 120、输出 40。
    // 高峰价：输入 ¥2/M、输出 ¥8/M → (120×2 + 40×8)/1e6 = ¥0.00056 → /7.2
    const expected = (120 * 2 + 40 * 8) / 1_000_000 / 7.2;
    expect(result.usage.costUsd).toBeCloseTo(expected, 10);

    // 若误按美元直加（漏折算），结果会大 7.2 倍 —— 这条断言拦住它。
    expect(result.usage.costUsd).toBeLessThan(expected * 1.5);
  });

  it("deepseek-v4-pro 有单价（高价模型不能被漏登记）", async () => {
    stubFetchSequence([completionBody("{}")]);

    const result = await callWithRetry(
      { model: "deepseek-v4-pro", system: "s", user: "u" },
      NO_DELAY
    );

    expect(result.usage.costUsd).not.toBeNull();
    expect(result.usage.costUsd).toBeGreaterThan(0);
  });

  it("未知模型返回 null 而不是 0 —— 0 会让预算闸门静默失效", async () => {
    stubFetchSequence([completionBody("{}")]);

    const result = await callWithRetry(
      { model: "some-unlisted-model", system: "s", user: "u" },
      NO_DELAY
    );

    // 必须是 null：上层据此写 `model_price_missing` 留档。
    expect(result.usage.costUsd).toBeNull();
    expect(result.usage.costUsd).not.toBe(0);
  });
});

/**
 * 思考模式是本次降本的核心开关（实测省 64% 成本），
 * 同时也是**静默失败高发区**：实测 `enable_thinking=false` 传了既不报错
 * 也不生效（reasoning 仍占 82%）。
 *
 * 因此断言必须落在**实际发出的请求体**上，而不是配置对象上 ——
 * 「配置对了但没写进请求体」与「写错了字段名」是同一个后果：一分钱没省。
 */
describe("思考模式开关", () => {
  const request = { model: "deepseek-flash", system: "sys", user: "usr" };

  it("默认关闭思考：请求体带 thinking={type:disabled}", async () => {
    const capture = stubFetchCapturingBody([completionBody("{}")]);

    await callWithRetry(request, NO_DELAY);

    const [body] = capture.requestBodies();
    expect(body?.thinking).toEqual({ type: "disabled" });
  });

  it("单次覆盖为 enabled：不传 thinking 字段（回落供应商默认）", async () => {
    const capture = stubFetchCapturingBody([completionBody("{}")]);

    await callWithRetry({ ...request, thinking: "enabled" }, NO_DELAY);

    const [body] = capture.requestBodies();
    expect(body).toBeDefined();
    expect(body).not.toHaveProperty("thinking");
  });

  it("开关不破坏其余字段：model / max_tokens / messages 原样发出", async () => {
    const capture = stubFetchCapturingBody([completionBody("{}")]);

    await callWithRetry({ ...request, maxTokens: 1234, temperature: 0.3 }, NO_DELAY);

    const [body] = capture.requestBodies();
    expect(body?.model).toBe("deepseek-flash");
    expect(body?.max_tokens).toBe(1234);
    expect(body?.temperature).toBe(0.3);
    expect(body?.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" }
    ]);
  });
});

/**
 * 思考 token 的观测口径。
 *
 * 上游把思考计入 `completion_tokens`（`tokensOut` 已含它），因此**计费不额外加**。
 * 这一条最容易写错：若把 reasoning 单独再加一次，成本会虚高近一倍，
 * 而预算闸门会据此提前中止正常解析。
 */
describe("思考 token 观测", () => {
  const request = { model: "deepseek-flash", system: "s", user: "u" };

  it("读出 completion_tokens_details.reasoning_tokens", async () => {
    stubFetchSequence([completionBodyWithReasoning("{}", 978)]);

    const result = await callWithRetry(request, NO_DELAY);

    expect(result.usage.reasoningTokens).toBe(978);
  });

  it("上游未返回该字段时为 0，而不是 undefined", async () => {
    stubFetchSequence([completionBody("{}")]);

    const result = await callWithRetry(request, NO_DELAY);

    expect(result.usage.reasoningTokens).toBe(0);
  });

  it("思考 token 不重复计费：costUsd 仍只按 tokensOut 计", async () => {
    stubFetchSequence([completionBodyWithReasoning("{}", 978)]);

    const result = await callWithRetry(request, NO_DELAY);

    // usage：输入 120、输出 40（其中思考 978 是**独立构造**的异常值，
    // 真实响应里它不会超过 completion_tokens；这里故意让它超出，
    // 以便「把 reasoning 再加一次」的实现会立刻算出一个明显偏大的数）。
    const expected = (120 * 2 + 40 * 8) / 1_000_000 / 7.2;
    expect(result.usage.costUsd).toBeCloseTo(expected, 10);
  });
});
