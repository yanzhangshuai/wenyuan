import { describe, expect, it } from "vitest";

import {
  NODE_ACTIVE_SCALE,
  NODE_HOVER_SCALE,
  hexToRgba,
  medianOf,
  mixHexColor,
  nodeHighlightColor,
  nodeLabelColor,
  nodeRimLightColor,
  nodeShadowColor,
  paintSphereNode,
  resolveNodeLabelFontSize,
  resolveNodeRadius
} from "./node-paint";

describe("mixHexColor", () => {
  it("ratio=0 返回原色", () => {
    expect(mixHexColor("#102030", "#ffffff", 0)).toBe("#102030");
  });

  it("ratio=1 返回混合色", () => {
    expect(mixHexColor("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  it("按比例线性插值", () => {
    // 0x00 → 0xff 走 50% ≈ 0x80
    expect(mixHexColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("支持三位简写", () => {
    expect(mixHexColor("#000", "#fff", 0.5)).toBe("#808080");
  });

  it("非法颜色原样返回，不抛错", () => {
    expect(mixHexColor("oklch(0.5 0.1 200)", "#ffffff", 0.5)).toBe("oklch(0.5 0.1 200)");
  });

  it("ratio 超出 [0,1] 会被截断", () => {
    expect(mixHexColor("#000000", "#ffffff", 5)).toBe("#ffffff");
    expect(mixHexColor("#000000", "#ffffff", -3)).toBe("#000000");
  });
});

describe("nodeHighlightColor / nodeShadowColor / nodeRimLightColor", () => {
  it("高光比本体更接近前景色（更亮）", () => {
    const highlight = nodeHighlightColor("#5a6f8b", "#ffffff");
    expect(highlight).not.toBe("#5a6f8b");
    // 每个通道都不应低于原色
    expect(Number.parseInt(highlight.slice(1, 3), 16)).toBeGreaterThanOrEqual(0x5a);
  });

  it("暗部比本体更接近背景色", () => {
    const shadow = nodeShadowColor("#5a6f8b", "#101010");
    expect(Number.parseInt(shadow.slice(1, 3), 16)).toBeLessThanOrEqual(0x5a);
  });

  it("边缘光比本体亮、但弱于高光（否则抢焦点）", () => {
    const fill = "#3d7a4a";
    const foreground = "#ffffff";
    const rim = nodeRimLightColor(fill, foreground);
    const highlight = nodeHighlightColor(fill, foreground);
    const channel = (value: string): number => Number.parseInt(value.slice(1, 3), 16);
    expect(channel(rim)).toBeGreaterThan(channel(fill));
    expect(channel(rim)).toBeLessThan(channel(highlight));
  });
});

describe("paintSphereNode", () => {
  /** 记录调用序列的最小 ctx 桩（只覆盖 `paintSphereNode` 会用到的方法）。 */
  function makeCtx(): {
    ctx      : CanvasRenderingContext2D;
    calls    : string[];
    gradients: { stops: number }[];
  } {
    const calls: string[] = [];
    const gradients: { stops: number }[] = [];
    const gradient = {
      stops: 0,
      addColorStop(): void {
        this.stops += 1;
      }
    };
    const record = (name: string): void => {
      calls.push(name);
    };
    const ctx = {
      calls,
      beginPath           : (): void => { record("beginPath"); },
      arc                 : (): void => { record("arc"); },
      ellipse             : (): void => { record("ellipse"); },
      fill                : (): void => { record("fill"); },
      stroke              : (): void => { record("stroke"); },
      createRadialGradient: (): typeof gradient => {
        const created = { ...gradient, stops: 0 };
        gradients.push(created);
        return created;
      },
      fillStyle  : "" as string | CanvasGradient,
      strokeStyle: "" as string | CanvasGradient,
      lineWidth  : 1
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls, gradients };
  }

  const base = {
    x         : 40,
    y         : 40,
    radius    : 20,
    fill      : "#3d7a4a",
    foreground: "#ffffff",
    background: "#101418",
    isSelected: false
  };

  it("默认（未选中）不画光晕：arc 调用数应少于选中态", () => {
    const normal = makeCtx();
    paintSphereNode(normal.ctx, base);
    const selected = makeCtx();
    paintSphereNode(selected.ctx, { ...base, isSelected: true });
    const count = (calls: string[]): number => calls.filter((call) => call === "arc").length;
    expect(count(selected.calls)).toBeGreaterThan(count(normal.calls));
  });

  it("包含球面渐变与高光点两个径向渐变（3D 立体的必要条件）", () => {
    const { ctx, gradients } = makeCtx();
    paintSphereNode(ctx, base);
    // ③ 球面渐变（3 个色标）+ ⑥ 高光点（3 个色标）
    expect(gradients).toHaveLength(2);
    expect(gradients.every((gradient) => gradient.stops >= 3)).toBe(true);
  });

  it("大半径画接触阴影（ellipse），极小半径跳过（避免糊成一圈脏边）", () => {
    const big = makeCtx();
    paintSphereNode(big.ctx, base);
    expect(big.calls).toContain("ellipse");

    const tiny = makeCtx();
    paintSphereNode(tiny.ctx, { ...base, radius: 3 });
    expect(tiny.calls).not.toContain("ellipse");
  });

  it("绘制顺序：接触阴影先于渐变填充，填充先于描边", () => {
    const { ctx, calls } = makeCtx();
    paintSphereNode(ctx, base);
    const indexOf = (call: string): number => calls.indexOf(call);
    expect(indexOf("ellipse")).toBeLessThan(indexOf("fill"));
    expect(indexOf("stroke")).toBeGreaterThan(indexOf("fill"));
  });
});

describe("nodeLabelColor", () => {
  it("传入有效前景色时原样使用", () => {
    expect(nodeLabelColor("#e8e4dc")).toBe("#e8e4dc");
  });

  it("空串回退到浅色，避免暗底黑字看不清", () => {
    expect(nodeLabelColor("")).toBe("#e8e4dc");
    expect(nodeLabelColor("   ")).toBe("#e8e4dc");
  });
});

describe("resolveNodeRadius", () => {
  it("常态返回基础半径", () => {
    expect(resolveNodeRadius(10, { isSelected: false, isHovered: false })).toBe(10);
  });

  it("hover 放大到 NODE_HOVER_SCALE", () => {
    expect(resolveNodeRadius(10, { isSelected: false, isHovered: true })).toBeCloseTo(
      10 * NODE_HOVER_SCALE
    );
  });

  it("选中优先于 hover，放大到 NODE_ACTIVE_SCALE", () => {
    expect(resolveNodeRadius(10, { isSelected: true, isHovered: true })).toBeCloseTo(
      10 * NODE_ACTIVE_SCALE
    );
  });
});

describe("resolveNodeLabelFontSize", () => {
  it("高于中位数用 12px", () => {
    expect(resolveNodeLabelFontSize(30, 10)).toBe(12);
  });

  it("等于中位数用 10px（严格大于才算突出）", () => {
    expect(resolveNodeLabelFontSize(10, 10)).toBe(10);
  });

  it("低于中位数用 10px", () => {
    expect(resolveNodeLabelFontSize(3, 10)).toBe(10);
  });
});

describe("medianOf", () => {
  it("空数组返回 0", () => {
    expect(medianOf([])).toBe(0);
  });

  it("奇数个取中间值", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
  });

  it("偶数个取中间两数均值", () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
  });

  it("不修改入参数组", () => {
    const input = [3, 1, 2];
    medianOf(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("hexToRgba", () => {
  it("转成 rgba 字符串", () => {
    expect(hexToRgba("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("alpha 超出范围被截断", () => {
    expect(hexToRgba("#000000", 9)).toBe("rgba(0, 0, 0, 1)");
    expect(hexToRgba("#000000", -1)).toBe("rgba(0, 0, 0, 0)");
  });

  it("非法颜色原样返回", () => {
    expect(hexToRgba("not-a-color", 0.5)).toBe("not-a-color");
  });
});
