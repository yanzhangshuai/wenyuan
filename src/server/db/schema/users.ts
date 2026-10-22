import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { appRoleEnum } from "./enums";

/**
 * 用户域表：`users`（第 14 张）。
 *
 * 设计取舍：
 * - **邮箱为登录凭证**，`username` 只是展示标识（与 v1 一致），二者各自唯一；
 * - 密码只存 **scrypt 自描述哈希串**（`scrypt$N$r$p$salt$hash`），永不存明文，也不存盐的独立列；
 * - `role` 用数据库枚举而非文本，避免「拼写错误的角色」被静默写入；
 * - `is_active` 是停用开关：令牌仍在有效期内时，布局层会再查一次，做到**立即失效**。
 */
export const users = pgTable(
  "users",
  {
    id          : uuid("id").primaryKey().defaultRandom(),
    email       : text("email").notNull(),
    username    : text("username").notNull(),
    name        : text("name").notNull().default("管理员"),
    /** scrypt 自描述哈希串；格式见 `@/server/modules/auth/password`。 */
    passwordHash: text("password_hash").notNull(),
    role        : appRoleEnum("role").notNull().default("VIEWER"),
    isActive    : boolean("is_active").notNull().default(true),
    lastLoginAt : timestamp("last_login_at", { withTimezone: true }),
    createdAt   : timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt   : timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    uniqueIndex("users_username_uq").on(t.username),
    // 后台「只看启用账号」与停用校验都会走这条索引。
    index("users_is_active_idx").on(t.isActive)
  ]
);
