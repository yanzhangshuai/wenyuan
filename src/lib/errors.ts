/**
 * 前端业务错误类型。
 *
 * 约束：
 * - 只承载「可以直接展示给用户」的文案；
 * - 由 `lib/services/*` 在解析后端响应时构造，组件不自行拼装错误文案。
 */
export class ApiError extends Error {
  /** 稳定错误码，供调用方做分支判断；未知错误统一为 `UNKNOWN`。 */
  readonly code: string;

  constructor(message: string, code = "UNKNOWN") {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

/**
 * 把任意抛出物收敛成可展示文案。
 *
 * @param error 捕获到的异常
 * @param fallback 非业务异常时使用的兜底文案
 * @returns 面向用户的错误文案
 *
 * 设计原因：业务错误展示后端 message，其余一律用兜底文案，
 * 避免把堆栈或英文技术信息直接抛给用户。
 */
export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return fallback;
}
