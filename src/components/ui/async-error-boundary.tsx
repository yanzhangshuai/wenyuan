"use client";

import { Component, type ReactNode } from "react";

/**
 * 边界组件入参。
 * 字段语义：
 * - `children`：正常渲染内容；
 * - `fallback`：捕获到渲染异常后替代显示的降级 UI。
 */
interface AsyncErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

/**
 * 边界组件内部状态。
 * - `hasError`：是否已捕获到子树渲染错误。
 */
interface AsyncErrorBoundaryState {
  hasError: boolean;
}

/**
 * 文件定位（异步场景错误边界）：
 * - 文件路径：`src/components/ui/async-error-boundary.tsx`
 * - 所属层次：前端稳定性保障组件层（客户端组件）。
 *
 * 核心职责：
 * - 捕获子组件渲染阶段抛出的错误；
 * - 在异常时显示 fallback，避免整页白屏。
 *
 * React 语义：
 * - 采用 class component 是因为 React Error Boundary 当前基于类组件生命周期。
 */
export class AsyncErrorBoundary extends Component<AsyncErrorBoundaryProps, AsyncErrorBoundaryState> {
  override state: AsyncErrorBoundaryState = {
    hasError: false
  };

  /**
   * React 错误边界生命周期：
   * - 子树抛错后自动触发；
   * - 返回新状态使组件切换到 fallback 渲染分支。
   */
  static getDerivedStateFromError(): AsyncErrorBoundaryState {
    return { hasError: true };
  }

  override render() {
    // 异常分支：返回调用方传入的降级内容，保障用户至少看到可恢复提示。
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}
