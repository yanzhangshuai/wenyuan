"use client";

import { useCallback, useMemo, useState } from "react";

import { ForceGraphCanvas } from "@/components/graph/ForceGraphCanvas";
import { GraphDetailPanel } from "@/components/graph/GraphDetailPanel";
import { useHydratedTheme } from "@/hooks/use-hydrated-theme";
import { RELATION_GROUPS, getEdgeColorForCategory } from "@/lib/graph/grouping";
import type { RelationCategory } from "@/lib/relations";
import { getEdgeTypeColorsForTheme } from "@/theme";
import type { GraphSnapshot } from "@/types/graph";

/**
 * 图谱视图容器（页面级交互编排）。
 *
 * 职责边界：只管理「选中哪个实体」「显示哪些关系分组」两个交互态，
 * 渲染细节下推给画布与详情面板 —— 避免单文件承担全部职责。
 *
 * 为什么是 Client Component：需要处理点击、切换分组等高频道本地状态；
 * 首屏数据仍由服务端注入（`snapshot`），客户端不做任何取数。
 */

export interface GraphViewProps {
  snapshot: GraphSnapshot;
}

export function GraphView({ snapshot }: GraphViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  /** 空集表示「全部显示」，避免用「全选」表达默认态导致的初始状态歧义。 */
  const [activeCategories, setActiveCategories] = useState<ReadonlySet<RelationCategory>>(
    new Set<RelationCategory>()
  );

  const { selectedTheme, isHydrated } = useHydratedTheme();
  const edgeColors = useMemo(
    () => getEdgeTypeColorsForTheme(isHydrated ? (selectedTheme ?? undefined) : undefined),
    [isHydrated, selectedTheme]
  );

  const nodeById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node])),
    [snapshot.nodes]
  );

  const selectedNode = selectedNodeId === null ? null : (nodeById.get(selectedNodeId) ?? null);

  /** 选中实体的关联关系（两个方向都算），按关系分组排序便于阅读。 */
  const selectedRelations = useMemo(() => {
    if (selectedNodeId === null) {
      return [];
    }
    return snapshot.edges
      .filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
      .sort((left, right) => left.category - right.category);
  }, [selectedNodeId, snapshot.edges]);

  /** 关联关系对应的对端实体名，供详情面板展示。 */
  const counterpartNames = useMemo(() => {
    if (selectedNodeId === null) {
      return new Map<string, string>();
    }
    const names = new Map<string, string>();
    for (const edge of selectedRelations) {
      const counterpartId = edge.source === selectedNodeId ? edge.target : edge.source;
      const counterpart = nodeById.get(counterpartId);
      if (counterpart !== undefined) {
        names.set(edge.id, counterpart.name);
      }
    }
    return names;
  }, [nodeById, selectedNodeId, selectedRelations]);

  const toggleCategory = useCallback((category: RelationCategory) => {
    setActiveCategories((previous) => {
      const next = new Set(previous);
      // 从「空集=全部」切换到「部分选择」时，需要显式补上其余分组，
      // 否则用户点击第一个分组会意外隐藏其他所有关系。
      if (next.size === 0) {
        for (const group of RELATION_GROUPS) {
          if (group.category !== category) {
            next.add(group.category);
          }
        }
        return next;
      }
      if (next.has(category)) {
        next.delete(category);
        // 全部取消等价于「不过滤」，回到空集语义，避免出现空白画布。
        return next.size === 0 ? new Set<RelationCategory>() : next;
      }
      next.add(category);
      return next.size === RELATION_GROUPS.length ? new Set<RelationCategory>() : next;
    });
  }, []);

  const isCategoryActive = useCallback(
    (category: RelationCategory) => activeCategories.size === 0 || activeCategories.has(category),
    [activeCategories]
  );

  const highlighted = useMemo(
    () => [...activeCategories],
    [activeCategories]
  );

  return (
    <div className="graph-view">
      <div className="graph-view-toolbar">
        <div className="graph-view-stats">
          <span className="graph-view-stat">
            <strong>{snapshot.nodes.length}</strong> 个实体
          </span>
          <span className="graph-view-stat">
            <strong>{snapshot.edges.length}</strong> 条关系
          </span>
          <span className="graph-view-stat">
            共 <strong>{snapshot.chapterCount}</strong> 章
          </span>
        </div>

        <ul className="graph-legend" aria-label="关系分组图例">
          {snapshot.legend.map((entry) => {
            const active = isCategoryActive(entry.category);
            return (
              <li key={entry.category}>
                <button
                  type="button"
                  className="graph-legend-item"
                  data-active={active}
                  aria-pressed={active}
                  onClick={() => {
                    toggleCategory(entry.category);
                  }}
                >
                  <span
                    className="graph-legend-swatch"
                    style={{
                      backgroundColor: getEdgeColorForCategory(edgeColors, entry.category)
                    }}
                    aria-hidden="true"
                  />
                  {entry.label}
                  <span className="graph-legend-count">{entry.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {snapshot.truncatedNodeCount > 0 ? (
        <p className="graph-view-notice">
          实体较多，已按连接度展示前 {snapshot.nodes.length} 个，另有{" "}
          {snapshot.truncatedNodeCount} 个低频实体未显示。
        </p>
      ) : null}

      <div className="graph-view-body">
        <ForceGraphCanvas
          nodes={snapshot.nodes}
          edges={snapshot.edges}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          highlightedCategories={highlighted}
        />
        <GraphDetailPanel
          node={selectedNode}
          relations={selectedRelations}
          counterpartNames={counterpartNames}
          onSelectNode={setSelectedNodeId}
          onClose={() => {
            setSelectedNodeId(null);
          }}
        />
      </div>
    </div>
  );
}
