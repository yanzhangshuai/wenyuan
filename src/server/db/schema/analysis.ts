import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { books } from "./books";
import { analysisRunStatusEnum, analysisStageEnum } from "./enums";

/**
 * 解析审计域表：`analysis_runs` / `analysis_calls` / `analysis_issues`。
 *
 * 设计来源：继承 v2 的「运行快照」机制 —— 冻结当次使用的模型与提示词版本，
 * 使任意一次解析结果都可复现与归因。首版**不引入** v2 的批次编排表。
 */

/** 模型快照：冻结当次解析使用的模型配置。 */
export interface ModelSnapshot {
  provider    : string;
  /** 粗筛（P0 词典分类 / P1 提取）使用的模型。 */
  extractModel: string;
  /** 精修与仲裁（P3 二审）使用的模型。 */
  reviewModel : string;
  temperature : number;
  /**
   * 思考模式。冻结它是为了成本归因：关闭思考可省约 64% 成本，
   * 事后看「这次为何贵」必须能知道当时开没开。
   * 历史运行没有该字段，故可选。
   */
  thinking?   : "enabled" | "disabled";
}

/** 提示词 / 领域知识快照条目。 */
export interface SkillSnapshotEntry {
  slug       : string;
  contentHash: string;
}

/** 解析运行（一次「导入 → 图谱」的完整执行）。 */
export const analysisRuns = pgTable("analysis_runs", {
  id    : uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  status       : analysisRunStatusEnum("status").notNull().default("running"),
  /** 冻结的模型配置。 */
  modelSnapshot: jsonb("model_snapshot").$type<ModelSnapshot>().notNull(),
  /** 提示词版本号，与代码内 prompt 常量同步递增。 */
  promptVersion: text("prompt_version").notNull(),
  /** 冻结的领域知识 / skill 清单。 */
  skillSnapshot: jsonb("skill_snapshot").$type<SkillSnapshotEntry[]>(),
  startedAt    : timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt   : timestamp("finished_at", { withTimezone: true })
});

/** 单次模型调用审计（成本与错误归因的唯一来源）。 */
export const analysisCalls = pgTable(
  "analysis_calls",
  {
    id   : uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    stage    : analysisStageEnum("stage").notNull(),
    model    : text("model").notNull(),
    tokensIn : integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    /**
     * 调用成本（美元）。使用 `numeric` 而非浮点，避免累加误差；
     * Drizzle 将其映射为 string，汇总时需显式转数。
     */
    costUsd  : numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    latencyMs: integer("latency_ms").notNull().default(0),
    /** 失败类别（`output_not_json` / `truncated` / `rate_limit` / `schema_invalid` 等）。 */
    errorKind: text("error_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("analysis_calls_run_stage_idx").on(t.runId, t.stage)]
);

/** 片级问题留档（截断、schema 校验失败、归并冲突等）。 */
export const analysisIssues = pgTable(
  "analysis_issues",
  {
    id   : uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    /** 问题所在章节序号；与章节无关的问题（如全局归并）为 null。 */
    chapterOrdinal: integer("chapter_ordinal"),
    code          : text("code").notNull(),
    payload       : jsonb("payload"),
    createdAt     : timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("analysis_issues_run_code_idx").on(t.runId, t.code)]
);
