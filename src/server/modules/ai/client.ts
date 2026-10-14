import "server-only";

import { getAiEnv, getBudgetEnv } from "@/server/env";

/**
 * OpenAI 兼容协议的模型调用客户端。
 *
 * 设计原因（这是 v3 相对 v1 的关键改动之一）：
 * - v1 的调用层把「重试」当作通用兜底，对 `output_not_json` / `truncated`
 *   也照样重试，放大调用量最多 9 倍且几乎必然再次失败；
 * - v3 按**错误类别**分流：可重试的（限流、超时、5xx、网络抖动、**空响应**）
 *   才退避重试；**已拿到产出但产出不可用**的（`output_not_json` / `truncated` /
 *   `schema_invalid`）一律不重试，交给确定性的修复工序处理。
 *
 * 注意「空响应」与「产出不可用」是**两回事**：空响应没有产出，重试可改变结果，
 * 属于可重试；详见 `NON_RETRYABLE_KINDS` 的注释（附实测数据）。
 *
 * 本模块只负责「发一次请求 + 归类结果」，不掺业务逻辑，
 * 使管线各阶段可以复用同一套错误语义。
 */

/** 调用失败的错误类别，决定上层是重试、修复还是直接放弃。 */
export type AiErrorKind =
  | "rate_limit"
  | "timeout"
  | "server_error"
  | "network"
  | "auth"
  | "bad_request"
  | "output_not_json"
  | "truncated"
  | "schema_invalid"
  | "empty_output";

/**
 * 不可通过重试解决的错误类别（重试只会浪费预算）。
 *
 * 分两类，判据是**重试能否改变结果**：
 *
 * 1. **请求本身不可能成立**：`auth`（密钥失效）、`bad_request`（参数非法）——
 *    原样重发必然同样失败。
 * 2. **拿到了产出但产出不可用**：`output_not_json` / `truncated` / `schema_invalid` ——
 *    模型确实返回了内容，只是格式或长度不合格。这类**有东西可修**，
 *    应交给确定性的修复工序（见 `pipeline/repair-json.ts`），重试只是重复付一次钱
 *    去换一份同样需要修的产出。
 *
 * ⚠️ `empty_output` **不在**此集合内，这是实测修正而非疏漏：
 * 空响应是**瞬时故障**，重试会改变结果。实测同一分片（第 20 章片 1，3366 字）
 * 连发 5 次，3 次有输出、2 次空响应（约 40% 失败率），重发即成功；
 * 且空响应**没有任何可修复的产物** —— 归入「交给修复工序」是错误的。
 * 早先把它列在这里，导致首轮全量解析的 13 次空响应**一次都没被重试**，
 * 而它们多数重试一次就能成功。
 */
const NON_RETRYABLE_KINDS: ReadonlySet<AiErrorKind> = new Set<AiErrorKind>([
  "auth",
  "bad_request",
  "output_not_json",
  "truncated",
  "schema_invalid"
]);

/**
 * 判断某错误类别是否值得重试。
 *
 * @param kind 错误类别
 * @returns 可重试时为 true（限流 / 超时 / 服务端错误 / 网络抖动 / 空响应）
 */
export function isRetryableKind(kind: AiErrorKind): boolean {
  return !NON_RETRYABLE_KINDS.has(kind);
}

/** 模型调用错误。 */
export class AiCallError extends Error {
  readonly kind     : AiErrorKind;
  /** 供上层决定是否重试（与 `kind` 保持一致，避免调用方重复判断）。 */
  readonly retryable: boolean;
  readonly status   : number | undefined;

  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "AiCallError";
    this.kind = kind;
    this.retryable = isRetryableKind(kind);
    this.status = status;
  }
}

/** 单次调用的请求参数。 */
export interface AiCompletionRequest {
  model       : string;
  /** 系统提示词（角色设定与任务约束）。 */
  system      : string;
  /** 用户消息（正文与具体指令）。 */
  user        : string;
  temperature?: number;
  /** 输出上限；命中该上限时上游会返回 `finish_reason = "length"`。 */
  maxTokens?  : number;
  /**
   * 思考模式；缺省时取 `AI_THINKING` 环境配置（默认 `disabled`）。
   * 显式传入可做单阶段 A/B（例如只对二审开启思考）。
   */
  thinking?   : "enabled" | "disabled";
}

