/**
 * 文件定位（前端主题系统常量层）：
 * - 该文件定义主题系统的“受控枚举”和“展示选项”。
 * - 在 Next.js 中，它会被客户端主题切换组件、服务端渲染的样式变量注入逻辑共同引用。
 *
 * 业务职责：
 * - 提供统一主题 ID，避免业务代码散落硬编码字符串；
 * - 提供展示文案，让 UI 层直接渲染可读主题名。
 *
 * 维护边界：
 * - 主题配色细节在 `tokens/` 下维护；本文件只维护“主题身份与显示信息”；
 * - 主题 ID 是跨层契约（本地存储、URL 参数、样式映射都可能依赖），不应随意改名。
 */

/**
 * 系统支持的主题 ID 列表（受控枚举）。
 * 业务语义：
 * - 该列表既用于 UI 选择，也用于主题 token 索引；
 * - 值顺序即默认展示顺序。
 */
export const THEME_IDS = ["danqing", "suya", "diancang", "xingkong"] as const;
/**
 * 单个主题 ID 类型。
 * 设计原因：
 * - 由 `THEME_IDS` 反向推导，确保“运行时值集合”和“编译期联合类型”天然同步；
 * - 避免手写 `type ThemeId = ...` 后因漏改产生的隐性类型漂移。
 */
export type ThemeId = (typeof THEME_IDS)[number];

/**
 * 主题下拉展示配置。
 * 字段语义：
 * - `value`：真实主题 ID（会参与状态存储与样式切换）；
 * - `label`：用户可读中文名（仅展示用途）。
 */
export const THEME_OPTIONS = [
  { value: "danqing",  label: "丹青" },
  { value: "suya",     label: "素雅" },
  { value: "diancang", label: "典藏" },
  { value: "xingkong", label: "星空" }
] as const;
