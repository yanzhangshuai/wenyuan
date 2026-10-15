import { describe, expect, it } from "vitest";

import { THEME_TOKENS, getEdgeTypeColorsForTheme, getNodeColorsForTheme } from "./index";

/** 允许出现在色盘里的 16 进制格式（三位或六位）。 */
const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const THEME_IDS = ["danqing", "suya", "diancang", "xingkong"] as const;

/** 把 `#rrggbb` 转 HSL。三位简写会先展开。 */
function toHsl(hex: string): { hue: number; saturation: number } {
  const body = hex.slice(1);
  const full =
    body.length === 3
      ? `${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
      : body;
  const r = Number.parseInt(full.slice(0, 2), 16) / 255;
  const g = Number.parseInt(full.slice(2, 4), 16) / 255;
  const b = Number.parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (delta === 0) {
    return { hue: 0, saturation: 0 };
  }
  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  return { hue: ((hue * 60) % 360 + 360) % 360, saturation };
}

/** 中性色（低饱和）的色相不稳定，不参与夹角约束。 */
const NEUTRAL_SATURATION_THRESHOLD = 0.15;

/** 两色相之间的最小角距（考虑环绕）。 */
function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return Math.min(raw, 360 - raw);
}

describe("nodeColors 主题契约", () => {
  it.each(THEME_IDS)("%s：节点色盘与边色盘同为 5 色（对齐 RelationCategory 0..4）", (themeId) => {
    const tokens = THEME_TOKENS[themeId];
    expect(tokens.nodeColors).toHaveLength(5);
    expect(tokens.edgeTypeColors).toHaveLength(5);
  });

  it.each(THEME_IDS)("%s：每个节点色都是合法 16 进制", (themeId) => {
    for (const color of THEME_TOKENS[themeId].nodeColors) {
      expect(color).toMatch(HEX_PATTERN);
    }
  });

  it.each(THEME_IDS)("%s：节点色盘内无重复色（重复等于白设一档）", (themeId) => {
    const colors = THEME_TOKENS[themeId].nodeColors;
    expect(new Set(colors).size).toBe(colors.length);
  });

  it.each(THEME_IDS)("%s：节点色色相铺开，任两彩色最小角距 ≥ 25°（「一片糊」是本缺陷的根因）", (themeId) => {
    const colored = THEME_TOKENS[themeId].nodeColors
      .map(toHsl)
      .filter((hsl) => hsl.saturation > NEUTRAL_SATURATION_THRESHOLD);
    // 至少要有 4 个「有彩」的档位，否则铺开无从谈起。
    expect(colored.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < colored.length; i += 1) {
      for (let j = i + 1; j < colored.length; j += 1) {
        expect(hueDistance(colored[i]?.hue ?? 0, colored[j]?.hue ?? 0)).toBeGreaterThanOrEqual(25);
      }
    }
  });

  it.each(THEME_IDS)("%s：节点色与边色同索引但色值不同（球体 vs 细线的明度需求不同）", (themeId) => {
    const tokens = THEME_TOKENS[themeId];
    for (let index = 0; index < 5; index += 1) {
      expect(tokens.nodeColors[index]).not.toBe(tokens.edgeTypeColors[index]);
    }
  });

  it("四主题的节点色盘两两不同（避免「切了主题却看不出」）", () => {
    const signatures = THEME_IDS.map((id) => THEME_TOKENS[id].nodeColors.join(","));
    expect(new Set(signatures).size).toBe(THEME_IDS.length);
  });
});

describe("getNodeColorsForTheme", () => {
  it("命中主题返回该主题色盘", () => {
    expect(getNodeColorsForTheme("danqing")).toEqual(THEME_TOKENS.danqing.nodeColors);
  });

  it("未知名回退到 suya 默认（防御式容错，不抛错）", () => {
    expect(getNodeColorsForTheme("not-a-theme")).toEqual(THEME_TOKENS.suya.nodeColors);
    expect(getNodeColorsForTheme(undefined)).toEqual(THEME_TOKENS.suya.nodeColors);
  });

  it("v3 主题 key 是 wenyuan-v3-theme（与 v1 的 wy-theme 区分）", () => {
    // 回归护栏：曾把 v1 的存储键抄进来，导致主题永远读不到。
    expect(getNodeColorsForTheme("wy-theme")).toEqual(THEME_TOKENS.suya.nodeColors);
  });

  it("与边色盘 getter 同主题下返回不同数组（两个图层独立）", () => {
    expect(getNodeColorsForTheme("xingkong")).not.toEqual(getEdgeTypeColorsForTheme("xingkong"));
  });
});
