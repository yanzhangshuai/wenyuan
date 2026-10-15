/**
 * 图谱节点的画布绘制（纯逻辑，便于单测）。
 *
 * ## 为什么单独成模块
 *
 * `react-force-graph-2d` 的绘制回调只能拿到 `CanvasRenderingContext2D`，
 * 里面既没有 DOM 也没有主题变量。把「半径 / 立体渐变 / 文字色 / 描边」这些
 * **可计算的视觉决策**抽出来，就能在 `vitest` 里直接断言，
 * 不必去截图比对（对齐 `ui-pixel-forensics` 的「从真实来源测量」原则）。
 *
 * ## 对齐 v1 的视觉语言
 *
 * v1 `wen-yuan` 的节点是 SVG `<path>`，立体感来自「纯色填充 + 描边 + 发光动画」，
 * 这里在 canvas 上用等价手段复刻：
 * - **3D 立体**：径向渐变（左上高光 → 本体色 → 右下压暗），模拟球面受光；
 * - **发光**：选中/hover 时叠一圈柔和光晕（v1 是 `verified-pulse` 呼吸，见 CSS）；
 * - **名字恒显**：v1 每个节点都画 `text`（`dy = radius + 14`），v3 同样恒显，
 *   且用**主题前景色**而非写死的黑 —— 否则在暗色主题下节点名会「消失」。
 */

/** 节点球面高光的相对位置（左上 30%），与常见 UI 光照约定一致。 */
const HIGHLIGHT_OFFSET_RATIO = -0.34;
/** 高光色混入比例：太高会洗白本体色，太低则看不出立体。 */
const HIGHLIGHT_MIX_RATIO = 0.5;
/** 暗部色混入比例。 */
const SHADOW_MIX_RATIO = 0.42;
/** 边缘光（rim light）混入比例：比本体亮、但弱于高光点，用于勾出球体轮廓。 */
const RIM_LIGHT_MIX_RATIO = 0.3;

/** 底部接触阴影：相对节点半径的偏移与缩放。 */
const SHADOW_OFFSET_RATIO = 0.16;
const SHADOW_RADIUS_RATIO = 1.02;
/** 接触阴影透明度（相对背景色混合）；过高会像糊了一圈脏污。 */
const SHADOW_ALPHA = 0.28;

export interface NodePaintColors {
  /** 节点本体色（主导关系分组色）。 */
  fill      : string;
  /** 主题前景色，用于节点名与描边。 */
  foreground: string;
  /** 画布背景色，用于在描边与标签底衬上做过渡。 */
  background: string;
}

/**
 * 把 16 进制色与另一色按比例混合。
 *
 * 只支持 `#rgb` / `#rrggbb`，其余格式（如 `oklch(...)`）原样返回 ——
 * 主题令牌当前全部是 16 进制，保持实现简单；遇到非预期格式时退化为「不变色」，
 * 也远好过抛错导致整张图画不出来。
 *
 * @param base  基础色
 * @param mixTo 混入色
 * @param ratio 混入比例（0 = 全 base，1 = 全 mixTo）
 * @returns 混合后的 `#rrggbb`；无法解析时返回 `base`
 */
export function mixHexColor(base: string, mixTo: string, ratio: number): string {
  const baseRgb = parseHexColor(base);
  const mixRgb = parseHexColor(mixTo);
  if (baseRgb === null || mixRgb === null) {
    return base;
  }
  const clamped = Math.min(1, Math.max(0, ratio));
  const channel = (from: number, to: number): number =>
    Math.round(from + (to - from) * clamped);
  return toHex(channel(baseRgb[0], mixRgb[0]), channel(baseRgb[1], mixRgb[1]), channel(baseRgb[2], mixRgb[2]));
}

/** 解析 `#rgb` / `#rrggbb` 为三元组；失败返回 null。 */
function parseHexColor(value: string): [number, number, number] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("#")) {
    return null;
  }
  const body = trimmed.slice(1);
  if (body.length === 3) {
    const r = Number.parseInt(`${body[0]}${body[0]}`, 16);
    const g = Number.parseInt(`${body[1]}${body[1]}`, 16);
    const b = Number.parseInt(`${body[2]}${body[2]}`, 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return null;
    }
    return [r, g, b];
  }
  if (body.length === 6) {
    const r = Number.parseInt(body.slice(0, 2), 16);
    const g = Number.parseInt(body.slice(2, 4), 16);
    const b = Number.parseInt(body.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return null;
    }
    return [r, g, b];
  }
  return null;
}

/** 三元组转 `#rrggbb`。 */
function toHex(r: number, g: number, b: number): string {
  const clampByte = (value: number): number => Math.min(255, Math.max(0, value));
  return `#${[r, g, b].map((value) => clampByte(value).toString(16).padStart(2, "0")).join("")}`;
}

