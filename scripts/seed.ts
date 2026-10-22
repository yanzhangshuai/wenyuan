import { seedAdminAccount } from "@/server/modules/auth/seed";
import { describeDatabaseUrl, resolveSeedPlan } from "@/server/modules/seed/plan";
import { checkSchemaReadiness, seedRelationTypes } from "@/server/modules/seed/relation-types";

/**
 * 统一的种子数据命令（生产可用）。
 *
 * 用法：
 *   pnpm db:seed                    # 同步关系类型字典；若配置了管理员环境变量则一并建号
 *   pnpm db:seed --dry-run          # 只检查配置与表结构，不写入
 *   pnpm db:seed --skip-admin       # 只同步字典（管理员另行创建）
 *
 * 管理员配置（二选一，建议写进部署环境变量而不是命令行，避免进 shell history）：
 *   ADMIN_EMAIL / ADMIN_PASSWORD [/ ADMIN_NAME / ADMIN_USERNAME]
 *
 * 幂等性：两项都是 upsert，可重复执行；不会删除任何既有数据。
 *
 * 退出码：
 *   0  成功（或按配置跳过管理员）
 *   2  配置错误 / 表结构未就绪（**不做任何写入**）
 *   1  执行期异常
 */

async function main(): Promise<void> {
  const plan = resolveSeedPlan(process.argv.slice(2), process.env);

  console.log(`[seed] 目标数据库：${describeDatabaseUrl(process.env.DATABASE_URL)}`);

  if (plan.errors.length > 0) {
    for (const message of plan.errors) console.error(`[seed] 配置错误：${message}`);
    console.error("[seed] 未执行任何写入。");
    process.exitCode = 2;
    return;
  }

  // 前置检查：忘了跑 migrate 是最常见的失败原因，提前给出可操作提示。
  const readiness = await checkSchemaReadiness();
  const missing: string[] = [];
  if (!readiness.relationTypes) missing.push("relation_types");
  if (!readiness.users) missing.push("users");
  if (missing.length > 0) {
    console.error(`[seed] 表结构未就绪（缺少 ${missing.join("、")}）`);
    console.error("[seed] 请先执行：pnpm db:migrate");
    process.exitCode = 2;
    return;
  }

  if (plan.dryRun) {
    console.log("[seed] dry-run：表结构就绪，配置校验通过");
    console.log("[seed] 将同步关系类型字典：是");
    console.log(
      plan.admin === null
        ? `[seed] 将创建/更新管理员：否（${plan.adminSkipReason ?? "未配置"}）`
        : `[seed] 将创建/更新管理员：${plan.admin.email}`
    );
    return;
  }

  const relationResult = await seedRelationTypes();
  console.log(`[seed] relation_types 已同步 ${String(relationResult.count)} 条`);

  if (plan.admin === null) {
    console.log(`[seed] 管理员：已跳过（${plan.adminSkipReason ?? "未配置"}）`);
    if (plan.adminSkipReason?.includes("未设置") === true) {
      console.log("[seed] 需要建号时：设置 ADMIN_EMAIL + ADMIN_PASSWORD 后重跑，或执行 pnpm seed:admin");
    }
  } else {
    const outcome = await seedAdminAccount(plan.admin);
    console.log(
      `[seed] 管理员 ${outcome.email} 已${outcome.action === "created" ? "创建" : "更新（密码已重置）"}`
    );
  }

  console.log("[seed] 完成");
}

try {
  await main();
} catch (error) {
  console.error(`[seed] 执行失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
