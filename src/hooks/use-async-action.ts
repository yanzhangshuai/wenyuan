"use client";

import { useCallback, useState } from "react";

import { toErrorMessage } from "@/lib/errors";

export interface AsyncActionResult {
  /** 动作是否进行中；语义为「动作」而非「读取」，故命名 pending。 */
  pending : boolean;
  /** 当前错误文案；未出错时为 null。 */
  error   : string | null;
  /** 供不经过 run() 的错误写入（例如外部校验失败）。 */
  setError: (message: string | null) => void;
  /**
   * 执行异步动作。
   *
   * @param action 实际业务动作
   * @param errorMessage 可选的本次动作兜底文案
   * @returns 成功为 true，失败为 false；导航等后续决策由调用方承担
   */
  run     : (action: () => Promise<void>, errorMessage?: string) => Promise<boolean>;
}

/**
 * 异步动作统一外壳。
 *
 * 职责（只做这四件，不承担导航）：
 * 1. 清空上一次错误
 * 2. 置 pending
 * 3. 执行动作并把异常翻译成用户可读文案
 * 4. 解除 pending
 *
 * @param defaultErrorMessage 未显式传入时的兜底错误文案
 * @returns 动作状态与执行入口
 */
export function useAsyncAction(defaultErrorMessage: string): AsyncActionResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<void>, errorMessage = defaultErrorMessage): Promise<boolean> => {
      setError(null);
      setPending(true);
      try {
        await action();
        return true;
      } catch (e) {
        setError(toErrorMessage(e, errorMessage));
        return false;
      } finally {
        setPending(false);
      }
    },
    [defaultErrorMessage]
  );

  return { pending, error, setError, run };
}
