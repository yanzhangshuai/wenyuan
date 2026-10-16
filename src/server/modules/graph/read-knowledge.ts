import "server-only";

import { connection } from "next/server";
import { cache } from "react";

import { eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { entities, entityAliases } from "@/server/db/schema";
import { loadExternalKnowledge } from "@/server/modules/knowledge/repository";
import type { ExternalKnowledgeBySubject, ExternalKnowledgeItem } from "@/types/graph";

/**
 * 外部知识的读侧装配（设计文档 §5.3「读时叠加」）。
 *
 * 铁律：**与 GraphSnapshot 并列下发，永不合并进 snapshot**；UI 必须**分区展示**
 * （「本书信息」vs「外部资料 · 全书视角」），让用户一眼看出哪条来自哪里。
 *
 * ## 为什么按「成员名集合」索引，而不是只按规范名（批 91 实测修正）
 *
 * 判定层的 `subjectKey` 是**规范名**，而规范名**会随重解析变化**
 * （实测：红楼重跑后 `王熙凤` 的规范名变成 `熙凤` → 那条简介变成孤儿、UI 里消失）。
 * 修法：把每条知识索引到该实体**全部成员名**（规范名 ∪ 别名）之下 ——
 * 只要旧名字还作为别名存在，重解析就不会让资料失联。
 */

export const loadExternalKnowledgeForBook = cache(
  async (bookId: string): Promise<ExternalKnowledgeBySubject> => {
    await connection();

    const [rows, entityRows, aliasRows] = await Promise.all([
      loadExternalKnowledge(bookId),
      getDatabase()
        .select({ id: entities.id, canonical: entities.canonical })
        .from(entities)
        .where(eq(entities.bookId, bookId)),
      getDatabase()
        .select({ entityId: entityAliases.entityId, alias: entityAliases.alias })
        .from(entityAliases)
        .where(eq(entityAliases.bookId, bookId))
    ]);

    // 实体 → 全部成员名（规范名 ∪ 别名）；再反向建「成员名 → 实体 id」。
    const memberNames = new Map<string, Set<string>>();
    for (const row of entityRows) {
      const set = memberNames.get(row.id) ?? new Set<string>();
      set.add(row.canonical);
      memberNames.set(row.id, set);
    }
    for (const row of aliasRows) {
      const set = memberNames.get(row.entityId) ?? new Set<string>();
      set.add(row.alias);
      memberNames.set(row.entityId, set);
    }
    const entityByMemberName = new Map<string, string>();
    for (const [entityId, names] of memberNames) {
      for (const name of names) {
        if (!entityByMemberName.has(name)) entityByMemberName.set(name, entityId);
      }
    }

    const bySubject: ExternalKnowledgeBySubject = {};
    for (const row of rows) {
      const item: ExternalKnowledgeItem = {
        subjectKey: row.subjectKey,
        field     : row.field,
        value     : row.value,
        resolution: row.resolution,
        confidence: row.confidence,
        sourceUrls: row.sourceUrls,
        fetchedAt : row.fetchedAt.toISOString()
      };
      // 索引到该实体的**全部成员名**之下（含旧规范名若已降为别名）。
      const entityId = entityByMemberName.get(row.subjectKey);
      const keys =
        entityId === undefined
          ? [row.subjectKey]
          : [...(memberNames.get(entityId) ?? new Set([row.subjectKey]))];
      for (const key of keys) {
        const list = bySubject[key] ?? [];
        list.push(item);
        bySubject[key] = list;
      }
    }
    return bySubject;
  }
);