/** 节点球面高光色（比本体色更亮）。 */
export function nodeHighlightColor(fill: string, foreground: string): string {
  return mixHexColor(fill, foreground, HIGHLIGHT_MIX_RATIO);
}

/** 节点球面暗部色（比本体色更暗）。 */
export function nodeShadowColor(fill: string, background: string): string {
  return mixHexColor(fill, background, SHADOW_MIX_RATIO);
}

/**
 * 节点**边缘光**色（rim light）。
 *
 * 3D 球体受单一方向光照射时，除了正对光的高光，另一端边缘还会出现
 * 一道细亮的轮廓光（现实中的「菲涅尔反射」）。只加高光不加边缘光，
 * 球体会显得像贴纸；补上这一道，立体感立刻成立。
 *
 * 实现上取「本体色混入少量前景色」——比本体亮、比高光弱，
 * 因此不会与左上高光抢焦点。
 */
export function nodeRimLightColor(fill: string, foreground: string): string {
  return mixHexColor(fill, foreground, RIM_LIGHT_MIX_RATIO);
}

/**
 * 节点名颜色。
 *
 * v1 用 `var(--foreground)` 直接描字；canvas 里没有 CSS 变量，
 * 因此由调用方把解析后的前景色传进来。这里只做「保证对比度」的兜底：
 * 传入空串时回退到浅色，避免整片黑字落在暗背景上。
 *
 * @param foreground 主题前景色
 * @returns 可直接用于 `fillStyle` 的颜色
 */
export function nodeLabelColor(foreground: string): string {
  return foreground.trim() === "" ? "#e8e4dc" : foreground;
}

/** 节点描边色：与前景色同源的半透明描边，让节点从背景里「立」起来。 */
export function nodeStrokeColor(foreground: string): string {
  return mixHexColor(nodeLabelColor(foreground), "#000000", 0.15);
}

/**
 * 选中节点的光晕半径倍数。
 *
 * v1 用 `drop-shadow` 做外发光；canvas 上没有等价滤镜，改用
 * 「更大半径 + 低 alpha 的同色圆」模拟，视觉接近且性能可控。
 */
export const NODE_GLOW_RADIUS_RATIO = 1.7;
/** 光晕透明度：过高会糊住邻近节点。 */
export const NODE_GLOW_ALPHA = 0.28;
/** 呼吸相位带来的额外光晕半径跨度（相对节点半径）。 */
export const NODE_GLOW_PULSE_SPAN = 0.35;
/** 呼吸一圈的时长（毫秒），对齐 v1 `verified-pulse` 的 2.5s。 */
export const NODE_GLOW_PULSE_PERIOD_MS = 2500;
/** hover 放大倍数（对齐 v1 `NODE_HOVER_SCALE = 1.1`）。 */
export const NODE_HOVER_SCALE = 1.1;
/** 选中放大倍数（对齐 v1 `NODE_ACTIVE_SCALE = 1.2`）。 */
export const NODE_ACTIVE_SCALE = 1.2;
/** 节点名与节点边缘的间距（对齐 v1 `dy = radius + 14`，这里按字号缩放）。 */
export const NODE_LABEL_GAP = 3;

/**
 * 计算节点当前应绘制半径。
 *
 * @param baseRadius 基础半径（由连接度算出）
 * @param state      交互态
 * @returns 绘制半径
 */
export function resolveNodeRadius(
  baseRadius: number,
  state: { isSelected: boolean; isHovered: boolean }
): number {
  if (state.isSelected) {
    return baseRadius * NODE_ACTIVE_SCALE;
  }
  if (state.isHovered) {
    return baseRadius * NODE_HOVER_SCALE;
  }
  return baseRadius;
}

/**
 * 计算节点名的字号。
 *
 * v1 规则（`force-graph.tsx:891`）：影响力超过中位线的节点用 12px，其余 10px。
 * 这里把「影响力」换成 v3 的「提及数」——同一语义（越重要越显眼），
 * 并用提及中位数作为分界，避免依赖绝对阈值。
 *
 * @param mentionCount 提及数
 * @param mentionMedian 全部可见节点的提及中位数
 * @returns 字号（px）
 */
export function resolveNodeLabelFontSize(mentionCount: number, mentionMedian: number): number {
  return mentionCount > mentionMedian ? 12 : 10;
}

/** 计算一组数值的中位数（空数组返回 0）。 */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * 在画布上绘制一个「立体球状」节点。
 *
 * 绘制顺序（每一步都对应一种真实的光学现象，缺一步就掉档次）：
 * ① **接触阴影** —— 球体下方偏右的暗椭圆，让节点「浮」在画布上；
 * ② **选中光晕** —— 放大且低透明度的同色圆，随相位呼吸；
 * ③ **球面渐变** —— 径向渐变（左上高光 → 本体 → 右下压暗），模拟球面受光；
 * ④ **边缘光** —— 右下外缘一道细弧，补上「菲涅尔反射」的读数；
 * ⑤ **描边** —— 让节点与背景分离，尤其在浅色主题下；
 * ⑥ **高光点** —— 左上更亮的小圆（带柔和渐变），强化球面读数。
 *
 * 只有纯色圆 = 用户抱怨的「贴片感」；只有①~③ = 有体积但材质发死；
 * 补上④⑥ 才是「有材质的球」。
 *
 * @param ctx      画布上下文
 * @param options  { x, y, radius, fill, foreground, background, isSelected, glowPhase }
 */