/**
 * token 用量与成本。
 *
 * `reasoningTokens` 是**独立观测项**而非成本项：上游把思考 token 计入
 * `completion_tokens`（即 `tokensOut` 已包含它），所以计费口径无需额外相加。
 * 单独记录它是为了回答「钱到底花在思考还是正文上」——
 * 实测思考占输出 **82%**，不记录就只能看到总量、看不到构成。
 */
export interface AiUsage {
  tokensIn       : number;
  tokensOut      : number;
  /** 输出 token 中属于思考过程的部分（`tokensOut` 的子集）。 */
  reasoningTokens: number;
  /** 单价未知时为 null（此时按 0 记账并留档 `model_price_missing` 告警）。 */
  costUsd        : number | null;
}

/** 单次调用结果。 */
export interface AiCompletionResult {
  /** 模型返回的文本（已去除首尾空白，但保留原始内容不做 JSON 修复）。 */
  text        : string;
  usage       : AiUsage;
  latencyMs   : number;
  /** 命中输出上限时上层应走 JSON 修复而非重试。 */
  truncated   : boolean;
  finishReason: string | null;
}

/** OpenAI 兼容协议的响应体（仅声明用到的字段）。 */
interface ChatCompletionResponse {
  choices?: {
    message?      : { content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?            : number;
    completion_tokens?        : number;
    /** DeepSeek 等推理模型把思考用量放在此处。 */
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** 各模型的美元单价（每百万 token），用于成本记账。 */
interface ModelPrice {
  input : number;
  output: number;
}

/**
 * 人民币 → 美元汇率，用于把 DeepSeek 官方（人民币计价）单价折算成美元。
 *
 * 为什么必须显式给出而不是隐式按 1:1 相加：
 * 本模块的预算闸门（`assertWithinBudget`）与 `ANALYSIS_MONTHLY_BUDGET_USD`
 * 都以**美元**为单位，而 DeepSeek 官网单价以**人民币**公布。
 * 若遗漏这一步折算，¥8 的输出单价会被当成 $8，成本虚高约 7 倍 ——
 * 早期版本正是踩了这个坑（真实成本约 $0.53，账面却算成 $3.47）。
 *
 * 汇率是**估算值**，会随行情漂移；预算闸门按数量级拦住失控成本即可，
 * 不需要精确到分。需要精确核算时请以供应商账单为准。
 */
const CNY_PER_USD = 7.2;

/**
 * 单价表（**人民币** / 百万 token），来源：DeepSeek 官方定价页。
 *
 * 取值口径（见 `https://api-docs.deepseek.com/zh-cn/quick_start/pricing`）：
 * - 官网区分「空闲时段」与「高峰时段」，后者是前者的两倍；
 *   这里统一取**高峰时段**值，使预算估算偏保守（宁可高估，不可低估）。
 * - 官网区分「缓存命中 / 未命中」输入价。这里统一取**未命中**价 ——
 *   管线按全书逐片注入锚点，复用率低，且低估输入成本会让闸门失效。
 *
 * ⚠️ 模型名必须以**官网当前在用**的名字登记。早期版本登记的是
 * `deepseek-chat` / `deepseek-reasoner`，而实际配置里用的是
 * `deepseek-flash` / `deepseek-v4-pro` —— 名字对不上 → 全部查不到价 →
 * 每次调用都按 0 记账 → **预算闸门彻底失效**（实测首轮全量解析
 * 116 次调用、78 万 token，账面成本恒为 $0.0000）。
 */
const MODEL_PRICES_CNY: Readonly<Record<string, ModelPrice>> = {
  "deepseek-flash" : { input: 2, output: 8 },
  "deepseek-v4-pro": { input: 9, output: 27 }
};

/**
 * 估算成本（美元）；单价未知时返回 null。
 *
 * 单价未知时**返回 null 而非 0**：0 会被 `assertWithinBudget` 当作
 * 「这笔不花钱」，使预算闸门静默失效；null 则会让上层写入
 * `model_price_missing` 留档，把「闸门失效」变成可观察的问题。
 */
function estimateCost(model: string, tokensIn: number, tokensOut: number): number | null {
  const price = MODEL_PRICES_CNY[model];
  if (price === undefined) {
    return null;
  }
  const cny = (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
  return cny / CNY_PER_USD;
}

/**
 * 把 HTTP 状态码归类为错误类别。
 *
 * @param status HTTP 状态码
 * @returns 错误类别
 */
function classifyHttpStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 429) {
    return "rate_limit";
  }
  if (status === 408 || status === 504) {
    return "timeout";
  }
  if (status >= 500) {
    return "server_error";
  }
  return "bad_request";
}

/** 单次请求的超时上限（毫秒）。稠密分片下输出较长，给足余量但仍需兜底。 */
const REQUEST_TIMEOUT_MS = 180_000;

/**
 * 构造 OpenAI 兼容协议的请求体。
 *
 * 思考模式的开关方式（**实测结论，勿凭直觉改**）：
 * 上游是 DeepSeek 系推理模型，默认开启思考，思考 token 计入输出计费。
 * 实测同一输入三种写法的输出构成：
 *
 * | 写法                          | reasoning | content |
 * |-------------------------------|-----------|---------|
 * | 不传参（默认）                | 978 (82%) | 574 字  |
 * | `enable_thinking: false`      | 978 (82%) | 571 字  | ← **被静默忽略**
 * | `thinking: {type:"disabled"}` | 0 (0%)    | 706 字  | ← **唯一生效**
 *
 * 因此关闭思考只能用 `thinking: { type: "disabled" }`。
 * `enable_thinking` 是无效字段：传了既不报错也不生效，属于最危险的一类
 * 静默失败 —— 若按它实现，会以为已省下 64% 成本，实际一分没省。
 *
 * 开启思考时**不传该字段**（回落到供应商默认），避免给非推理模型
 * 传入它不认识的参数。
 *
 * @param request 请求参数
 * @param thinking 已解析的思考模式
 * @returns 可直接 JSON 序列化的请求体
 */
function buildRequestBody(
  request: AiCompletionRequest,
  thinking: "enabled" | "disabled"
): Record<string, unknown> {
  return {
    model      : request.model,
    temperature: request.temperature ?? 0,
    max_tokens : request.maxTokens ?? 8192,
    ...(thinking === "disabled" ? { thinking: { type: "disabled" } } : {}),
    messages   : [
      { role: "system", content: request.system },
      { role: "user", content: request.user }
    ]
  };
}

/**
 * 调用一次模型（OpenAI 兼容协议）。
 *
 * 不做任何重试 —— 重试决策由 `callWithRetry()` 统一承担，
 * 使「一次尝试」与「重试策略」解耦、可分别测试。
 *
 * @param request 请求参数
 * @returns 调用结果（含 token 用量、耗时与截断标记）
 * @throws {AiCallError} 网络失败、HTTP 非 2xx 或返回体不合法时抛出
 */
export async function callCompletion(
  request: AiCompletionRequest
): Promise<AiCompletionResult> {
  const env = getAiEnv();
  const startedAt = Date.now();
  const thinking = request.thinking ?? env.thinking;

  const body = JSON.stringify(buildRequestBody(request, thinking));

  let response: Response;
  try {
    response = await fetch(`${env.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method : "POST",
      headers: {
        "content-type": "application/json",
        authorization : `Bearer ${env.apiKey}`
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    throw new AiCallError(
      isTimeout ? "timeout" : "network",
      `模型请求失败：${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!response.ok) {
    const kind = classifyHttpStatus(response.status);
    // 截断响应体避免把整页 HTML 错误页打进日志。
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new AiCallError(kind, `模型返回 ${response.status}：${detail}`, response.status);
  }

  let payload: ChatCompletionResponse;
  try {
    payload = (await response.json()) as ChatCompletionResponse;
  } catch (error) {
    throw new AiCallError(
      "output_not_json",
      `无法解析模型响应体：${error instanceof Error ? error.message : String(error)}`
    );
  }

  const choice = payload.choices?.[0];
  const text = choice?.message?.content?.trim() ?? "";
  if (text.length === 0) {
    throw new AiCallError("empty_output", "模型返回空内容");
  }

  const finishReason = choice?.finish_reason ?? null;
  const tokensIn = payload.usage?.prompt_tokens ?? 0;
  const tokensOut = payload.usage?.completion_tokens ?? 0;
  // 思考 token 已包含在 tokens_out 内（上游口径），此处仅作独立观测。
  const reasoningTokens = payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

  return {
    text,
    usage: {
      tokensIn,
      tokensOut,
      reasoningTokens,
      costUsd: estimateCost(request.model, tokensIn, tokensOut)
    },
    latencyMs: Date.now() - startedAt,
    /**
     * 注意：本字段目前**没有消费方**（`truncated` 错误类由下游 JSON 修复
     * 失败时才判定，见 `pipeline/run.ts` 的 `parseModelJson`）。
     * 保留它是为将来「按 `finish_reason` 提前止损」留出观测点。
     */
    truncated: finishReason === "length",
    finishReason
  };
}

/** 重试策略参数。 */
export interface RetryOptions {
  /** 最大重试次数（不含首次尝试）。默认 2，与 v1 的 3×3 放大形成对比。 */
  maxRetries? : number;
  /** 退避基数（毫秒），实际等待为 `base * 2^attempt`。 */
  baseDelayMs?: number;
  /** 每次尝试前回调，用于写入调用审计。 */
  onAttempt?  : (attempt: number, error: AiCallError | null) => void;
}

/** 默认最大重试次数：仅覆盖瞬时故障，避免预算被单个分片吃掉。 */
export const DEFAULT_MAX_RETRIES = 2;

/** 默认退避基数。 */
export const DEFAULT_BASE_DELAY_MS = 1000;

/** 等待指定毫秒。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 带错误分类重试的模型调用。
 *
 * 行为：
 * - 仅对 `isRetryableKind()` 为真的类别退避重试；
 * - `output_not_json` / `truncated` / `schema_invalid` 等**立即向上抛出**，
 *   由管线交给确定性修复工序（见 `pipeline/repair-json.ts`）；
 * - `empty_output` **走重试**（瞬时故障，实测重发即成功）；
 * - 重试耗尽后抛出最后一次的错误。
 *
 * @param request 请求参数
 * @param options 重试策略
 * @returns 成功的调用结果
 * @throws {AiCallError} 不可重试类别，或重试次数耗尽
 */
export async function callWithRetry(
  request: AiCompletionRequest,
  options: RetryOptions = {}
): Promise<AiCompletionResult> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let lastError: AiCallError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    options.onAttempt?.(attempt, lastError);

    try {
      return await callCompletion(request);
    } catch (error) {
      if (!(error instanceof AiCallError)) {
        throw error;
      }
      lastError = error;
      if (!error.retryable || attempt === maxRetries) {
        throw error;
      }
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }

  // 循环必然在前面 return 或 throw；此处为类型完整性兜底。
  throw lastError ?? new AiCallError("network", "模型调用失败且无错误详情");
}

/** 供上层构建模型快照（写入 `analysis_runs.model_snapshot`）。 */
export interface ModelSnapshotSource {
  provider    : string;
  extractModel: string;
  reviewModel : string;
  temperature : number;
  /** 思考模式；冻结进快照，使「这次成本为何高/低」可事后归因。 */
  thinking    : "enabled" | "disabled";
}

/**
 * 读取当前环境下的模型配置快照。
 *
 * @returns 冻结到运行记录中的模型配置
 */
export function getModelSnapshot(): ModelSnapshotSource {
  const env = getAiEnv();
  return {
    provider    : env.provider,
    extractModel: env.extractModel,
    reviewModel : env.reviewModel,
    temperature : 0,
    thinking    : env.thinking
  };
}

/** 读取并发与预算配置（转发，便于管线模块只依赖本文件）。 */
export { getBudgetEnv };
