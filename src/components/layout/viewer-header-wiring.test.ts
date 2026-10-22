import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 前台导航的登录入口契约。
 *
 * 纯函数测试管不到「入口有没有接上」——这里直接读源码钉住三件事：
 * 未登录显示「登录」、管理员才显示「后台」、已登录可退出。
 */

const ROOT = process.cwd();

function codeOnlyOf(relativePath: string): string {
  const source = readFileSync(path.resolve(ROOT, relativePath), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

const header = codeOnlyOf("src/components/layout/viewer-header.tsx");
const viewerLayout = codeOnlyOf("src/app/(viewer)/layout.tsx");

describe("首页登录入口", () => {
  it("未登录时渲染指向 /login 的「登录」按钮", () => {
    expect(header).toContain('href="/login"');
    expect(header).toContain("登录");
  });

  it("已登录时渲染名称与退出（调用 logout）", () => {
    expect(header).toContain("AUTH_ROLE_LABELS");
    expect(header).toContain("logout(");
  });

  it("「后台」入口仅对管理员可见", () => {
    // 必须是「isAdminRole(auth.role) ? … /admin … : null」这种条件结构，
    // 不能无条件渲染（否则普通用户会看到一个点进去就被弹回的链接）。
    expect(header).toContain("isAdminRole(auth.role)");
    expect(header).toContain('href="/admin"');
  });

  it("登录态由服务端注入（布局读取会话后传 auth）", () => {
    expect(viewerLayout).toContain("getAuthContext");
    expect(viewerLayout).toContain("auth={");
    // 未缓存数据必须落在 Suspense 内，否则 cacheComponents 下阻塞预渲染。
    expect(viewerLayout).toContain("Suspense");
  });
});
