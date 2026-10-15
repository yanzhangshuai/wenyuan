import { describe, expect, it } from "vitest";

import { HONORIFIC_SUFFIXES, isHonorificForm } from "./name-form";

describe("isHonorificForm", () => {
  it("识别「前缀 + 尊称」形态（用户报告的第一类问题）", () => {
    expect(isHonorificForm("马二先生")).toBe(true);
    expect(isHonorificForm("卫先生")).toBe(true);
    expect(isHonorificForm("李老爷")).toBe(true);
    expect(isHonorificForm("倪老爹")).toBe(true);
    expect(isHonorificForm("凤四老爹")).toBe(true);
    expect(isHonorificForm("余大先生")).toBe(true);
  });

  it("识别官职/身份/庙号形态", () => {
    expect(isHonorificForm("向知县")).toBe(true);
    expect(isHonorificForm("蘧太守")).toBe(true);
    expect(isHonorificForm("徐侍郎")).toBe(true);
    expect(isHonorificForm("张乡绅")).toBe(true);
    expect(isHonorificForm("杨裁缝")).toBe(true);
    expect(isHonorificForm("太祖")).toBe(true);
    expect(isHonorificForm("成祖")).toBe(true);
  });

  it("识别排行 + 身份形态", () => {
    expect(isHonorificForm("胡三公子")).toBe(true);
    expect(isHonorificForm("三公子")).toBe(true);
    expect(isHonorificForm("鲁小姐")).toBe(true);
    expect(isHonorificForm("姚奶奶")).toBe(true);
  });

  it("本名不判为称谓", () => {
    expect(isHonorificForm("马纯上")).toBe(false);
    expect(isHonorificForm("卫体善")).toBe(false);
    expect(isHonorificForm("李梦阳")).toBe(false);
    expect(isHonorificForm("严致中")).toBe(false);
    expect(isHonorificForm("王冕")).toBe(false);
    expect(isHonorificForm("周进")).toBe(false);
    expect(isHonorificForm("杜少卿")).toBe(false);
  });

  it("刻意不收单字「公」：字/号不算敬称", () => {
    // 「陈正公」「陈眉公」里的「公」是字与号，本身即本名形式 ——
    // 若把它们判成称谓，会在候选键里错误地降级。
    expect(isHonorificForm("陈正公")).toBe(false);
    expect(isHonorificForm("陈眉公")).toBe(false);
    expect(isHonorificForm("周公")).toBe(false);
  });

  it("「公孙」不是「公子」，不得误伤", () => {
    expect(isHonorificForm("蘧公孙")).toBe(false);
  });

  it("光杆称谓不算「某人的称谓形式」", () => {
    // 「先生」本身是无指代对象的泛称（闸门已拒），不是我们要识别的形态。
    expect(isHonorificForm("先生")).toBe(false);
    expect(isHonorificForm("老爷")).toBe(false);
    expect(isHonorificForm("太祖")).toBe(true); // 反例：太祖是完整称谓
  });

  it("空串与空白返回 false", () => {
    expect(isHonorificForm("")).toBe(false);
    expect(isHonorificForm("   ")).toBe(false);
  });

  it("后缀表按长度降序（最长匹配优先）", () => {
    for (let i = 1; i < HONORIFIC_SUFFIXES.length; i += 1) {
      const previous = HONORIFIC_SUFFIXES[i - 1] ?? "";
      const current = HONORIFIC_SUFFIXES[i] ?? "";
      expect(previous.length).toBeGreaterThanOrEqual(current.length);
    }
  });
});
