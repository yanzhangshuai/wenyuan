/**
 * Drizzle schema 统一出口。
 *
 * 约束：本文件只做再导出，不放置运行时逻辑；
 * `drizzle.config.ts` 与 `client.ts` 均以本文件为 schema 入口。
 */
export * from "./analysis";
export * from "./entities";
export * from "./enums";
export * from "./knowledge";
export * from "./relations";
export * from "./books";
