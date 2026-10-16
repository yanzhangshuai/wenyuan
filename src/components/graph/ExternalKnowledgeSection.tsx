import { KNOWLEDGE_FIELD_LABELS, KNOWLEDGE_RESOLUTION_LABELS } from "@/types/graph";
import type { ExternalKnowledgeItem } from "@/types/graph";

/**
 * 「外部资料」展示分区（**展示型组件，无 "use client"**）。
 *
 * 两个消费方共用同一份实现：
 * 1. 图谱页的实体详情卡（`GraphDetailPanel`，客户端组件）；
 * 2. **人物档案页**（服务端组件）—— 简介最该出现的地方。
 *
 * 铁律「UI 分区」：标题固定为「外部资料 · 全书视角」，并用虚线上边框与
 * 「本书信息」（图谱自身产出）显式隔开 —— 用户必须一眼看出哪条来自哪里。
 *
 * 为什么必须共用：两处各写一份渲染，就会出现「一处改了另一处没改」的漂移，
 * 而这类漂移**只有真浏览器/真页面才能发现**（本项目已栽过一次：CSS 被覆盖、
 * DOM 在但屏幕无）。共用组件把这种漂移变成编译期就能看见的问题。
 */

export interface ExternalKnowledgeSectionProps {
  items         : readonly ExternalKnowledgeItem[];
  /** 无资料时是否也渲染（默认不渲染，避免空分区占位）。 */
  showWhenEmpty?: boolean;
}

export function ExternalKnowledgeSection({
  items,
  showWhenEmpty = false
}: ExternalKnowledgeSectionProps) {
  if (items.length === 0 && !showWhenEmpty) return null;

  return (
    <section className="graph-detail-external" aria-label="外部资料">
      <h3 className="graph-detail-external-title">外部资料 · 全书视角</h3>
      {items.length === 0 ? (
        <p className="graph-detail-hint">
          暂无外部资料。运行 <code>pnpm knowledge:agent</code> 可为本作品补充（需配置检索源）。
        </p>
      ) : (
        <ul className="graph-detail-external-list">
          {items.map((item) => (
            <li key={`${item.subjectKey}-${item.field}`} className="graph-detail-external-item">
              <div className="graph-detail-external-head">
                <span className="graph-detail-external-field">
                  {KNOWLEDGE_FIELD_LABELS[item.field] ?? item.field}
                </span>
                <span className="graph-detail-external-badge">
                  {KNOWLEDGE_RESOLUTION_LABELS[item.resolution] ?? item.resolution} · {item.confidence}
                </span>
              </div>
              {item.value === null ? null : (
                <p className="graph-detail-external-value">{item.value}</p>
              )}
              {item.sourceUrls.length === 0 ? null : (
                <ul className="graph-detail-external-sources">
                  {item.sourceUrls.map((url) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
