/**
 * 文件定位（主题模块 Barrel 导出）：
 * - 文件路径：`src/components/theme/index.ts`
 * - 所属层次：前端公共组件聚合层（对外 API 门面）。
 *
 * 核心职责：
 * 1) 统一导出主题系统相关能力，减少调用方对内部目录结构的感知；
 * 2) 为页面/布局提供稳定导入路径，降低后续重构目录时的修改范围；
 * 3) 将“主题 Provider + 主题切换组件 + 主题状态 Hook + 装饰视觉组件”作为一组能力对外暴露。
 *
 * 业务意图：
 * - 主题是跨页面的横切关注点，使用 Barrel 统一出口可让上下游协作更清晰：
 *   上游（页面/布局）只关心“我要用哪些主题能力”，不关心文件分散在哪。
 *
 * 维护注意：
 * - 这里的导出清单属于模块公共契约，删除或改名会影响大量下游导入点；
 * - 若新增主题能力，建议优先从此文件导出，保持调用侧入口一致。
 */
export { ThemeProvider } from "./provider";
export { ThemeToggle } from "./toggle";
export { useHydratedTheme } from "../../hooks/use-hydrated-theme";
export { DecorativeLayer } from "./decorative/decorative-layer";
export { ClientThemeBackground } from "./client-theme-background";
export { ThemeBackground } from "./theme-background";
export { WenYuanSeal } from "./decorative/web-seal";