export function paintSphereNode(
  ctx: CanvasRenderingContext2D,
  options: {
    x         : number;
    y         : number;
    radius    : number;
    fill      : string;
    foreground: string;
    background: string;
    isSelected: boolean;
    /**
     * 光晕呼吸相位（0~1）。仅 `isSelected` 时有意义：
     * - 0 → 光晕最小、最淡；
     * - 1 → 光晕最大、最亮。
     * 不传时按 0 处理（静态光晕）。
     */
    glowPhase?: number;
  }
): void {
  const { x, y, radius, fill, foreground, background, isSelected } = options;
  const glowPhase = Math.min(1, Math.max(0, options.glowPhase ?? 0));
  const highlightX = x + radius * HIGHLIGHT_OFFSET_RATIO;
  const highlightY = y + radius * HIGHLIGHT_OFFSET_RATIO;

  // ① 接触阴影：偏右下的暗椭圆。半径很小时（如 3px 的孤立实体）跳过 ——
  //    缩到那种尺寸阴影只会变成一圈脏边。
  if (radius >= 5) {
    ctx.beginPath();
    ctx.ellipse(
      x + radius * SHADOW_OFFSET_RATIO,
      y + radius * SHADOW_OFFSET_RATIO * 1.4,
      radius * SHADOW_RADIUS_RATIO,
      radius * SHADOW_RADIUS_RATIO * 0.92,
      0,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = hexToRgba(nodeShadowColor(fill, background), SHADOW_ALPHA);
    ctx.fill();
  }

  // ② 选中光晕：叠一圈放大且低透明度的同色圆，半径/透明度随相位呼吸。
  if (isSelected) {
    const glowRadius = radius * (NODE_GLOW_RADIUS_RATIO + glowPhase * NODE_GLOW_PULSE_SPAN);
    const glowAlpha = NODE_GLOW_ALPHA * (0.6 + glowPhase * 0.7);
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(fill, glowAlpha);
    ctx.fill();
  }

  // ③ 球面径向渐变：高光在左上，暗部在右下。
  //    三个色标（高光 → 本体 → 暗部）＋ 中点偏移，比线性两段更像真实球体。
  const gradient = ctx.createRadialGradient(
    highlightX,
    highlightY,
    radius * 0.05,
    x,
    y,
    radius * 1.08
  );
  gradient.addColorStop(0, nodeHighlightColor(fill, foreground));
  gradient.addColorStop(0.42, fill);
  gradient.addColorStop(1, nodeShadowColor(fill, background));

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // ④ 边缘光：右下外缘一道细弧（菲涅尔反射）。
  //    用「描边 + 半透明」实现，只覆盖约 1/3 圈，避免变成一圈均匀亮边。
  if (radius >= 5) {
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.98, Math.PI * 0.08, Math.PI * 0.58);
    ctx.lineWidth = Math.max(0.5, radius * 0.07);
    ctx.strokeStyle = hexToRgba(nodeRimLightColor(fill, foreground), 0.5);
    ctx.stroke();
  }

  // ⑤ 描边：让节点与背景分离，尤其在浅色主题下。
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(0.6, radius * 0.07);
  ctx.strokeStyle = hexToRgba(nodeStrokeColor(foreground), 0.5);
  ctx.stroke();

  // ⑥ 高光点：一小块更亮的圆，带柔和渐变（硬边高光会显得像塑料）。
  const spotRadius = radius * 0.42;
  const spot = ctx.createRadialGradient(
    highlightX,
    highlightY,
    0,
    highlightX,
    highlightY,
    spotRadius
  );
  spot.addColorStop(0, hexToRgba(nodeHighlightColor(fill, foreground), 0.95));
  spot.addColorStop(0.6, hexToRgba(nodeHighlightColor(fill, foreground), 0.35));
  spot.addColorStop(1, hexToRgba(nodeHighlightColor(fill, foreground), 0));
  ctx.beginPath();
  ctx.arc(highlightX, highlightY, spotRadius, 0, Math.PI * 2);
  ctx.fillStyle = spot;
  ctx.fill();
}

/** 把 `#rrggbb` 转成 `rgba(...)`；无法解析时返回原色（不做半透明）。 */
export function hexToRgba(value: string, alpha: number): string {
  const rgb = parseHexColor(value);
  if (rgb === null) {
    return value;
  }
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${String(rgb[0])}, ${String(rgb[1])}, ${String(rgb[2])}, ${String(clamped)})`;
}
