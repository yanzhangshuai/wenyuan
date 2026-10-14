/**
 * 文件定位（主题领域统一出口）：
 * - 文件路径：`src/theme/index.ts`
 * - 所属层次：前端公共主题层（barrel 聚合导出）。
 *
 * 核心职责：
 * 1) 向上游页面/组件暴露“主题 ID、主题选项、主题 Token”等稳定契约；
 * 2) 避免调用方直接依赖内部目录结构，降低未来重构成本；
 * 3) 把“主题定义”与“主题展示”统一到一个可预测入口。
 *
 * 维护注意：
 * - 这里导出的标识属于跨模块公共 API，删除或改名会影响大量下游；
 * - 本文件只负责导出，不应放置运行时副作用逻辑。
 */
// Theme constants & types
export { THEME_IDS, THEME_OPTIONS } from "./constants";
export type { ThemeId } from "./constants";

// Per-theme tokens (faction colors, utilities)
export { THEME_TOKENS, getFactionColorsForTheme, getEdgeTypeColorsForTheme } from "./tokens";
export type { ThemeTokens } from "./tokens";
