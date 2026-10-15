"use client";

import { useMemo } from "react";

import { useHydratedTheme } from "@/hooks/use-hydrated-theme";
import { getEdgeColorForCategory } from "@/lib/graph/grouping";
import { buildMatrix, cellCount, matrixCodes } from "@/lib/graph/matrix";
import { getEdgeTypeColorsForTheme } from "@/theme";
import type { GraphEdge, GraphSnapshot } from "@/types/graph";

/**
 * 关系共现矩阵面板。
 *
 * 回答的问题：图谱说「谁和谁有关系」，矩阵说「**多少对人物同时具备这两种关系**」——
 * 例如「父子 × 师徒」有多少对，这是人工复核模型的最高价值切片
 * （同一对人物被拆成多种关系 = 最可能的误判信号）。
 *
 * ## 为什么维度是动态的
 *
 * 快照按连接度裁到前 N 个节点，切片内**实际出现的关系码**与全库不同。
 * 早期方案用全库 `count` 取前 10，会把切片内 0 条的码带进来形成空行空列；
 * 正确做法是按 `codeStats`（已按快照实算并降序）取维度 —— 见设计文档 §5.2。
 *
 * ## 为什么不做 Canvas
 *
 * 矩阵是 DOM 表格：可选中、可复制、可被测试断言（Canvas 在 jsdom 下只会「假绿」）。
 */

export interface RelationMatrixPanelProps {
  snapshot    : GraphSnapshot;
  /** 当前选中的格子；null 表示未选中。 */
  activeCell  : { codeA: string; codeB: string } | null;
  /** 点击格子；`count` 为 0 时不回调（空态不发事件）。 */
  onSelectCell: (cell: { codeA: string; codeB: string }) => void;
}

