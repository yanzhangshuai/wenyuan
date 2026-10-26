import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDatabase } from "@/server/db/client";
import {
  books,
  packFeedback,
  users,
  type FeedbackKind,
  type FeedbackPayload,
  type FeedbackStatus
} from "@/server/db/schema";

/**
 * 读者反馈的服务端逻辑（L3）。
 *
 * ## 为什么每条反馈都要绑定一个「可执行的修改动作」
 *
 * 反馈的唯一价值是**变成配置修改**。所以只收四类，每一类都对应一个具体的编辑动作：
 * 拆别名组 / 加专名 / 改词性 / 加别名。
 *
 * 不收「这条关系抽错了」—— 关系由 P1 逐片抽取 + 投票，改一条要重跑整片，
 * 不是配置层面能修的东西。收了只会给管理员一个点不动的按钮。
 */

/** 载荷校验（与 `FeedbackPayload` 一一对应）。 */
const PayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind : z.literal("wrong_merge"),
    names: z.array(z.string().trim().min(1).max(32)).min(2).max(10)
  }),
  z.object({
    kind       : z.literal("missing_entity"),
    name       : z.string().trim().min(1).max(32),
    chapterHint: z.string().trim().max(64).optional()
  }),
  z.object({
    kind        : z.literal("wrong_type"),
    name        : z.string().trim().min(1).max(32),
    expectedType: z.enum(["PERSON", "LOCATION", "ORGANIZATION", "CONCEPT"])
  }),
  z.object({
    kind : z.literal("missing_alias"),
    name : z.string().trim().min(1).max(32),
    alias: z.string().trim().min(1).max(32)
  })
]);

/** 提交结果。 */
export type SubmitResult =
  | { ok: true; id: string }
  | { ok: false; reason: "invalid_input" | "book_not_found" | "duplicate" };

/**
 * 提交一条反馈。
 *
 * 去重口径：**同一用户 + 同一作品 + 同一 kind + 同一载荷**只保留一条 pending。
 * 目的是防止连点按钮刷出一堆重复条目 —— 聚合的价值在「不同人提同一件事」，
 * 同一个人重复提没有信息量。
 *
 * @param userId 提交人（来自会话，不可由客户端指定）
 */
export async function submitFeedback(
  userId: string,
  bookId: string,
  payload: unknown
): Promise<SubmitResult> {
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const data = parsed.data as FeedbackPayload;

  const db = getDatabase();
  const [book] = await db.select({ id: books.id }).from(books).where(eq(books.id, bookId)).limit(1);
  if (book === undefined) return { ok: false, reason: "book_not_found" };

  const existing = await db
    .select({ id: packFeedback.id, payload: packFeedback.payload })
    .from(packFeedback)
    .where(
      and(
        eq(packFeedback.bookId, bookId),
        eq(packFeedback.submittedBy, userId),
        eq(packFeedback.kind, data.kind),
        eq(packFeedback.status, "pending")
      )
    );
  const duplicate = existing.some(
    (row) => JSON.stringify(row.payload) === JSON.stringify(data)
  );
  if (duplicate) return { ok: false, reason: "duplicate" };

  const [inserted] = await db
    .insert(packFeedback)
    .values({
      bookId     : bookId,
      kind       : data.kind,
      payload    : data,
      submittedBy: userId
    })
    .returning({ id: packFeedback.id });

  return { ok: true, id: inserted?.id ?? "" };
}

/** 队列行（管理员页用）。 */
export interface FeedbackRow {
  id           : string;
  bookId       : string;
  bookTitle    : string;
  kind         : FeedbackKind;
  payload      : FeedbackPayload;
  status       : FeedbackStatus;
  note         : string | null;
  submittedName: string;
  createdAt    : string;
  resolvedAt   : string | null;
}

/**
 * 读取反馈队列。
 *
 * @param status 只看某个状态；省略则看全部
 * @param bookId 只看某本书
 */
export async function listFeedback(filter: {
  status?: FeedbackStatus;
  bookId?: string;
}): Promise<FeedbackRow[]> {
  const db = getDatabase();
  const conditions = [
    ...(filter.status === undefined ? [] : [eq(packFeedback.status, filter.status)]),
    ...(filter.bookId === undefined ? [] : [eq(packFeedback.bookId, filter.bookId)])
  ];

  const rows = await db
    .select({
      id         : packFeedback.id,
      bookId     : packFeedback.bookId,
      bookTitle  : books.title,
      kind       : packFeedback.kind,
      payload    : packFeedback.payload,
      status     : packFeedback.status,
      note       : packFeedback.note,
      submittedBy: packFeedback.submittedBy,
      createdAt  : packFeedback.createdAt,
      resolvedAt : packFeedback.resolvedAt
    })
    .from(packFeedback)
    .innerJoin(books, eq(books.id, packFeedback.bookId))
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(packFeedback.createdAt));

  // 提交人姓名单独查：join users 会让「用户被删」的反馈整条消失，
  // 而反馈本身应该保留（`submitted_by` 是 cascade，理论上不会出现孤儿，但别依赖它）。
  const submitterIds = [...new Set(rows.map((row) => row.submittedBy))];
  const submitters =
    submitterIds.length === 0
      ? []
      : await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, submitterIds));
  const nameById = new Map(submitters.map((row) => [row.id, row.name]));

  return rows.map((row) => ({
    id           : row.id,
    bookId       : row.bookId,
    bookTitle    : row.bookTitle,
    kind         : row.kind,
    payload      : row.payload,
    status       : row.status,
    note         : row.note,
    submittedName: nameById.get(row.submittedBy) ?? "（已删除的用户）",
    createdAt    : row.createdAt.toISOString(),
    resolvedAt   : row.resolvedAt === null ? null : row.resolvedAt.toISOString()
  }));
}

/** 处理结果。 */
export type ResolveResult = { ok: true } | { ok: false; reason: "not_found" };

/**
 * 处理一条反馈（接受 / 拒绝）。
 *
 * 只改状态与说明，**不自动改配置** —— 配置修改仍然走页面上的显式保存，
 * 这样「谁改了什么」始终有明确的操作记录，而不是被一条反馈悄悄触发。
 */
export async function resolveFeedback(
  adminId: string,
  feedbackId: string,
  status: Exclude<FeedbackStatus, "pending">,
  note: string
): Promise<ResolveResult> {
  const db = getDatabase();
  const [existing] = await db
    .select({ id: packFeedback.id })
    .from(packFeedback)
    .where(eq(packFeedback.id, feedbackId))
    .limit(1);
  if (existing === undefined) return { ok: false, reason: "not_found" };

  await db
    .update(packFeedback)
    .set({
      status    : status,
      note      : note.length === 0 ? null : note,
      resolvedBy: adminId,
      resolvedAt: new Date()
    })
    .where(eq(packFeedback.id, feedbackId));

  return { ok: true };
}
