import { describe, expect, it } from "vitest";

import { collapseWhitespace, normalizeName } from "./text";

describe("normalizeName", () => {
  it("去除内部与首尾空白（含全角空格）", () => {
    expect(normalizeName("司马 光")).toBe("司马光");
    expect(normalizeName("　范进　")).toBe("范进");
  });

  it("折叠全角字母与数字", () => {
    expect(normalizeName("ＡＢＣ１２３")).toBe("abc123");
  });

  it("大小写折叠后等价", () => {
    expect(normalizeName("Darcy")).toBe(normalizeName("DARCY"));
  });

  it("纯空白输入返回空串", () => {
    expect(normalizeName("   ")).toBe("");
  });
});

describe("collapseWhitespace", () => {
  it("折叠连续空白为单个半角空格并去首尾", () => {
    expect(collapseWhitespace("  张三   李四  ")).toBe("张三 李四");
  });
});
