"use client";

import { useHydratedTheme } from "@/hooks/use-hydrated-theme";
import { ENTITY_TYPE_LABELS } from "@/lib/entities";
import { getRelationGroupLabel } from "@/lib/graph/grouping";
import { getEdgeTypeColorsForTheme } from "@/theme";
import type { GraphEdge, GraphNode } from "@/types/graph";

/**
 * 选中实体的详情面板。
 *
 * 设计原因：图谱只能表达「谁和谁有关系」，无法回答「凭什么」。
 * 面板把关系码、生效章节区间与原文证据引用一并列出，
 * 使每条边都可追溯到具体段落 —— 这是 v1 缺失的能力（v1 只画边不给依据）。
 */

export interface GraphDetailPanelProps {
  /** 选中的实体；null 时展示引导文案。 */
  node            : GraphNode | null;
  /** 与该实体相关的全部关系。 */
  relations       : readonly GraphEdge[];
  /** 关系 ID → 对端实体名。 */
  counterpartNames: ReadonlyMap<string, string>;
  /** 点击对端实体时切换选中。 */
  onSelectNode    : (nodeId: string) => void;
  /** 关闭面板。 */
  onClose         : () => void;
  /**
   * 人物档案页链接（可选）。
   *
   * 传入时在头部渲染「查看人物档案」入口 —— 图谱回答「和谁有关系」，
   * 档案回答「做过什么」，两者是不同的阅读需求，故需要显式跳转。
   */
  profileHref?    : string;
}

/** 把章节区间渲染成可读文案。 */
function formatChapterRange(edge: GraphEdge): string {
  if (edge.status === "ENDED" && edge.endChapter !== null) {
    return `第 ${String(edge.startChapter)}–${String(edge.endChapter)} 章`;
  }
  if (edge.endChapter !== null) {
    return `第 ${String(edge.startChapter)} 章起，末次见于第 ${String(edge.endChapter)} 章`;
  }
  return `第 ${String(edge.startChapter)} 章起`;
}

export function GraphDetailPanel({
  node,
  relations,
  counterpartNames,
  onSelectNode,
  onClose,
  profileHref
}: GraphDetailPanelProps) {
  const { selectedTheme, isHydrated } = useHydratedTheme();
  const edgeColors = getEdgeTypeColorsForTheme(
    isHydrated ? (selectedTheme ?? undefined) : undefined
  );

  if (node === null) {
    return (
      <aside className="graph-detail-panel" data-empty="true" aria-label="实体详情">
        <p className="graph-detail-hint">点击任一节点查看该实体的关系与原文依据。</p>
      </aside>
    );
  }

  return (
    <aside className="graph-detail-panel" aria-label="实体详情">
      <header className="graph-detail-header">
        <div>
          <h2 className="graph-detail-name">{node.name}</h2>
          <p className="graph-detail-meta">
            {ENTITY_TYPE_LABELS[node.type]} · 关联 {relations.length} 人 · 出现 {node.mentionCount} 段
          </p>
        </div>
        <button type="button" className="graph-detail-close" aria-label="关闭详情" onClick={onClose}>
          ×
        </button>
      </header>

      {profileHref === undefined ? null : (
        <a className="graph-detail-profile-link" href={profileHref}>
          查看人物档案 →
        </a>
      )}

      {relations.length === 0 ? (
        <p className="graph-detail-hint">该实体暂无已解析出的关系。</p>
      ) : (
        <ul className="graph-detail-relations">
          {relations.map((edge) => (
            <li key={edge.id} className="graph-detail-relation">
              <div className="graph-detail-relation-head">
                <span
                  className="graph-detail-swatch"
                  style={{ backgroundColor: edgeColors[edge.category] ?? "#888888" }}
                  aria-hidden="true"
                />
                <span className="graph-detail-type">{getRelationGroupLabel(edge.category)}</span>
                <span className="graph-detail-code">{edge.typeCode}</span>
              </div>

              <button
                type="button"
                className="graph-detail-counterpart"
                onClick={() => {
                  const counterpartId =
                    edge.source === node.id ? edge.target : edge.source;
                  onSelectNode(counterpartId);
                }}
              >
                {counterpartNames.get(edge.id) ?? "未知"}
              </button>

              <p className="graph-detail-range">{formatChapterRange(edge)}</p>

              {edge.evidenceQuotes.length === 0 ? null : (
                <ul className="graph-detail-quotes">
                  {edge.evidenceQuotes.map((quote, index) => (
                    <li key={`${edge.id}-${String(index)}`}>
                      <blockquote className="graph-detail-quote">{quote}</blockquote>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
