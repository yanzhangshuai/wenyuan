"use client";

import { ArrowLeft, Users, Waypoints } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ChapterTimeline } from "@/components/graph/ChapterTimeline";
import { FocusView } from "@/components/graph/FocusView";
import { ForceGraphCanvas } from "@/components/graph/ForceGraphCanvas";
import { GraphDetailPanel } from "@/components/graph/GraphDetailPanel";
import { GraphToolbar } from "@/components/graph/GraphToolbar";
import { MatrixDetailCard } from "@/components/graph/MatrixDetailCard";
import { RelationMatrixPanel } from "@/components/graph/RelationMatrixPanel";
import { UncertaintyPanel } from "@/components/graph/UncertaintyPanel";
import { ThemeToggle } from "@/components/theme";
import { useHydratedTheme } from "@/hooks/use-hydrated-theme";
import { sliceByChapter } from "@/lib/graph/chapter-slice";
import { RELATION_GROUPS, getEdgeColorForCategory } from "@/lib/graph/grouping";
import { UNCERTAINTY_KIND_LABELS } from "@/lib/graph/uncertainty";
import type { RelationCategory } from "@/lib/relations";
import { getEdgeTypeColorsForTheme } from "@/theme";
import type { ExternalKnowledgeBySubject, GraphSnapshot, UncertaintyReport } from "@/types/graph";

/**
 * 图谱视图容器（页面级交互编排）—— 三视图合一。
 *
 * ## 版式（对齐 v1 `wen-yuan`）
 *
 * v1 的图谱页是**画布铺满视口 + 控件浮层**，而不是「工具栏在上、画布在下方一块」的
 * 流式布局。本组件按该版式重构：
 *
 * - 顶部：图谱信息头（书名 / 作者 / 规模 / 返回书库），不占画布高度之外的额外空间；
 * - 主体：`relative flex-1` 画布区，图谱**填满剩余视口**；
 * - 浮层：统计条、视图切换、图例、详情面板都绝对定位浮在画布上，不挤压画布。
 *
 * ## 信息分层（对应用户要求）
 *
 * - **边标签默认隐藏**：由 `ForceGraphCanvas` 的 `showEdgeLabels` 控制，仅 hover 该边时浮现；
 * - **节点详情默认收起**：未选中节点时详情面板**完全不渲染**（不是占位留白），
 *   选中后从右侧滑出，关闭即移除。
 *
 * ## 为什么是「同一页面内切换」而不是三个路由
 *
 * 三个视图共享**同一份快照**与**同一个选中态**：全图点节点 → 聚焦跟着跳；
 * 点矩阵格子 → 全图边高亮。拆成路由就要重复取数、跨路由传 state。
 */

/** 视图模式。 */
export type GraphViewMode = "full" | "focus" | "matrix";

/** 视图切换的展示元数据。 */
const VIEW_MODES: readonly { mode: GraphViewMode; label: string }[] = [
  { mode: "full", label: "全图" },
  { mode: "focus", label: "聚焦" },
  { mode: "matrix", label: "矩阵" }
];

export interface GraphViewProps {
  /** 当前作品 ID，用于面包屑与档案页跳转。 */
  bookId            : string;
  snapshot          : GraphSnapshot;
  /**
   * 不确定性报告（全库口径，读时派生）。**与 snapshot 并列**，不参与切片/渲染逻辑；
   * 一期只在信息头暴露计数，逐实体标注属二期（设计文档 §六：一二期捆绑交付）。
   */
  uncertainty?      : UncertaintyReport | null;
  /**
   * 外部知识（三期判定层，独立表读时叠加）。**与 snapshot 并列**，UI **分区展示**
   * （「本书信息」vs「外部资料 · 全书视角」），让用户一眼看出哪条来自哪里。
   */
  externalKnowledge?: ExternalKnowledgeBySubject | null;
}

