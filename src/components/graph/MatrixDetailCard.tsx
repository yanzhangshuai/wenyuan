"use client";

import { useMemo, useState } from "react";

import { useHydratedTheme } from "@/hooks/use-hydrated-theme";
import {
  buildDiagDetail,
  buildNameLookup,
  buildPairDetail,
  sortDetailEntries
} from "@/lib/graph/matrix";
import { getEdgeTypeColorsForTheme } from "@/theme";
import type { GraphEdge, GraphSnapshot } from "@/types/graph";

/**
 * 矩阵详情卡 —— 修「矩阵看不到对应角色」的关键件。
 *
 * 交互链（对应设计文档 §5.1）：
 * 1. 点矩阵格子 `(codeA, codeB)` → 列出命中的**人物对**；
 * 2. 每张卡展示：人物对名 → 关系 chips → 逐条边（章节名 + 状态 + **多条**原文）；
 * 3. 开卡时同步设置全图高亮（由父组件负责）。
 *
 * ## 非对角 vs 对角
 *
 * - **非对角**：只要**同时具备**两个码的人物对（`buildPairDetail`）；
 * - **对角**：该码涉及的**全部**人物对（`buildDiagDetail`），默认前 20 条 + 展开。
 *
 * ## 为什么默认截断
 *
 * 实测《儒林外史》切片内「朋友」可达数十对，一次全渲染会让抽屉变成无限滚动条；
 * 截断值 `INITIAL_VISIBLE = 20` 是可用性与完整性的折中，且**永远给展开入口**。
 */

/** 首屏展示的详情条数；超出部分折叠。 */
const INITIAL_VISIBLE = 20;

export interface MatrixDetailCardProps {
  snapshot: GraphSnapshot;
  /** 查询的码对；null 时卡片不渲染。 */
  cell    : { codeA: string; codeB: string } | null;
  /** 关闭卡片（同时清空高亮）。 */
  onClose : () => void;
}

export function MatrixDetailCard({ snapshot, cell, onClose }: MatrixDetailCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { selectedTheme, isHydrated } = useHydratedTheme();
  const edgeColors = useMemo(
    () => getEdgeTypeColorsForTheme(isHydrated ? (selectedTheme ?? undefined) : undefined),
    [isHydrated, selectedTheme]
  );

  const names = useMemo(() => buildNameLookup(snapshot.nodes), [snapshot.nodes]);
  const labelByCode = useMemo(
    () => new Map(snapshot.codeStats.map((stat) => [stat.code, stat.label])),
    [snapshot.codeStats]
  );
  const chapterTitleByOrdinal = useMemo(
    () => new Map(snapshot.chapters.map((chapter) => [chapter.ordinal, chapter.title])),
    [snapshot.chapters]
  );

  const entries = useMemo(() => {
    if (cell === null) {
      return [];
    }
    const raw =
      cell.codeA === cell.codeB
        ? buildDiagDetail(snapshot.edges, cell.codeA)
        : buildPairDetail(snapshot.edges, cell.codeA, cell.codeB);
    return sortDetailEntries(raw, names);
  }, [cell, snapshot.edges, names]);

  if (cell === null) {
    return null;
  }

  const isDiag = cell.codeA === cell.codeB;
  const visible = expanded ? entries : entries.slice(0, INITIAL_VISIBLE);
  const hiddenCount = entries.length - visible.length;

  /** 把回号翻译成「第 N 回 标题」；缺章节时退回回号。 */
  const chapterLabel = (ordinal: number): string => {
    const title = chapterTitleByOrdinal.get(ordinal);
    return title === undefined || title === "" ? `第 ${String(ordinal)} 回` : `第 ${String(ordinal)} 回 ${title}`;
  };

  return (
    <aside className="matrix-detail" aria-label="矩阵详情">
      <header className="matrix-detail-header">
        <div>
          <h3 className="matrix-detail-title">
            {labelByCode.get(cell.codeA) ?? cell.codeA}
            {isDiag ? "" : " × "}
            {isDiag ? "" : (labelByCode.get(cell.codeB) ?? cell.codeB)}
          </h3>
          <p className="matrix-detail-meta">
            {isDiag
              ? `共 ${String(entries.length)} 组人物对具备该关系`
              : `共 ${String(entries.length)} 组人物对同时具备这两种关系`}
          </p>
        </div>
        <button
          type="button"
          className="matrix-detail-close"
          aria-label="关闭矩阵详情"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {entries.length === 0 ? (
        <p className="matrix-detail-hint">该组合下没有命中的人物对。</p>
      ) : (
        <>
          <ul className="matrix-detail-pairs">
            {visible.map((entry) => (
              <li key={`${entry.low}-${entry.high}`} className="matrix-detail-pair">
                <p className="matrix-detail-pairname">
                  {names.get(entry.low) ?? "未知"} — {names.get(entry.high) ?? "未知"}
                </p>

                {/* 关系 chips：让「这一对其实有几种关系」一眼可见 —— 多码即高复核价值。 */}
                <ul className="matrix-detail-chips">
                  {collectCodes(entry.edges).map((code) => (
                    <li key={code} className="matrix-detail-chip" data-code={code}>
                      <span
                        className="matrix-detail-chip-dot"
                        style={{
                          backgroundColor:
                            edgeColors[categoryOfCode(snapshot, code)] ?? "#888888"
                        }}
                        aria-hidden="true"
                      />
                      {labelByCode.get(code) ?? code}
                    </li>
                  ))}
                </ul>

                <ul className="matrix-detail-edges">
                  {entry.edges.map((edge) => (
                    <li key={edge.id} className="matrix-detail-edge">
                      <p className="matrix-detail-edgemeta">
                        <span className="matrix-detail-edgetype">{edge.label}</span>
                        <span className="matrix-detail-edgestatus">
                          {edge.status === "ENDED" ? "已终止" : "持续"}
                        </span>
                        <span className="matrix-detail-edgechapter">
                          {chapterLabel(edge.startChapter)}
                        </span>
                      </p>
                      {edge.evidenceQuotes.length === 0 ? (
                        <p className="matrix-detail-noquote">
                          无原文片段（证据计数 {edge.evidenceCount}）
                        </p>
                      ) : (
                        <ul className="matrix-detail-quotes">
                          {edge.evidenceQuotes.map((quote, index) => (
                            <li key={`${edge.id}-${String(index)}`}>
                              <blockquote className="matrix-detail-quote">{quote}</blockquote>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          {hiddenCount > 0 ? (
            <button
              type="button"
              className="matrix-detail-more"
              onClick={() => {
                setExpanded(true);
              }}
            >
              展开其余 {hiddenCount} 组
            </button>
          ) : null}
        </>
      )}
    </aside>
  );
}

/** 取一组边涉及的关系码（去重，保持出现顺序）。 */
function collectCodes(edges: readonly GraphEdge[]): string[] {
  const seen: string[] = [];
  for (const edge of edges) {
    if (!seen.includes(edge.typeCode)) {
      seen.push(edge.typeCode);
    }
  }
  return seen;
}

/** 取关系码的语义分组（用于 chip 配色）。 */
function categoryOfCode(snapshot: GraphSnapshot, code: string): GraphEdge["category"] {
  return snapshot.codeStats.find((stat) => stat.code === code)?.category ?? 4;
}
