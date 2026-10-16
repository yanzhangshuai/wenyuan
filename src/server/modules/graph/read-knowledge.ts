import "server-only";

import { connection } from "next/server";
import { cache } from "react";

import { loadExternalKnowledge } from "@/server/modules/knowledge/repository";
import type { ExternalKnowledgeBySubject } from "@/types/graph";

/**
 * 外部知识的读侧装配（设计文档 §5.3「读时叠加」）。
 *
 * 铁律：**与 GraphSnapshot 并列下发，永不合并进 snapshot**；UI 必须**分区展示**
 * （「本书信息」vs「外部资料 · 全书视角」），让用户一眼看出哪条来自哪里。
 */

export const loadExternalKnowledgeForBook = cache(
  async (bookId: string): Promise<ExternalKnowledgeBySubject> => {
    await connection();
    const rows = await loadExternalKnowledge(bookId);
    const bySubject: ExternalKnowledgeBySubject = {};
    for (const row of rows) {
      const list = bySubject[row.subjectKey] ?? [];
      list.push({
        subjectKey: row.subjectKey,
        field     : row.field,
        value     : row.value,
        resolution: row.resolution,
        confidence: row.confidence,
        sourceUrls: row.sourceUrls,
        fetchedAt : row.fetchedAt.toISOString()
      });
      bySubject[row.subjectKey] = list;
    }
    return bySubject;
  }
);
