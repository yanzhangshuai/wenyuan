import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 后台与鉴权的**接线契约**。
 *
 * 纯函数测试保证「算得对」，这里保证「接得上」：
 * 中间件真的拦了后台、布局真的二次校验、注册真的只给 VIEWER、登录页真的没有死链。
 * 断言前先剥注释——否则解释性注释会被误判成违规代码（项目既有教训）。
 */

const ROOT = process.cwd();

function codeOnlyOf(relativePath: string): string {
  const source = readFileSync(path.resolve(ROOT, relativePath), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

const proxy = codeOnlyOf("src/proxy.ts");
const adminLayout = codeOnlyOf("src/app/admin/layout.tsx");
const loginView = codeOnlyOf("src/app/login/login-view.tsx");
const registerRoute = codeOnlyOf("src/app/api/auth/register/route.ts");
const authService = codeOnlyOf("src/server/modules/auth/service.ts");
const importRoute = codeOnlyOf("src/app/api/admin/import/route.ts");

describe("中间件门禁", () => {
  it("只匹配后台路径", () => {
    expect(proxy).toContain('"/admin/:path*"');
    expect(proxy).toContain("matcher");
  });

  it("验签后放行，失败重定向到登录并带上回跳地址", () => {
    expect(proxy).toContain("verifyAuthToken");
    expect(proxy).toContain("sanitizeRedirectPath");
    expect(proxy).toContain('url.pathname = "/login"');
  });
});

describe("后台布局二次鉴权", () => {
  it("读取会话并要求 ADMIN 角色", () => {
    expect(adminLayout).toContain("getAuthContext");
    expect(adminLayout).toContain("AUTH_ADMIN_ROLE");
    expect(adminLayout).toMatch(/if\s*\(\s*auth\.role\s*!==\s*AUTH_ADMIN_ROLE\s*\)/u);
  });

  it("未通过时 redirect 到登录页（而非渲染内容）", () => {
    expect(adminLayout).toContain("redirect(");
    expect(adminLayout).toContain("/login?redirect=");
  });

  it("登录守卫是真实分支，不是只 import 了函数", () => {
    // 变异教训：只断言 `toContain("getAuthContext")` 时，
    // 删掉守卫分支后 import 仍会命中，测试假绿。
    expect(adminLayout).toMatch(/if\s*\(\s*auth\s*===\s*null\s*\)/u);
  });

  it("非管理员被弹回首页（不暴露后台）", () => {
    expect(adminLayout).toContain('redirect("/")');
  });

  it("使用 header 壳层（本期不引入侧边栏）", () => {
    expect(adminLayout).toContain("AdminHeader");
  });
});

describe("登录页与 v1 的差异必须是有意的", () => {
  it("不再引用 /forgot-password 死链", () => {
    expect(loginView).not.toContain("/forgot-password");
    expect(loginView).toContain("忘记密码");
  });

  it("统计数字来自 props（服务端真实数据），不是硬编码", () => {
    expect(loginView).toContain("stats.books");
    expect(loginView).not.toContain("8,640");
  });

  it("注册表单接真实接口", () => {
    expect(loginView).toContain("register(");
  });
});

describe("注册角色不可提权", () => {
  it("服务层固定使用只读角色常量", () => {
    expect(authService).toContain("AUTH_VIEWER_ROLE");
    expect(authService).not.toContain('"ADMIN"');
  });

  it("注册接口的入参 Schema 不接受 role（否则可自助提权）", () => {
    expect(registerRoute).not.toContain("role: z.");
    expect(registerRoute).toContain("password: z.string()");
  });
});

describe("导入接口独立鉴权", () => {
  it("必须 ADMIN（布局守卫挡不住直接打接口）", () => {
    expect(importRoute).toContain("getAuthContext");
    expect(importRoute).toContain("AUTH_ADMIN_ROLE");
    expect(importRoute).toContain("403");
  });
});
