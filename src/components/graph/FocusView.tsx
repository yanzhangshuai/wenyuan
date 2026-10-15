"use client";

import { useMemo } from "react";

import { useHydratedTheme } from "@/hooks/use-hydrated-theme";
import { getSubDegree } from "@/lib/graph/focus";
import { getEdgeColorForCategory, getRelationGroupLabel } from "@/lib/graph/grouping";
import { getEdgeTypeColorsForTheme } from "@/theme";
import type { GraphChapter, GraphEdge, GraphNode } from "@/types/graph";

/**
 * 聚焦视图 —— 三视图中的「以某人为中心」视角。
 *
 * 与全图的关系：全图回答「整体长什么样」，聚焦回答「这个人周围有谁」。
 * 两者共享同一个选中态（在全图点节点，切到聚焦就是那个人的邻居图）。
 *
 * ## 为什么用列表而非画布
 *
 * 全图已经有画布；聚焦视图的价值在于**可读**——按关系分组列出邻居，
 * 每条关系带章节区间与证据条数。Canvas 在这件事上不如列表。
 * 这也是 demo 方案 B 的结论。
 *
 * ## 空态
 *
 * 未选中任何人 / 选中的人在本切片无关系 —— 两种情况分别给不同文案，
 * 避免「看起来坏了」。后者用 `subDegree`（子图度数）判定，
 * **不能用 `degree`**（那是全库口径，会让 0 度节点看起来有关系）。
 */

export interface FocusViewProps {
  nodes         : readonly GraphNode[];
  edges         : readonly GraphEdge[];
  chapters      : readonly GraphChapter[];
  selectedNodeId: string | null;
  /** 点击邻居时切换选中。 */
  onSelectNode  : (nodeId: string) => void;
}

export function FocusView({
  nodes,
  edges,
  chapters,
  selectedNodeId,
  onSelectNode
}: FocusViewProps) {
  const { selectedTheme, isHydrated } = useHydratedTheme();
  const edgeColors = useMemo(
    () => getEdgeTypeColorsForTheme(isHydrated ? (selectedTheme ?? undefined) : undefined),
    [isHydrated, selectedTheme]
  );

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const selectedNode = selectedNodeId === null ? null : (nodeById.get(selectedNodeId) ?? null);

  /** 选中实体的全部关联边（两个方向）。 */
  const relations = useMemo(() => {
    if (selectedNodeId === null) {
      return [];
    }
    return edges.filter(
      (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId
    );
  }, [edges, selectedNodeId]);

  const chapterTitleByOrdinal = useMemo(
    () => new Map(chapters.map((chapter) => [chapter.ordinal, chapter.title])),
    [chapters]
  );

  if (selectedNode === null) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-6 overflow-y-auto bg-card/40 p-8 text-center">
        <div className="max-w-xl">
          <h2 className="mb-3 font-serif text-2xl font-semibold tracking-tight">以某人视角看关系</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            在「全图」中点选一个人物，或从下方选择一位主要人物，即可查看他的人际圈。
          </p>
        </div>
        <NodePicker nodes={nodes} onSelectNode={onSelectNode} />
      </div>
    );
  }

  const subDegree = getSubDegree(selectedNode, edges);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-card/40">
      <header className="flex flex-shrink-0 items-baseline gap-3 border-b border-border px-6 py-4">
        <h2 className="font-serif text-xl font-semibold tracking-tight">{selectedNode.name}</h2>
        <p className="text-sm text-muted-foreground">
          本切片内 {subDegree} 条关系 · 全库 {selectedNode.degree} 条 · 出现{" "}
          {selectedNode.mentionCount} 段
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {relations.length === 0 ? (
          <p className="text-sm text-muted-foreground">该人物在本切片中无关系记录。</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {relations.map((edge) => {
              const counterpartId = edge.source === selectedNode.id ? edge.target : edge.source;
              const counterpart = nodeById.get(counterpartId);
              return (
                <li
                  key={edge.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card/70 p-3 transition-colors hover:border-ring"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span
                      className="size-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: getEdgeColorForCategory(edgeColors, edge.category) }}
                      aria-hidden="true"
                    />
                    <span>{getRelationGroupLabel(edge.category)}</span>
                    <span className="text-foreground">{edge.label}</span>
                    <span className="ml-auto truncate">{formatRange(edge, chapterTitleByOrdinal)}</span>
                  </div>

                  <button
                    type="button"
                    className="flex items-center gap-2 text-left font-serif text-base font-medium transition-colors hover:text-primary"
                    onClick={() => {
                      onSelectNode(counterpartId);
                    }}
                  >
                    {counterpart?.name ?? "未知"}
                    {counterpart !== undefined ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground tabular-nums">
                        {getSubDegree(counterpart, edges)} 条
                      </span>
                    ) : null}
                  </button>

                  <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    证据 {edge.evidenceCount} 条
                    {edge.evidenceQuotes[0] === undefined
                      ? ""
                      : ` · 「${truncate(edge.evidenceQuotes[0])}」`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 未选中时的快速选择器：按子图度数降序，取前若干个最活跃的人物。 */
function NodePicker({
  nodes,
  onSelectNode
}: {
  nodes       : readonly GraphNode[];
  onSelectNode: (nodeId: string) => void;
}) {
  const top = useMemo(
    () =>
      [...nodes]
        .sort((left, right) => {
          if (right.subDegree !== left.subDegree) {
            return right.subDegree - left.subDegree;
          }
          return left.id.localeCompare(right.id);
        })
        .slice(0, 12),
    [nodes]
  );

  if (top.length === 0) {
    return null;
  }

  return (
    <div className="w-full max-w-4xl">
      <p className="mb-3 text-xs tracking-widest text-muted-foreground uppercase">主要人物</p>
      <ul className="flex flex-wrap justify-center gap-2">
        {top.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 text-sm transition-colors hover:border-ring hover:text-primary"
              onClick={() => {
                onSelectNode(node.id);
              }}
            >
              {node.name}
              <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                {node.subDegree}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 章节区间文案。
 *
 * ⚠️ 坑：章节标题本身**已含回号**（如「第三十一回 天长县同访豪杰」），
 * 因此不能再拼「第 31 回」前缀，否则会出现
 * 「第 31 回 第三十一回 天长县同访豪杰」这种重复。
 * 有标题时直接用标题；无标题时才回退到「第 N 回」。
 */
function formatRange(
  edge: GraphEdge,
  titles: ReadonlyMap<number, string>
): string {
  const startTitle = titles.get(edge.startChapter);
  const startLabel =
    startTitle === undefined || startTitle === ""
      ? `第 ${String(edge.startChapter)} 回`
      : startTitle;
  if (edge.endChapter === null || edge.endChapter === edge.startChapter) {
    return startLabel;
  }
  const endTitle = titles.get(edge.endChapter);
  const endLabel =
    endTitle === undefined || endTitle === "" ? `第 ${String(edge.endChapter)} 回` : endTitle;
  return `${startLabel} – ${endLabel}`;
}

/** 截断长引用（纯展示）。 */
function truncate(text: string, max = 40): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
