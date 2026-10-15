import type { ThemeId } from "../constants";

import { danqing  } from "./danqing";
import { diancang } from "./diancang";
import { suya     } from "./suya";
import { xingkong } from "./xingkong";

/**
 * 文件定位（主题 Token 聚合层）：
 * - 该文件把各主题的 token（颜色/标签）整合成统一映射，并提供安全读取方法。
 * - 属于前端“设计系统数据层”，不直接渲染 UI，但决定组件最终视觉输出。
 */

/**
 * 主题 Token 统一类型。
 *
 * 字段业务语义：
 * - `id`：主题唯一标识（必须与 `ThemeId` 一致）；
 * - `label`：主题中文显示名；
 * - `edgeTypeColors`：**边**色盘，下标 = 关系语义分组（`RelationCategory`）；
 * - `nodeColors`：**节点球体**色盘，下标同关系语义分组。
 */
export interface ThemeTokens {
  /** 主题唯一 ID：必须与 ThemeId 对齐，作为映射主键参与查表。 */
  readonly id            : ThemeId;
  /** 主题在选择器中的中文名称，仅用于展示。 */
  readonly label         : string;
  /**
   * 关系类型颜色盘：按索引顺序依次分配给图谱中出现的关系类型。
   * 用于前端 ForceGraph 边着色与图例展示；顺序稳定后不建议调整，以免颜色突变。
   */
  readonly edgeTypeColors: readonly string[];
  /**
   * 节点球体颜色盘：按索引对应关系语义分组，用于**节点填充**。
   *
   * 与 `edgeTypeColors` 同索引、不同色值 —— 边是细线、节点是实心球，
   * 对明度/饱和度的需求不同（见各主题文件内的说明）。
   */
  readonly nodeColors    : readonly string[];
}

/**
 * 全量主题 Token 映射表。
 * 设计原因：
 * - 通过 `Record<ThemeId, ThemeTokens>` 保证每个主题 ID 都有对应 Token；
 * - 避免在运行时出现“某主题缺失配置”的隐性错误。
 */
export const THEME_TOKENS: Record<ThemeId, ThemeTokens> = {
  danqing : danqing,
  suya    : suya,
  diancang: diancang,
  xingkong: xingkong
};

/**
 * 按主题获取节点球体颜色盘。
 *
 * @param theme 主题 ID（可能来自 URL、localStorage 或用户设置，允许为空）
 * @returns 对应主题的节点色数组；若参数无效则回退到 `suya` 默认配色
 *
 * 分支说明：
 * - `theme` 存在且命中映射：返回对应主题颜色；
 * - 其余情况回退默认主题：这是防御式容错，避免异常输入导致 UI 崩溃。
 */
export function getNodeColorsForTheme(theme: string | undefined): readonly string[] {
  // 先检查入参是否存在且命中映射：避免外部输入（URL/localStorage）污染导致运行时报错。
  if (theme && theme in THEME_TOKENS) {
    return THEME_TOKENS[theme as ThemeId].nodeColors;
  }
  // 无效值统一回退到 `suya`：这是产品默认主题策略，不是技术限制。
  return THEME_TOKENS.suya.nodeColors;
}

/**
 * 按主题获取关系类型颜色盘。
 *
 * @param theme 主题 ID（可能来自 URL、localStorage 或用户设置，允许为空）
 * @returns 对应主题的边类型颜色数组；若参数无效则回退到 `suya` 默认配色
 *
 * 分支说明：
 * - `theme` 存在且命中映射：返回对应主题颜色；
 * - 其余情况回退默认主题：这是防御式容错，避免异常输入导致 UI 崩溃。
 */
export function getEdgeTypeColorsForTheme(theme: string | undefined): readonly string[] {
  if (theme && theme in THEME_TOKENS) {
    return THEME_TOKENS[theme as ThemeId].edgeTypeColors;
  }
  return THEME_TOKENS.suya.edgeTypeColors;
}
