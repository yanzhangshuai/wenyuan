import "server-only";

import { eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { bookPacks, type BookPackStatus, type BookPackSource } from "@/server/db/schema";

import { resolveWorkPack, type WorkPackResolution } from "./registry";
import type { WorkPack } from "./types";

/**
 * 读取一本书实际使用的作品包（库 → 内置 → 空词典 的回落链）。
 *
 * ## 为什么单独一层，而不是改 `resolveWorkPack`
 *
 * `resolveWorkPack` 是**纯函数**：给定标题必然得到同一个包，这是它可单测、
 * 也是「同一本书两次解析用同一份知识」的前提。把它改成查库会让纯度消失，
 * 而 `registry.test.ts` 里那些「前缀匹配优先级」的用例就全部失去意义。
 *
 * 所以拆成两层：
 * - `resolveWorkPack(title)`：内置包匹配（纯，不变）；
 * - `loadWorkPack(bookId, title)`：**先查库**，查不到才回落纯函数。
 *
 * ## 回落顺序的理由
 *
 * | 层 | 用它的理由 | 风险 |
 * | --- | --- | --- |
 * | 库（人工/AI 生成） | 每本书自己的知识，新书唯一可行的路径 | 未经审核的 `draft` 可能错并 |
 * | 内置包 | 被金标验证过的基线（儒林 1-1 实体 89.74） | 只有两本书有 |
 * | 空词典 | 绝不「用错书的知识」——错误可见 | 分词质量降到基线 75.7% |
 *
 * 中间层**保留不动**：删掉内置包就等于让那些金标数字不可复现。
 */

/** 作品包来源（比 `WorkPackResolution` 多一个「从哪来」）。 */
export type WorkPackOrigin = "db" | "builtin" | "unregistered";

/** 读取结果。 */
export interface LoadedWorkPack extends WorkPackResolution {
  /** 这份包从哪来。 */
  origin        : WorkPackOrigin;
  /** 库里的来源标记；`builtin`/`unregistered` 时为 `null`。 */
  source        : BookPackSource | null;
  /** 库里的状态；`draft` 表示未经人确认。 */
  status        : BookPackStatus | null;
  /** 库里的专名条数（便于页面显示「128 个名字」）。 */
  properNounCount: number;
  /** 库里的别名组数。 */
  aliasGroupCount: number;
}

/**
 * 读取一本书实际生效的作品包。
 *
 * @param bookId 作品 id
 * @param bookTitle 作品标题（库里没有配置时用它匹配内置包）
 * @returns 包与其来源
 */
export async function loadWorkPack(bookId: string, bookTitle: string): Promise<LoadedWorkPack> {
  const db = getDatabase();
  const [row] = await db.select().from(bookPacks).where(eq(bookPacks.bookId, bookId)).limit(1);

  if (row !== undefined) {
    // 库里的配置**不合并**内置包：合并会让「这条规则从哪来」无法回答，
    // 而「声明即断言」要求每一组别名都能被指认。要复用内置知识就走页面上的
    // 「从内置包导入」——那是一次显式的、可见的复制。
    const pack: WorkPack = {
      id                 : `db:${row.id}`,
      label              : `${bookTitle}（自定义）`,
      properNouns        : row.properNouns.map((item) => [item.name, item.postag] as const),
      properNounFrequency: 100_000,
      aliasGroups        : row.aliasGroups
    };
    return {
      pack,
      matched         : true,
      matchedAlias    : null,
      origin          : "db",
      source          : row.source,
      status          : row.status,
      properNounCount : row.properNouns.length,
      aliasGroupCount : row.aliasGroups.length
    };
  }

  const builtin = resolveWorkPack(bookTitle);
  return {
    ...builtin,
    origin          : builtin.matched ? "builtin" : "unregistered",
    source          : null,
    status          : null,
    properNounCount : builtin.pack.properNouns.length,
    aliasGroupCount : builtin.pack.aliasGroups?.length ?? 0
  };
}
