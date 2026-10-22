import { describe, expect, it } from "vitest";

import {
  AUTH_DEFAULT_REDIRECT,
  isAcceptablePassword,
  isAdminRole,
  isValidEmail,
  isValidUsername,
  normalizeEmail,
  sanitizeRedirectPath
} from "./auth";

/**
 * 鉴权共享纯函数测试。
 *
 * 重点在 `sanitizeRedirectPath`：它是登录后跳转的**安全边界**，
 * 任何放宽（允许 `//evil.com`、反斜杠变体）都等于开放重定向。
 */

describe("sanitizeRedirectPath（登录跳转安全边界）", () => {
  it("站内路径原样返回", () => {
    expect(sanitizeRedirectPath("/admin/books")).toBe("/admin/books");
    expect(sanitizeRedirectPath("/book/abc?tab=graph")).toBe("/book/abc?tab=graph");
  });

  it("空值 / 非字符串回默认落点", () => {
    expect(sanitizeRedirectPath(null)).toBe(AUTH_DEFAULT_REDIRECT);
    expect(sanitizeRedirectPath(undefined)).toBe(AUTH_DEFAULT_REDIRECT);
    expect(sanitizeRedirectPath("")).toBe(AUTH_DEFAULT_REDIRECT);
  });

  it("拒绝协议相对与反斜杠变体（开放重定向）", () => {
    expect(sanitizeRedirectPath("//evil.com")).toBe(AUTH_DEFAULT_REDIRECT);
    expect(sanitizeRedirectPath("/\\evil.com")).toBe(AUTH_DEFAULT_REDIRECT);
    expect(sanitizeRedirectPath("https://evil.com")).toBe(AUTH_DEFAULT_REDIRECT);
    expect(sanitizeRedirectPath("admin")).toBe(AUTH_DEFAULT_REDIRECT);
  });

  it("拒绝回到登录页（避免登录循环）", () => {
    expect(sanitizeRedirectPath("/login")).toBe(AUTH_DEFAULT_REDIRECT);
    expect(sanitizeRedirectPath("/login?redirect=%2Fadmin")).toBe(AUTH_DEFAULT_REDIRECT);
  });
});

describe("账号字段校验", () => {
  it("邮箱：接受常规值，拒绝缺 @ 或缺域名后缀", () => {
    expect(isValidEmail("admin@wenyuan.local")).toBe(true);
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("admin")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
  });

  it("用户名：3–32 位字母数字下划线连字符", () => {
    expect(isValidUsername("admin")).toBe(true);
    expect(isValidUsername("a_b-c1")).toBe(true);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("张三")).toBe(false);
    expect(isValidUsername("a".repeat(33))).toBe(false);
  });

  it("密码：至少 8 位且不能全为同一字符", () => {
    expect(isAcceptablePassword("Wenyuan@2026")).toBe(true);
    expect(isAcceptablePassword("1234567")).toBe(false);
    expect(isAcceptablePassword("aaaaaaaa")).toBe(false);
  });

  it("邮箱归一化去空格并小写", () => {
    expect(normalizeEmail("  Admin@WenYuan.Local ")).toBe("admin@wenyuan.local");
  });
});

describe("角色判定", () => {
  it("只有 ADMIN 视为管理员", () => {
    expect(isAdminRole("ADMIN")).toBe(true);
    expect(isAdminRole("VIEWER")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole("admin")).toBe(false);
  });
});
