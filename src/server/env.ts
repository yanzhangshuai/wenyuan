import "server-only";

import { existsSync } from "node:fs";

import { z } from "zod";

/**
 * 服务端环境变量访问入口。
 *
 * 设计原因：
 * - `tsx` 脚本（迁移、导入、评测）不会自动读取 `.env`，而 Next.js 运行时会；
 *   在此统一按需加载，避免每个脚本重复实现；
 * - 用 Zod 做启动期校验：缺失变量在进程启动时立即失败，而不是拖到首次查询才暴露；
 * - 拆成「基础设施变量」与「AI 变量」两组：数据层脚本与 `next build`
 *   不需要模型凭据，若合并校验会强迫这些场景也配置 `AI_API_KEY`。
 *
 * 约束：本文件带 `import "server-only"` 以阻止客户端组件误引服务端配置。
 * 该包在纯 Node 环境下会抛错，因此**所有脚本必须带 `--conditions=react-server` 运行**
 * （`package.json` 的 `db:*` / `import:book` / `eval` 脚本已内置该参数）。
 */

/** 基础设施变量：任何连接数据库的场景都需要。 */
const infraEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL 不能为空")
});

/** AI 供应商变量：仅在真正调用解析管线时需要。 */
const aiEnvSchema = z.object({
  /** 供应商名称，仅用于审计留档（如 `deepseek` / `qwen` / `glm`）。 */
  provider    : z.string().min(1).default("openai-compatible"),
  /** OpenAI 兼容协议的 base URL，例如 `https://api.deepseek.com/v1`。 */
  baseUrl     : z.url("AI_BASE_URL 必须是合法 URL"),
  apiKey      : z.string().min(1, "AI_API_KEY 不能为空"),
  /** 粗筛与提取使用的模型（追求吞吐与成本）。 */
  extractModel: z.string().min(1, "AI_MODEL_EXTRACT 不能为空"),
  /** 二审与仲裁使用的模型（追求准确率）。 */
  reviewModel : z.string().min(1, "AI_MODEL_REVIEW 不能为空"),
  /**
   * 思考模式开关（对应 `AI_THINKING`）。
   *
   * 为什么默认 `disabled`：实测本管线的模型（`deepseek-flash`）默认开启思考，
   * 思考 token 计入输出计费且占输出的 **82%**；更严重的是思考会先于正文
   * 消耗 `max_tokens`，一旦吃满就产出**空正文**（实测把上限收到 512 时，
   * 思考独占 512、正文 0 字）。关闭后输出 token 降 **77%**、总成本降 **64%**，
   * 且正文长度反而更长。完整实测数据见 `modules/ai/client.ts` 的 `thinking` 说明。
   *
   * 设为 `enabled` 即恢复供应商默认行为（不显式传参），便于做 A/B 对比。
   */
  thinking    : z.enum(["enabled", "disabled"]).default("disabled")
});

/** 管线限流与预算（带默认值，因此单独成组，不阻塞其他场景）。 */
const budgetEnvSchema = z.object({
  /** 并发调用上限。数字型变量经 coerce 转换，非法值在启动期即失败。 */
  concurrency: z.coerce.number().int().min(1).max(32).default(3),
  /** 单次运行的美元预算上限，超出后管线主动中止。 */
  budgetUsd  : z.coerce.number().positive().default(50)
});

/** 已校验的基础设施环境变量。 */
export interface ServerEnv { DATABASE_URL: string }

/** 已校验的 AI 供应商配置。 */
export type AiEnv = z.infer<typeof aiEnvSchema>;

/** 已校验的管线限流与预算配置。 */
export type BudgetEnv = z.infer<typeof budgetEnvSchema>;

let infraCache: ServerEnv | null = null;
let aiCache: AiEnv | null = null;
let budgetCache: BudgetEnv | null = null;

/** 校验失败时抛出的统一错误（含全部问题项，便于一次改正）。 */
function buildValidationError(scope: string, error: z.ZodError): Error {
  const detail = error.issues
    .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
    .join("; ");
  return new Error(`${scope}校验失败 — ${detail}`);
}

/**
 * 读取并校验基础设施环境变量。
 *
 * @returns 已校验的环境变量对象（首次调用后缓存）
 * @throws 当必填变量缺失或为空时抛出，错误信息包含具体变量名
 */
export function getServerEnv(): ServerEnv {
  if (infraCache) {
    return infraCache;
  }

  // Node 内置 .env 解析，无需引入 dotenv。
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }

  const parsed = infraEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw buildValidationError("服务端环境变量", parsed.error);
  }

  infraCache = parsed.data;
  return infraCache;
}

/**
 * 读取并校验 AI 供应商配置。
 *
 * @returns 已校验的 AI 配置（首次调用后缓存）
 * @throws 当 `AI_*` 之一缺失或格式非法时抛出
 */
export function getAiEnv(): AiEnv {
  if (aiCache) {
    return aiCache;
  }

  // 复用基础设施读取路径，确保 `.env` 已加载（幂等）。
  getServerEnv();

  const parsed = aiEnvSchema.safeParse({
    provider    : process.env.AI_PROVIDER_NAME,
    baseUrl     : process.env.AI_BASE_URL,
    apiKey      : process.env.AI_API_KEY,
    extractModel: process.env.AI_MODEL_EXTRACT,
    reviewModel : process.env.AI_MODEL_REVIEW,
    thinking    : process.env.AI_THINKING
  });
  if (!parsed.success) {
    throw buildValidationError("AI 环境变量", parsed.error);
  }

  aiCache = parsed.data;
  return aiCache;
}

/**
 * 读取并校验管线限流与预算配置。
 *
 * @returns 已校验的预算配置（首次调用后缓存）
 */
export function getBudgetEnv(): BudgetEnv {
  if (budgetCache) {
    return budgetCache;
  }

  getServerEnv();

  const parsed = budgetEnvSchema.safeParse({
    concurrency: process.env.ANALYSIS_CONCURRENCY,
    budgetUsd  : process.env.ANALYSIS_MONTHLY_BUDGET_USD
  });
  if (!parsed.success) {
    throw buildValidationError("管线预算环境变量", parsed.error);
  }

  budgetCache = parsed.data;
  return budgetCache;
}
