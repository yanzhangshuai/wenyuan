"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LinkObject, NodeObject } from "react-force-graph-2d";

import { useHydratedTheme } from "@/hooks/use-hydrated-theme";
import { computeNodeRadius, getEdgeColorForCategory } from "@/lib/graph/grouping";
import {
  computeDominantCategoryByNode,
  resolveNodeColorIndex
} from "@/lib/graph/node-fill";
import {
  NODE_GLOW_PULSE_PERIOD_MS,
  NODE_LABEL_GAP,
  medianOf,
  nodeLabelColor,
  paintSphereNode,
  resolveNodeLabelFontSize,
  resolveNodeRadius
} from "@/lib/graph/node-paint";
import type { RelationCategory } from "@/lib/relations";
import { getEdgeTypeColorsForTheme, getNodeColorsForTheme } from "@/theme";
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
  /**
   * 是否在 hover 时显示关系标签。
   *
   * 信息分层策略（对齐用户要求「某些默认隐藏」）：
   * - 默认 `true`：**常态不显示**任何边标签，仅当鼠标悬停到某条边上时浮现该边的关系名，
   *   避免几百条边同时标注文字把画布糊成一片；
   * - 传 `false` 可完全关闭标签（例如在只读缩略图场景）。
   */
  showEdgeLabels?      : boolean;
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
  highlightedCategories,
  showEdgeLabels = true
}: ForceGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: MIN_CANVAS_HEIGHT });
  /** 悬停中的边端点对（`source\u0000target`）；null 表示无悬停。 */
  const [hoveredPair, setHoveredPair] = useState<string | null>(null);
  /** 悬停中的节点 ID；用于 hover 放大（对齐 v1 `NODE_HOVER_SCALE`）。 */
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  /**
   * 光晕呼吸相位（0~1 往复）。
   *
   * v1 用 CSS `@keyframes verified-pulse` 让选中节点发光呼吸；canvas 没有等价滤镜，
   * 因此这里用一个**仅在选中态运行**的 rAF 循环驱动相位，把同样的观感搬到画布上。
   * 未选中时循环自动停止，不产生后台 CPU 占用。
   */
  const [pulsePhase, setPulsePhase] = useState(0);

  const { selectedTheme, isHydrated } = useHydratedTheme();

  // 主题未 hydration 时用默认主题调色板，保证首帧与服务端一致。
  const edgeColors = useMemo(
    () => getEdgeTypeColorsForTheme(isHydrated ? (selectedTheme ?? undefined) : undefined),
    [isHydrated, selectedTheme]
  );
  const nodeColors = useMemo(
    () => getNodeColorsForTheme(isHydrated ? (selectedTheme ?? undefined) : undefined),
    [isHydrated, selectedTheme]
  );

  /**
   * 实体 id → 主导关系分组色盘下标。
   *
   * 🔑 这是节点**填充色**的来源（取代了恒为 `null` 的 `factionIndex`）：
   * 走「该节点参与最多的关系分组」这一条**真实可算**的维度，
   * 因此家族中心读暖红、上下级读松绿，与左下角图例语义同源。
   * 无任何关系的实体不在 Map 里 → 回退到末位（「无关系」中性色）。
   */
  const dominantCategory = useMemo(() => computeDominantCategoryByNode(edges), [edges]);

  /**
   * 主题前景/背景色（供 canvas 使用）。
   *
   * canvas 里读不到 CSS 变量，必须从计算样式取实际值。
   * 依赖 `selectedTheme` 触发重算 —— 主题切换后节点名/描边颜色要跟着变，
   * 否则会残留上一个主题的配色。
   */
  const [themeColors, setThemeColors] = useState({ foreground: "#e8e4dc", background: "#141210" });
  /**
   * 画布用的字族名。
   *
   * canvas `font` 不认 CSS 变量，必须给出**已解析的字族字符串**。
   * 先从容器计算样式取 `font-family`（继承自 `body` 的思源宋体），
   * 取不到时退回通用 `serif`。
   */
  const [labelFontFamily, setLabelFontFamily] = useState("serif");
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) {
      return;
    }
    const styles = window.getComputedStyle(element);
    const foreground = styles.getPropertyValue("--color-foreground").trim();
    const background = styles.getPropertyValue("--color-background").trim();
    const family = styles.fontFamily.trim();
    setThemeColors({
      foreground: nodeLabelColor(foreground),
      // 背景色用于球面暗部混色；取不到时用一个中性深色兜底。
      background: background === "" ? "#141210" : background
    });
    setLabelFontFamily(family === "" ? "serif" : family);
  }, [selectedTheme, isHydrated]);

  /**
   * 提及数中位数：节点名分档（12px / 10px）的分界。
   * 对齐 v1「影响力高于中位线的节点字号更大」的规则。
   */
  const mentionMedian = useMemo(
    () => medianOf(nodes.map((node) => node.mentionCount)),
    [nodes]
  );

  /**
   * 选中节点的光晕呼吸。
   *
   * 只在「有选中节点」时启动 rAF 循环；取消选中即停止（相位不再更新，
   * 但未选中时 `paintSphereNode` 根本不画光晕，因此残留相位无副作用）——
   * 这样就不需要「在 effect 里同步 setState 做复位」，避免级联渲染。
   */
  useEffect(() => {
    if (selectedNodeId === null) {
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      // 用余弦把 0→1→0 做成平滑往复，而不是线性锯齿。
      const progress = ((now - start) % NODE_GLOW_PULSE_PERIOD_MS) / NODE_GLOW_PULSE_PERIOD_MS;
      setPulsePhase((1 - Math.cos(progress * Math.PI * 2)) / 2);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [selectedNodeId]);

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

      const isSelected = id === selectedNodeId;
      const isHovered = id === hoveredNodeId;
      // 半径按交互态放大（对齐 v1：hover 1.1×，选中 1.2×）。
      const radius = resolveNodeRadius(computeNodeRadius(data.degree), { isSelected, isHovered });

      // 节点填充：按「主导关系分组」取色（见 `lib/graph/node-fill.ts`）。
      // ⚠️ 不再使用 `data.factionIndex` —— 该字段在落库时恒为 null（未做派系识别），
      //    此前所有人落进同一个兜底色，导致「所有节点同色」。
      const fill = getEdgeColorForCategory(nodeColors, resolveNodeColorIndex(dominantCategory, id));

      // 立体球状节点：光晕 + 径向渐变 + 描边 + 高光点。
      paintSphereNode(ctx, {
        x,
        y,
        radius,
        fill,
        foreground: themeColors.foreground,
        background: themeColors.background,
        isSelected: isSelected || isHovered,
        glowPhase : pulsePhase
      });

      // 名字恒显（对齐 v1）：字号按提及数分档，颜色用主题前景色。
      //
      // ⚠️ 这里刻意**不**做「缩放太小时跳过标签」的优化：
      // v1 的每个节点都恒定渲染 `<text>`；早期 v3 用 `globalScale >= 0.6` 做门禁，
      // 但库默认的 `zoomToFit` 会把整图缩到 ~0.6 倍以下（实测 0.5975），
      // 导致**所有**节点名被静默跳过 —— 用户看到的「没有名称」正是此因。
      //
      // 字号按 `globalScale` 反比放大，使标签在**屏幕上**恒为 12px / 10px，
      // 与 v1 单层 SVG 中「名字始终清晰可读」的观感一致；缩得很小时
      // 文字也不会跟着糊掉（这是「恒显」的关键）。
      const scale = Math.max(globalScale, 0.2);
      const fontSize = resolveNodeLabelFontSize(data.mentionCount, mentionMedian) / scale;
      // ⚠️ canvas 的 `font` **不解析 CSS 变量**：写 `var(--font-serif)` 会让整条
      // font 字符串非法，浏览器直接忽略 → 名字完全不渲染。
      // 因此这里注入的是从计算样式解析出的**字族名**（见下方 labelFontFamily）。
      ctx.font = `${String(fontSize)}px ${labelFontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // 先描一圈背景色描边再填字，保证名字压在任何节点/边上都可读。
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = themeColors.background;
      ctx.strokeText(data.name, x, y + radius + NODE_LABEL_GAP / scale);
      ctx.fillStyle = themeColors.foreground;
      ctx.fillText(data.name, x, y + radius + NODE_LABEL_GAP / scale);
    },
    [
      dominantCategory,
      hoveredNodeId,
      labelFontFamily,
      mentionMedian,
      nodeById,
      nodeColors,
      pulsePhase,
      selectedNodeId,
      themeColors
    ]
  );

  const paintPointerArea = useCallback(
    (node: NodeObject, color: string, ctx: CanvasRenderingContext2D) => {
      const id = typeof node.id === "string" ? node.id : null;
      const data = id === null ? undefined : nodeById.get(id);
      if (data === undefined || id === null) {
        return;
      }
      // 命中区跟随放大后的半径，否则 hover 到边缘会「闪断」。
      const radius = resolveNodeRadius(computeNodeRadius(data.degree), {
        isSelected: id === selectedNodeId,
        isHovered : id === hoveredNodeId
      });
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radius + 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [hoveredNodeId, nodeById, selectedNodeId]
  );

  const handleNodeHover = useCallback((node: NodeObject | null) => {
    const id = node === null ? null : (typeof node.id === "string" ? node.id : null);
    setHoveredNodeId(id);
    // 悬停时把光标变成手型，提示节点可点击。
    if (containerRef.current !== null) {
      containerRef.current.style.cursor = id === null ? "grab" : "pointer";
    }
  }, []);

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
      // 悬停中的边在过滤态下也要显出来 —— 否则用户移上去看不到自己指的那条。
      const sourceId = resolveEndpointId(link.source);
      const targetId = resolveEndpointId(link.target);
      const isHovered =
        hoveredPair !== null &&
        sourceId !== null &&
        targetId !== null &&
        (hoveredPair === `${sourceId}\u0000${targetId}` ||
          hoveredPair === `${targetId}\u0000${sourceId}`);

      if (!isHovered && categoryFilter.size > 0 && !categoryFilter.has(category)) {
        // 被过滤掉的关系保留极淡的颜色，维持结构感而不抢注意力。
        return "rgba(150,150,150,0.12)";
      }
      return getEdgeColorForCategory(edgeColors, category);
    },
    [categoryFilter, edgeColors, hoveredPair, resolveLinkCategory]
  );

  const linkWidth = useCallback(
    (link: LinkObject) => {
      const sourceId = resolveEndpointId(link.source);
      const targetId = resolveEndpointId(link.target);
      const isHovered =
        hoveredPair !== null &&
        sourceId !== null &&
        targetId !== null &&
        (hoveredPair === `${sourceId}\u0000${targetId}` ||
          hoveredPair === `${targetId}\u0000${sourceId}`);

      if (isHovered) {
        return 2.4;
      }
      const category = resolveLinkCategory(link);
      if (category !== null && categoryFilter.size > 0 && !categoryFilter.has(category)) {
        return 0.3;
      }
      return 1.2;
    },
    [categoryFilter, hoveredPair, resolveLinkCategory]
  );

  const handleLinkHover = useCallback((link: LinkObject | null) => {
    if (link === null) {
      setHoveredPair(null);
      return;
    }
    const sourceId = resolveEndpointId(link.source);
    const targetId = resolveEndpointId(link.target);
    setHoveredPair(sourceId === null || targetId === null ? null : `${sourceId}\u0000${targetId}`);
  }, []);

  /**
   * 边标签（信息分层：默认隐藏，仅 hover 浮现）。
   *
   * 库的 `linkLabel` 是「每条边各自求一个字符串」的回调，无法表达「只显示悬停那条」。
   * 因此这里返回空串（库对空串不绘制）来抑制常态标签，再由 `linkCanvasObject`
   * 单独把悬停边的关系名画上去。
   */
  const linkLabel = useCallback(() => "", []);

  /** 悬停边的关系名：在边的中点绘制一枚带底色的小标签。 */
  const paintHoveredLink = useCallback(
    (link: LinkObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (!showEdgeLabels) {
        return;
      }
      const sourceId = resolveEndpointId(link.source);
      const targetId = resolveEndpointId(link.target);
      if (sourceId === null || targetId === null) {
        return;
      }
      const isHovered =
        hoveredPair === `${sourceId}\u0000${targetId}` ||
        hoveredPair === `${targetId}\u0000${sourceId}`;
      if (!isHovered) {
        return;
      }

      const edge =
        edgeByPair.get(`${sourceId}\u0000${targetId}`) ??
        edgeByPair.get(`${targetId}\u0000${sourceId}`);
      if (edge === undefined) {
        return;
      }

      // 端点坐标：库会把 source/target 替换成节点对象并写入 x/y。
      const sourceNode = typeof link.source === "object" ? link.source : null;
      const targetNode = typeof link.target === "object" ? link.target : null;
      const sx = sourceNode?.x ?? 0;
      const sy = sourceNode?.y ?? 0;
      const tx = targetNode?.x ?? 0;
      const ty = targetNode?.y ?? 0;
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;

      const fontSize = 11 / globalScale;
      ctx.font = `${String(fontSize)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const text = edge.typeCode;
      const padding = 4 / globalScale;
      const textWidth = ctx.measureText(text).width;

      // 先铺底再写字，保证在任何节点/边颜色上都可读。
      ctx.fillStyle = "rgba(20,20,20,0.82)";
      ctx.beginPath();
      ctx.roundRect(
        mx - textWidth / 2 - padding,
        my - fontSize / 2 - padding / 2,
        textWidth + padding * 2,
        fontSize + padding,
        padding / 2
      );
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, mx, my);
    },
    [edgeByPair, hoveredPair, showEdgeLabels]
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
          linkLabel={linkLabel}
          linkCanvasObjectMode={() => "after"}
          linkCanvasObject={paintHoveredLink}
          onLinkHover={handleLinkHover}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onBackgroundClick={handleBackgroundClick}
          cooldownTicks={120}
          warmupTicks={40}
        />
      ) : null}
    </div>
  );
}