export function RelationMatrixPanel({
  snapshot,
  activeCell,
  onSelectCell
}: RelationMatrixPanelProps) {
  const { selectedTheme, isHydrated } = useHydratedTheme();
  const edgeColors = useMemo(
    () => getEdgeTypeColorsForTheme(isHydrated ? (selectedTheme ?? undefined) : undefined),
    [isHydrated, selectedTheme]
  );

  const codes = useMemo(() => matrixCodes(snapshot.codeStats), [snapshot.codeStats]);
  const matrix = useMemo(() => buildMatrix(snapshot.edges, codes), [snapshot.edges, codes]);

  /** 对角与非对角分别求最大值：两者量纲不同，共用一个尺度会让小值全糊成一片。 */
  const scales = useMemo(() => {
    let diagMax = 1;
    let offMax = 1;
    for (let row = 0; row < codes.length; row += 1) {
      for (let col = row; col < codes.length; col += 1) {
        const rowCode = codes[row] ?? "";
        const colCode = codes[col] ?? "";
        const value = cellCount(matrix, rowCode, colCode);
        if (rowCode === colCode) {
          diagMax = Math.max(diagMax, value);
        } else {
          offMax = Math.max(offMax, value);
        }
      }
    }
    return { diagMax, offMax };
  }, [codes, matrix]);

  const labelByCode = useMemo(
    () => new Map(snapshot.codeStats.map((stat) => [stat.code, stat.label])),
    [snapshot.codeStats]
  );
  const categoryByCode = useMemo(
    () => new Map(snapshot.codeStats.map((stat) => [stat.code, stat.category])),
    [snapshot.codeStats]
  );

  if (codes.length === 0) {
    return (
      <div className="rel-matrix" data-empty="true">
        <p className="rel-matrix-empty">当前切片内没有可统计的关系码。</p>
      </div>
    );
  }

  return (
    <div className="rel-matrix">
      <table className="rel-matrix-table">
        <thead>
          <tr>
            <th className="rel-matrix-corner" scope="col">
              <span className="sr-only">关系码</span>
            </th>
            {codes.map((code) => (
              <th key={code} className="rel-matrix-colhead" scope="col">
                <span>{labelByCode.get(code) ?? code}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {codes.map((rowCode, rowIndex) => (
            <tr key={rowCode}>
              <th className="rel-matrix-rowhead" scope="row">
                <span
                  className="rel-matrix-swatch"
                  style={{
                    backgroundColor: getEdgeColorForCategory(
                      edgeColors,
                      categoryByCode.get(rowCode) ?? 4
                    )
                  }}
                  aria-hidden="true"
                />
                {labelByCode.get(rowCode) ?? rowCode}
              </th>
              {codes.map((colCode, colIndex) => {
                // 只渲染上三角（含对角）：矩阵无向，下三角与上三角恒等。
                if (colIndex < rowIndex) {
                  return <td key={colCode} className="rel-matrix-mirror" aria-hidden="true" />;
                }

                const isDiag = rowCode === colCode;
                const value = cellCount(matrix, rowCode, colCode);
                const isActive =
                  activeCell !== null &&
                  ((activeCell.codeA === rowCode && activeCell.codeB === colCode) ||
                    (activeCell.codeA === colCode && activeCell.codeB === rowCode));
                const scaleMax = isDiag ? scales.diagMax : scales.offMax;

                return (
                  <td key={colCode} className="rel-matrix-cellwrap">
                    <button
                      type="button"
                      className="rel-matrix-cell"
                      data-diag={isDiag}
                      data-empty={value === 0}
                      data-active={isActive}
                      disabled={value === 0}
                      style={
                        value === 0
                          ? undefined
                          : {
                              backgroundColor: heatColor(edgeColors, categoryByCode, isDiag, value, scaleMax, rowCode, colCode),
                              color          : textColor(value, scaleMax)
                            }
                      }
                      aria-label={`${labelByCode.get(rowCode) ?? rowCode} 与 ${
                        labelByCode.get(colCode) ?? colCode
                      }：${String(value)} 组人物对`}
                      onClick={() => {
                        onSelectCell({ codeA: rowCode, codeB: colCode });
                      }}
                    >
                      {value === 0 ? "" : value}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rel-matrix-hint">
        对角＝具备该关系的<strong>人物对</strong>数；非对角＝同时具备两种关系的
        <strong>人物对</strong>数。
      </p>
    </div>
  );
}

/**
 * 热度配色：按 `sqrt` 压缩的长尾分布映射到主题色透明度。
 *
 * 为什么用平方根：关系对数分布长尾（顶格可能是个小格的几十倍），
 * 线性映射会让绝大多数格子看起来一样淡。平方根保留了「大小之别」又不至于全黑。
 *
 * 非对角格取**两个码中语义分组靠前者**的颜色 —— 矩阵无向，
 * 用一端固定能让同一格的配色稳定（换顺序不改色）。
 *
 * @returns 可直接用于 `backgroundColor` 的 `color-mix` 表达式
 */
function heatColor(
  palette: readonly string[],
  categoryByCode: ReadonlyMap<string, GraphEdge["category"]>,
  isDiag: boolean,
  value: number,
  max: number,
  rowCode: string,
  colCode: string
): string {
  const ratio = max <= 0 ? 0 : Math.min(1, Math.sqrt(value / max));
  const percent = Math.round(12 + ratio * 76);

  const anchorCategory = isDiag
    ? (categoryByCode.get(rowCode) ?? 4)
    : Math.min(categoryByCode.get(rowCode) ?? 4, categoryByCode.get(colCode) ?? 4);

  const base = palette[anchorCategory] ?? palette[palette.length - 1] ?? "#888888";
  return `color-mix(in oklab, ${base} ${String(percent)}%, transparent)`;
}

/**
 * 单元格文字色：底色深到一定程度时用前景色，否则用默认前景。
 *
 * @returns CSS 颜色（沿用主题令牌，不硬编码黑白以免在深色主题下失读）
 */
function textColor(value: number, max: number): string {
  const ratio = max <= 0 ? 0 : Math.min(1, Math.sqrt(value / max));
  return ratio > 0.55
    ? "var(--color-primary-foreground, #ffffff)"
    : "var(--color-foreground, #333333)";
}
