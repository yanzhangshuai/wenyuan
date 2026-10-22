import { describe, expect, it } from "vitest";

import { describeDatabaseUrl, resolveSeedPlan } from "./plan";

/**
 * 种子计划测试。
 *
 * 这些分支决定了「生产环境跑一条命令」是否安全：
 * 半个配置、弱密码、显式跳过，都必须有确定的行为。
 */

const VALID_ENV = {
  ADMIN_EMAIL   : "Admin@WenYuan.Local",
  ADMIN_PASSWORD: "Wenyuan@2026",
  ADMIN_NAME    : "管理员",
  ADMIN_USERNAME: "admin"
};

describe("resolveSeedPlan", () => {
  it("未提供管理员配置 → 只同步字典，不报错", () => {
    const plan = resolveSeedPlan([], {});
    expect(plan.admin).toBeNull();
    expect(plan.errors).toHaveLength(0);
    expect(plan.relationTypes).toBe(true);
    expect(plan.adminSkipReason).toContain("未设置");
  });

  it("配置完整 → 生成管理员计划，邮箱归一化为小写", () => {
    const plan = resolveSeedPlan([], VALID_ENV);
    expect(plan.errors).toHaveLength(0);
    expect(plan.admin).toEqual({
      email   : "admin@wenyuan.local",
      password: "Wenyuan@2026",
      name    : "管理员",
      username: "admin"
    });
  });

  it("只给邮箱或只给密码 → 报错（半个配置比没有更危险）", () => {
    expect(resolveSeedPlan([], { ADMIN_EMAIL: "a@b.co" }).errors[0]).toContain("必须同时提供");
    expect(resolveSeedPlan([], { ADMIN_PASSWORD: "Wenyuan@2026" }).errors[0]).toContain("必须同时提供");
  });

  it("密码过短 / 邮箱非法 → 报错", () => {
    const shortPassword = resolveSeedPlan([], { ADMIN_EMAIL: "a@b.co", ADMIN_PASSWORD: "1234" });
    expect(shortPassword.errors.join()).toContain("至少 8 位");

    const badEmail = resolveSeedPlan([], { ADMIN_EMAIL: "not-an-email", ADMIN_PASSWORD: "Wenyuan@2026" });
    expect(badEmail.errors.join()).toContain("格式不正确");
  });

  it("有配置错误时不产出管理员计划（保证不写入）", () => {
    const plan = resolveSeedPlan([], { ADMIN_EMAIL: "a@b.co", ADMIN_PASSWORD: "1234" });
    expect(plan.admin).toBeNull();
    expect(plan.errors.length).toBeGreaterThan(0);
  });

  it("--skip-admin 优先于环境变量", () => {
    const plan = resolveSeedPlan(["--skip-admin"], VALID_ENV);
    expect(plan.admin).toBeNull();
    expect(plan.adminSkipReason).toContain("--skip-admin");
    expect(plan.errors).toHaveLength(0);
  });

  it("--dry-run 只影响执行方式，不影响计划内容", () => {
    const plan = resolveSeedPlan(["--dry-run"], VALID_ENV);
    expect(plan.dryRun).toBe(true);
    expect(plan.admin?.email).toBe("admin@wenyuan.local");
  });

  it("默认名称与用户名", () => {
    const plan = resolveSeedPlan([], { ADMIN_EMAIL: "a@b.co", ADMIN_PASSWORD: "Wenyuan@2026" });
    expect(plan.admin?.name).toBe("管理员");
    expect(plan.admin?.username).toBe("admin");
  });
});

describe("describeDatabaseUrl（日志脱敏）", () => {
  it("只保留主机、端口与库名，不含账号密码", () => {
    const text = describeDatabaseUrl("postgres://user:secret@db.internal:5432/wenyuan_v3");
    expect(text).toBe("db.internal:5432/wenyuan_v3");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("user");
  });

  it("缺省端口补 5432", () => {
    expect(describeDatabaseUrl("postgres://u:p@localhost/wenyuan_v3")).toBe("localhost:5432/wenyuan_v3");
  });

  it("未设置或非法时给出可读占位", () => {
    expect(describeDatabaseUrl(undefined)).toContain("未设置");
    expect(describeDatabaseUrl("")).toContain("未设置");
    expect(describeDatabaseUrl("not a url")).toBe("(无法解析)");
  });
});
