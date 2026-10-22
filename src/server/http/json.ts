import { NextResponse } from "next/server";

/**
 * Route Handler 的统一响应形状。
 *
 * 约定：所有接口都返回 `{ ok: boolean, ... }`，前端只需判 `ok`，
 * 错误码用于区分「可提示用户」与「应记录日志」两类情况。
 */

/** 成功响应。 */
export function jsonOk(data: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...data }, { status });
}

/** 失败响应。 */
export function jsonFail(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ ok: false, code, message, ...extra }, { status });
}

/**
 * 安全读取 JSON 请求体。
 *
 * @param request 请求对象
 * @returns 解析结果；非 JSON 返回 `null`
 */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}