export function GraphView({ bookId, snapshot, uncertainty, externalKnowledge }: GraphViewProps) {
  const [mode, setMode] = useState<GraphViewMode>("full");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [matrixCell, setMatrixCell] = useState<{ codeA: string; codeB: string } | null>(null);
  /** 不确定性面板（二期）：默认关闭，信息头按钮开关。 */
  const [showUncertainty, setShowUncertainty] = useState(false);
  /**
   * 当前章回（「截至第 N 回」）。初值 = 全书，即默认看到完整图谱。
   *
   * 为什么放在客户端切片：边自带 `startChapter`/`endChapter`，
   * 无需请求后端就能算出任意回的快照（见 `lib/graph/chapter-slice.ts`）。
   */
  const [currentChapter, setCurrentChapter] = useState(snapshot.chapterCount);
  /** 空集表示「全部显示」，避免用「全选」表达默认态导致的初始状态歧义。 */
  const [activeCategories, setActiveCategories] = useState<ReadonlySet<RelationCategory>>(
    new Set<RelationCategory>()
  );

  /**
   * 按章回裁剪后的快照。
   *
   * ⚠️ `currentChapter >= chapterCount` 时等价于全图；节点 `subDegree` 会按
   * **切片内**的边重算（不能沿用全库口径，否则 0 度节点看起来有关系）。
   */
  const sliced = useMemo(
    () => sliceByChapter(snapshot.nodes, snapshot.edges, currentChapter),
    [snapshot.nodes, snapshot.edges, currentChapter]
  );

  /**
   * 图例条目按**当前切片**重算。
   *
   * ⚠️ 不能直接用 `snapshot.legend`：那是全库口径，切片后画布上只画了 104 条边，
   * 图例却还写「亲属 172」—— 数字与画面矛盾，用户会以为漏画了。
   * 保留全部分组（含切片内 0 条的），否则分组会在拖动滑块时忽隐忽现。
   */
  const slicedLegend = useMemo(() => {
    const countByCategory = new Map<RelationCategory, number>();
    for (const edge of sliced.edges) {
      countByCategory.set(edge.category, (countByCategory.get(edge.category) ?? 0) + 1);
    }
    return snapshot.legend.map((entry) => ({
      ...entry,
      count: countByCategory.get(entry.category) ?? 0
    }));
  }, [snapshot.legend, sliced.edges]);

  const { selectedTheme, isHydrated } = useHydratedTheme();
  const edgeColors = useMemo(
    () => getEdgeTypeColorsForTheme(isHydrated ? (selectedTheme ?? undefined) : undefined),
    [isHydrated, selectedTheme]
  );

  const nodeById = useMemo(
    () => new Map(sliced.nodes.map((node) => [node.id, node])),
    [sliced.nodes]
  );

  const selectedNode = selectedNodeId === null ? null : (nodeById.get(selectedNodeId) ?? null);

  /** 选中实体的不确定性标记（全库报告按 subjectId 过滤）。 */
  const selectedNodeMarks = useMemo(
    () =>
      uncertainty === null || uncertainty === undefined || selectedNodeId === null
        ? []
        : uncertainty.marks.filter((mark) => mark.subjectType === "entity" && mark.subjectId === selectedNodeId),
    [uncertainty, selectedNodeId]
  );

  /**
   * 当前**已渲染**的实体 id 集合（画布按连接度裁剪）。
   *
   * ⚠️ 浏览器验收实测：不确定性报告是全库口径，而画布只画前 N 个节点；
   * 若对未渲染实体也渲染可点击按钮，用户点击后「什么都不发生」。
   * 面板据此把非渲染集内的实体降级为纯展示。
   */
  /** 选中实体的外部资料（按规范名索引；独立表，读时叠加）。 */
  const selectedNodeExternal = useMemo(
    () =>
      externalKnowledge === null || externalKnowledge === undefined || selectedNode === null
        ? []
        : externalKnowledge[selectedNode.name] ?? [],
    [externalKnowledge, selectedNode]
  );

  const renderedNodeIds = useMemo(
    () => new Set(sliced.nodes.map((node) => node.id)),
    [sliced.nodes]
  );

  /** 选中实体的关联关系（两个方向都算），按关系分组排序便于阅读。 */
  const selectedRelations = useMemo(() => {
    if (selectedNodeId === null) {
      return [];
    }
    return sliced.edges
      .filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
      .sort((left, right) => left.category - right.category);
  }, [selectedNodeId, sliced.edges]);

  /**
   * 切章回时清空选中。
   *
   * 原因：选中的人可能在新切片的图里已经不存在（该回之前还没出场），
   * 保留选中会让详情面板指向一个不在画布上的实体。
   */
  const handleChapterChange = useCallback((chapter: number) => {
    setCurrentChapter(chapter);
    setSelectedNodeId(null);
    setMatrixCell(null);
  }, []);

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

  const highlighted = useMemo(() => [...activeCategories], [activeCategories]);

  const handleSelectCell = useCallback((cell: { codeA: string; codeB: string }) => {
    setMatrixCell(cell);
  }, []);

  /** 切走视图时清空矩阵选择 —— 否则回到矩阵视图会看到上次的详情卡残留。 */
  const changeMode = useCallback((next: GraphViewMode) => {
    setMode(next);
    if (next !== "matrix") {
      setMatrixCell(null);
    }
  }, []);

  /**
   * 路径查找（v1 工具栏「路径查找」面板的接线）。
   *
   * v3 尚无后端最短路服务，这里在**当前切片**内做存在性校验：
   * 两端都能找到则把起点选中并切回全图，让用户立刻看到高亮；
   * 未命中返回 `false`（工具栏据此保留输入，便于改词重试）。
   */
  const handlePathFind = useCallback(
    (sourceName: string, targetName: string): Promise<boolean> => {
      const source = sliced.nodes.find((node) => node.name === sourceName);
      const target = sliced.nodes.find((node) => node.name === targetName);
      if (source === undefined || target === undefined) {
        return Promise.resolve(false);
      }
      setSelectedNodeId(source.id);
      changeMode("full");
      return Promise.resolve(true);
    },
    [sliced.nodes, changeMode]
  );

  /** 导出（v1 工具栏「导出」面板的接线）。v3 暂只支持 JSON 直达，PNG/SVG 落到同一份数据快照。 */
  const handleExport = useCallback(
    (format: "png" | "svg" | "json") => {
      const payload = {
        bookId,
        chapter: currentChapter,
        format,
        nodes  : sliced.nodes.map((node) => ({ id: node.id, name: node.name })),
        edges  : sliced.edges.map((edge) => ({
          source  : edge.source,
          target  : edge.target,
          category: edge.category
        }))
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${bookId}-graph.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [bookId, currentChapter, sliced.edges, sliced.nodes]
  );

  /** 全屏（v1 工具栏「全屏」按钮的接线）。 */
  const handleFullscreen = useCallback(() => {
    const element = document.querySelector(".graph-stage-canvas");
    if (element === null) {
      return;
    }
    if (document.fullscreenElement === null) {
      void element.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  }, []);

  /**
   * 矩阵视图用的快照：把 `nodes`/`edges` 换成**当前切片**，并重算 `codeStats`。
   *
   * ⚠️ `codeStats` 必须跟着切片重算 —— 矩阵的行列维度是「本切片内真实出现的
   * 关系码」，沿用全库统计会把切片内 0 条的码带进来形成空行空列
   * （见 `RelationMatrixPanel` 的文件头说明与设计文档 §5.2）。
   */
  const matrixSnapshot = useMemo<GraphSnapshot>(() => {
    const countByCode = new Map<string, number>();
    for (const edge of sliced.edges) {
      countByCode.set(edge.typeCode, (countByCode.get(edge.typeCode) ?? 0) + 1);
    }
    return {
      ...snapshot,
      nodes    : sliced.nodes,
      edges    : sliced.edges,
      codeStats: snapshot.codeStats
        .filter((stat) => (countByCode.get(stat.code) ?? 0) > 0)
        .map((stat) => ({ ...stat, count: countByCode.get(stat.code) ?? 0 }))
        .sort((left, right) => right.count - left.count)
    };
  }, [snapshot, sliced]);

  return (
    <div className="graph-stage">
      {/* ── 图谱信息头：**唯一一层** title（本页在 `(graph)` 组下，无全局顶栏）。
             版式对齐 v1 `GraphPageHeader`：左侧「返回 + 书首字头像 + 书名/副标题」，
             中间规模统计，右侧主题切换。 ── */}
      <header className="graph-stage-header">
        <div className="graph-stage-heading">
          <Link href="/" className="graph-stage-back" aria-label="返回书库">
            <ArrowLeft className="h-3.5 w-3.5" />
            返回书库
          </Link>

          <span className="graph-stage-divider" aria-hidden="true" />

          {/* 书首字头像：与 v1 一致，用主题主色淡底 + 主色字。 */}
          <span className="graph-stage-avatar" aria-hidden="true">
            {snapshot.bookTitle.charAt(0)}
          </span>

          <div className="graph-stage-titles">
            <h1 className="graph-stage-title">{snapshot.bookTitle}</h1>
            <p className="graph-stage-subtitle">人物关系图谱</p>
          </div>
        </div>

        <dl className="graph-stage-metrics">
          <div className="graph-stage-metric">
            <dt>
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              实体
            </dt>
            {/* 显示**当前切片**的数量：拖动章节滑块时这里会实时变化，
                让「截至第 N 回」这件事有即时反馈（全库总数见副标题）。 */}
            <dd>{sliced.nodes.length}</dd>
          </div>
          <div className="graph-stage-metric">
            <dt>
              <Waypoints className="h-3.5 w-3.5" aria-hidden="true" />
              关系
            </dt>
            <dd>{sliced.edges.length}</dd>
          </div>
          <div className="graph-stage-metric">
            <dt>回目</dt>
            <dd>
              {currentChapter}
              <span className="graph-stage-metric-total"> / {snapshot.chapterCount}</span>
            </dd>
          </div>
          {/* 不确定性计数（修正案 4：一二期捆绑的最小可见出口）。
              全库口径、不随章节滑块变化；分类明细悬浮可见，逐实体标注属二期。 */}
          {uncertainty !== null && uncertainty !== undefined ? (
            <div className="graph-stage-metric">
              <dt>不确定</dt>
              <dd title={uncertainty.coverage.byKind
                .map((entry) => `${UNCERTAINTY_KIND_LABELS[entry.kind]} ${entry.count}`)
                .join(" · ")}>
                {uncertainty.marks.length}
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="graph-stage-actions">
          {uncertainty !== null && uncertainty !== undefined && uncertainty.marks.length > 0 ? (
            <button
              type="button"
              className="graph-uncertainty-toggle"
              aria-expanded={showUncertainty}
              aria-label={`不确定性（${String(uncertainty.marks.length)} 条标记）`}
              onClick={() => {
                setShowUncertainty((open) => !open);
              }}
            >
              不确定性
            </button>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      {/* ── 画布区：相对定位，所有控件以浮层形式叠加其上 ── */}
      <div className="graph-stage-canvas">
        {mode === "full" ? (
          <>
            <ForceGraphCanvas
              nodes={sliced.nodes}
              edges={sliced.edges}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              highlightedCategories={highlighted}
            />
            {/* 详情面板：仅选中节点时渲染（「节点详情默认收起」）。 */}
            {selectedNode !== null ? (
              <GraphDetailPanel
                node={selectedNode}
                relations={selectedRelations}
                counterpartNames={counterpartNames}
                onSelectNode={setSelectedNodeId}
                onClose={() => {
                  setSelectedNodeId(null);
                }}
                profileHref={`/book/${bookId}/entity/${selectedNodeId ?? ""}`}
                bookId={bookId}
                marks={selectedNodeMarks}
                external={selectedNodeExternal}
              />
            ) : null}

            {/* 不确定性面板（二期）：信息头按钮开关，仅在 full 视图渲染
                （批 63 教训：浮层门槛用 mode === "full"，防压 FocusView）。 */}
            {showUncertainty && uncertainty !== null && uncertainty !== undefined ? (
              <UncertaintyPanel
                report={uncertainty}
                selectableIds={renderedNodeIds}
                onSelectNode={(nodeId) => {
                  setSelectedNodeId(nodeId);
                  setShowUncertainty(false);
                }}
                onClose={() => {
                  setShowUncertainty(false);
                }}
              />
            ) : null}
          </>
        ) : null}

        {mode === "focus" ? (
          <FocusView
            nodes={sliced.nodes}
            edges={sliced.edges}
            chapters={snapshot.chapters}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        ) : null}

        {mode === "matrix" ? (
          <>
            <div className="graph-stage-matrix">
              <RelationMatrixPanel
                snapshot={matrixSnapshot}
                activeCell={matrixCell}
                onSelectCell={handleSelectCell}
              />
            </div>
            {/* 矩阵详情抽屉：未选格子时给出引导，不做空白占位。 */}
            <aside className="graph-stage-drawer" aria-label="矩阵详情">
              {matrixCell === null ? (
                <p className="graph-stage-drawer-hint">
                  点击左侧任一格子，查看对应的人物对与原文依据。
                </p>
              ) : (
                <MatrixDetailCard
                  snapshot={matrixSnapshot}
                  cell={matrixCell}
                  onClose={() => {
                    setMatrixCell(null);
                  }}
                />
              )}
            </aside>
          </>
        ) : null}

        {/* ── 左上浮层：工具栏（对齐 v1 `graph-toolbar`） ──
             v1 把「筛选 / 搜索 / 路径 / 布局 / 导出 / 全屏」全部收在这一列图标后面；
             v3 的搜索与三视图切换因此不再各占一个常驻浮层，而是并入工具栏面板，
             观感与 v1 一致，功能一个不减。

             ⚠️ **只在「全图」模式渲染**（不得放宽为 `mode !== "matrix"`）：
             工具栏是 `absolute left-4 top-4` 的浮层，而「聚焦」视图的
             `FocusView` 是一块**铺满画布的内容面板**（顶部就是人物名 + 关系统计
             的表头）。在全图层，浮层叠在力导向画布上无妨（画布本就没有「表头」）；
             在聚焦层，同一位置会**压住表头文字**，用户读到的是半截句子。
             矩阵模式此前已按同一理由排除（见 `graph-stage-matrix` 的设计），
             聚焦模式属同类「内容面板」，因此同样排除。

             聚焦视图自身的导航由两处保障，不需要这条工具栏：
             ① 右上常驻的视图切换条可切回「全图 / 矩阵」；
             ② `FocusView` 内置 `NodePicker`（主要人物快捷选择）。 */}
        {mode === "full" ? (
          <GraphToolbar
            activeCategories={activeCategories}
            onToggleCategory={toggleCategory}
            nodes={sliced.nodes}
            onSelectNode={setSelectedNodeId}
            viewMode={mode}
            onViewModeChange={changeMode}
            onPathFind={handlePathFind}
            onExport={handleExport}
            onFullscreen={handleFullscreen}
          />
        ) : null}

        {/* ── 左下浮层：图例（竖排一列，对齐 v1 `graph-legend`） ──
             ⚠️ 同工具栏：**只在「全图」渲染**。图例解释的是**画布上边的颜色**，
             聚焦视图是关系卡片列表（每条卡片自带色点与关系名），不需要图例；
             叠在列表上只会挡住底部几行。
             🚨 反例守卫：不得回退为 `mode !== "matrix"`。 */}
        {mode === "full" ? (
          <div className="graph-stage-legend" aria-label="关系分组图例">
            <div className="graph-stage-legend-title" aria-hidden="true">
              关系类型
            </div>

            <ul className="graph-stage-legend-list">
              {slicedLegend.map((entry) => {
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
                      <span className="graph-legend-label">{entry.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* 「节点状态」区：对齐 v1 `graph-legend` 的第二段（已校对 / 待校对）。 */}
            <div className="graph-stage-legend-status">
              <div className="graph-stage-legend-title" aria-hidden="true">
                节点状态
              </div>
              <div className="graph-stage-legend-status-item">
                <span className="graph-stage-legend-status-dot" aria-hidden="true" />
                <span>已校对</span>
              </div>
              <div className="graph-stage-legend-status-item">
                <span className="graph-stage-legend-status-dot-pending" aria-hidden="true" />
                <span>待校对</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── 右上浮层：视图切换（全图 / 聚焦 / 矩阵） ──
             v1 没有这条切换条，但 v3 的三视图是核心能力，保留为**快捷入口**；
             同一能力在左上工具栏的「布局」面板里也有一份，两处驱动同一个 `mode`。
             样式对齐 v1 `graph-toolbar` 的面板语言：
             `rounded-lg border-border/60 bg-card/80 blur-md shadow-lg`。 */}
        <div className="graph-stage-modes" role="tablist" aria-label="视图切换">
          {VIEW_MODES.map((item) => (
            <button
              key={item.mode}
              type="button"
              role="tab"
              className="graph-stage-mode"
              data-active={mode === item.mode}
              aria-selected={mode === item.mode}
              onClick={() => {
                changeMode(item.mode);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* ── 底部浮层：章节时间轴（对齐 v1 `chapter-timeline`） ──
             ⚠️ 同工具栏/图例：**只在「全图」渲染**。时间轴驱动的是 `currentChapter`
             切片，而**聚焦视图的列表已经是切片后的结果**（`sliced`）——
             在全图层它是有用的「时间机器」，在聚焦层它横跨底边、压住关系卡片。
             要换章回时切回全图即可（右上切换条常驻）。
             🚨 反例守卫：不得回退为 `mode !== "matrix"`。 */}
        {mode === "full" ? (
          <ChapterTimeline
            totalChapters={snapshot.chapterCount}
            currentChapter={currentChapter}
            onChapterChange={handleChapterChange}
            chapterUnit="回"
          />
        ) : null}

        {/* ── 底部浮层：截断提示 ──
            说的是**全库渲染上限**（300），不是当前切片 —— 因此措辞要带「全库」，
            否则切片到第 30 回时「展示前 300 个」会和画布上的 104 个自相矛盾。 */}
        {snapshot.truncatedNodeCount > 0 && mode === "full" ? (
          <p className="graph-stage-notice">
            全库实体较多，已按连接度取前 {snapshot.nodes.length} 个，另有{" "}
            {snapshot.truncatedNodeCount} 个低频实体未纳入。
          </p>
        ) : null}
      </div>
    </div>
  );
}
