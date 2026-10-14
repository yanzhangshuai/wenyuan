"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LinkObject, NodeObject } from "react-force-graph-2d";

import { useHydratedTheme } from "@/hooks/use-hydrated-theme";
import { computeNodeRadius, getEdgeColorForCategory } from "@/lib/graph/grouping";
import type { RelationCategory } from "@/lib/relations";
import { getEdgeTypeColorsForTheme, getFactionColorsForTheme } from "@/theme";
import type { GraphEdge, GraphNode } from "@/types/graph";

/**
 * 力导向图谱画布。
 *
 * 设计原因：
 * - `react-force-graph-2d` 依赖 canvas 与 `window`，必须禁用 SSR（`ssr: false`），
 *   否则服务端渲染阶段会因访问浏览器 API 而失败；
 * - 该库会**就地修改**传入的 `graphData`（写入 `x` / `y` / `vx` / `vy`），
 *   因此每次都要构造新对象，不能复用 props 里的数组；
 * - 节点绘制需要读取自定义字段，而库的 `NodeObject` 带 `[others: string]: any`
 *   索引签名 —— 直接访问会得到 `any` 并触发 `no-unsafe-*`。
 *   此处改为「只用 id 查回自己的 Map」，从而完全不触碰索引签名。
 */

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

/** 画布容器的最小高度，避免初次渲染时高度为 0 导致库内部计算异常。 */
const MIN_CANVAS_HEIGHT = 480;

export interface ForceGraphCanvasProps {
  nodes                : readonly GraphNode[];
  edges                : readonly GraphEdge[];
  /** 选中的节点 ID；null 表示未选中。 */
  selectedNodeId       : string | null;
  /** 节点点击回调。 */
  onSelectNode         : (nodeId: string | null) => void;
  /** 受控的高亮关系分组；为空表示不过滤。 */
  highlightedCategories: readonly RelationCategory[];
}

/** 把库的端点值（可能是 id 或已被替换成节点对象）统一解析为字符串 id。 */
function resolveEndpointId(value: string | number | NodeObject | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value !== undefined && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

export function ForceGraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  highlightedCategories
}: ForceGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: MIN_CANVAS_HEIGHT });

  const { selectedTheme, isHydrated } = useHydratedTheme();

  // 主题未 hydration 时用默认主题调色板，保证首帧与服务端一致。
  const edgeColors = useMemo(
    () => getEdgeTypeColorsForTheme(isHydrated ? (selectedTheme ?? undefined) : undefined),
    [isHydrated, selectedTheme]
  );
  const factionColors = useMemo(
    () => getFactionColorsForTheme(isHydrated ? (selectedTheme ?? undefined) : undefined),
    [isHydrated, selectedTheme]
  );

  /** 只用 id 索引，避免在回调里访问库对象的索引签名。 */
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  /** 关系身份键 → 边，用于按两端 id 反查边的语义分组。 */
  const edgeByPair = useMemo(() => {
    const map = new Map<string, GraphEdge>();
    for (const edge of edges) {
      map.set(`${edge.source}\u0000${edge.target}`, edge);
    }
    return map;
  }, [edges]);

  const categoryFilter = useMemo(() => new Set(highlightedCategories), [highlightedCategories]);

  // 容器尺寸跟随布局变化；尺寸未变时返回 prev，避免无意义重渲染。
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) {
        return;
      }
      const { width, height } = entry.contentRect;
      setSize((previous) => {
        const nextWidth = Math.round(width);
        const nextHeight = Math.max(MIN_CANVAS_HEIGHT, Math.round(height));
        if (previous.width === nextWidth && previous.height === nextHeight) {
          return previous;
        }
        return { width: nextWidth, height: nextHeight };
      });
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // 每次重建对象：库会就地写入坐标，复用旧对象会导致位置残留。
  const graphData = useMemo(
    () => ({
      nodes: nodes.map((node) => ({ id: node.id })),
      links: edges.map((edge) => ({
        source: edge.source,
        target: edge.target
      }))
    }),
    [nodes, edges]
  );

  const paintNode = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const id = typeof node.id === "string" ? node.id : null;
      if (id === null) {
        return;
      }
      const data = nodeById.get(id);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      if (data === undefined) {
        return;
      }

      const radius = computeNodeRadius(data.degree);
      const isSelected = id === selectedNodeId;

      // 节点填充：有派系分组时用派系色，否则用「其他」分组色兜底。
      const fill =
        data.factionIndex === null
          ? getEdgeColorForCategory(factionColors, 4)
          : (factionColors[data.factionIndex] ?? getEdgeColorForCategory(factionColors, 4));

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();

      if (isSelected) {
        ctx.lineWidth = 2 / globalScale;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }

      // 缩放过小时不画标签，避免文字糊成一团。
      const labelScale = globalScale >= 0.6 ? 1 : 0;
      if (labelScale === 0) {
        return;
      }

      // 提及越多字号越大，让主线人物在视觉上更突出。
      const fontSize = Math.max(8, Math.min(14, 8 + data.mentionCount / 20));
      ctx.font = `${String(fontSize)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillText(data.name, x, y + radius + 2);
    },
    [factionColors, nodeById, selectedNodeId]
  );

  const paintPointerArea = useCallback(
    (node: NodeObject, color: string, ctx: CanvasRenderingContext2D) => {
      const id = typeof node.id === "string" ? node.id : null;
      const data = id === null ? undefined : nodeById.get(id);
      if (data === undefined) {
        return;
      }
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, computeNodeRadius(data.degree) + 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [nodeById]
  );

  const resolveLinkCategory = useCallback(
    (link: LinkObject): RelationCategory | null => {
      const sourceId = resolveEndpointId(link.source);
      const targetId = resolveEndpointId(link.target);
      if (sourceId === null || targetId === null) {
        return null;
      }
      const edge =
        edgeByPair.get(`${sourceId}\u0000${targetId}`) ??
        edgeByPair.get(`${targetId}\u0000${sourceId}`);
      return edge?.category ?? null;
    },
    [edgeByPair]
  );

  const linkColor = useCallback(
    (link: LinkObject) => {
      const category = resolveLinkCategory(link);
      if (category === null) {
        return "#999999";
      }
      if (categoryFilter.size > 0 && !categoryFilter.has(category)) {
        // 被过滤掉的关系保留极淡的颜色，维持结构感而不抢注意力。
        return "rgba(150,150,150,0.12)";
      }
      return getEdgeColorForCategory(edgeColors, category);
    },
    [categoryFilter, edgeColors, resolveLinkCategory]
  );

  const linkWidth = useCallback(
    (link: LinkObject) => {
      const category = resolveLinkCategory(link);
      if (category !== null && categoryFilter.size > 0 && !categoryFilter.has(category)) {
        return 0.3;
      }
      return 1.2;
    },
    [categoryFilter, resolveLinkCategory]
  );

  const handleNodeClick = useCallback(
    (node: NodeObject) => {
      const id = typeof node.id === "string" ? node.id : null;
      // 再次点击同一节点视为取消选中，提供直观的「点空白/再点一次」交互。
      onSelectNode(id === selectedNodeId ? null : id);
    },
    [onSelectNode, selectedNodeId]
  );

  const handleBackgroundClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  return (
    <div ref={containerRef} className="graph-canvas" data-testid="graph-canvas">
      {size.width > 0 ? (
        <ForceGraph2D
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor="transparent"
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintPointerArea}
          nodeLabel=""
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          cooldownTicks={120}
          warmupTicks={40}
        />
      ) : null}
    </div>
  );
}
