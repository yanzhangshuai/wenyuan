"use client";

import { Download, Filter, LayoutGrid, Maximize, Route, Search, X } from "lucide-react";
import { useState } from "react";

import type { GraphViewMode } from "@/components/graph/GraphView";
import { RELATION_GROUPS } from "@/lib/graph/grouping";
import type { RelationCategory } from "@/lib/relations";
import type { GraphNode } from "@/types/graph";

/**
 * 图谱工具栏（左上角操作入口聚合区）—— 对齐 v1 `graph-toolbar`。
 *
 * ## 为什么要 1:1 复刻 v1
 *
 * v1 的图谱页是「画布铺满 + 左侧图标工具栏 + 左下角图例 + 底部时间轴」四件套。
 * v3 此前把「搜索」与「视图切换」做成了两个独立浮层，观感与 v1 差得很远。
 * 本组件按 v1 的结构重建工具栏，并把 v3 的既有能力收纳进它的面板里：
 *
 * | v1 面板 | v3 接线 |
 * |---|---|
 * | 筛选 | `RELATION_GROUPS` 关系分组多选（驱动 `activeCategories`） |
 * | 搜索 | 人物名检索（驱动 `onSelectNode` 选中并定位） |
 * | 路径查找 | 起点 / 终点人物名输入（驱动 `onPathFind`） |
 * | 布局 | 三视图：全图 / 聚焦 / 矩阵（驱动 `onViewModeChange`） |
 * | 导出 | 导出 PNG / SVG / JSON（驱动 `onExport`） |
 * | 全屏 | 整舞台全屏（驱动 `onFullscreen`） |
 *
 * ## 样式口径
 *
 * 逐字对齐 v1 `graph-toolbar.tsx` 的 Tailwind 类：
 * - 容器 `absolute left-4 top-4 z-10 flex flex-col gap-2`；
 * - 图标列 `flex flex-col gap-1 rounded-lg border border-border/60 bg-card/80
 *   backdrop-blur-md p-1 shadow-lg`；
 * - 按钮 `flex items-center justify-center rounded-md p-2 transition-colors hover:bg-accent`，
 *   激活态 `bg-accent text-accent-foreground`，其余 `text-muted-foreground`；
 * - 图标 `size={18}`；分隔线 `my-0.5 h-px bg-border/60`；
 * - 展开面板 `w-64 rounded-lg border border-border/60 bg-card/80 backdrop-blur-md p-3 shadow-lg`。
 *
 * ⚠️ v1 的面板按钮用了 `text-(--color-primary-fg)`，但该变量在 v1 全仓**未定义**
 * （只有 `--primary-foreground`）—— 这是 v1 的静默 bug，此处显式用
 * `var(--color-primary-foreground)`，不照抄失效变量。
 */

/** 工具栏当前展开的面板标识；`null` 表示只显示图标列。 */
type ToolbarPanel = "filter" | "search" | "path" | "layout" | "export" | null;

export interface GraphToolbarProps {
  /** 当前激活的关系分组集合（空集 = 全部显示）。 */
  activeCategories: ReadonlySet<RelationCategory>;
  /** 关系分组多选切换回调。 */
  onToggleCategory: (category: RelationCategory) => void;
  /** 当前切片内的人物候选（供搜索面板检索）。 */
  nodes           : readonly GraphNode[];
  /** 选中人物回调（搜索命中后定位）。 */
  onSelectNode    : (nodeId: string) => void;
  /** 当前视图模式。 */
  viewMode        : GraphViewMode;
  /** 视图模式切换回调。 */
  onViewModeChange: (mode: GraphViewMode) => void;
  /** 路径查找回调，返回是否命中（命中则自动收起面板）。 */
  onPathFind      : (sourceName: string, targetName: string) => Promise<boolean>;
  /** 导出回调。 */
  onExport        : (format: "png" | "svg" | "json") => void;
  /** 全屏切换回调。 */
  onFullscreen    : () => void;
}

/** v1 `graph-view` 的视图模式契约：`force`/`radial`/`tree`；此处映射为 v3 的三视图。 */
const VIEW_MODE_OPTIONS: readonly { mode: GraphViewMode; label: string }[] = [
  { mode: "full", label: "全图" },
  { mode: "focus", label: "聚焦" },
  { mode: "matrix", label: "矩阵" }
];

/** 工具按钮元数据（用于统一渲染图标列，图标尺寸对齐 v1 的 `size={18}`）。 */
const TOOL_BUTTONS: readonly { id: Exclude<ToolbarPanel, null>; label: string }[] = [
  { id: "filter", label: "筛选" },
  { id: "search", label: "搜索" },
  { id: "path", label: "路径查找" },
  { id: "layout", label: "布局" },
  { id: "export", label: "导出" }
];

/** 工具按钮图标：单独映射，避免在数据里放 JSX（保持数组可纯数据化）。 */
function ToolIcon({ id }: { id: Exclude<ToolbarPanel, null> }) {
  switch (id) {
    case "filter":
      return <Filter size={18} />;
    case "search":
      return <Search size={18} />;
    case "path":
      return <Route size={18} />;
    case "layout":
      return <LayoutGrid size={18} />;
    case "export":
      return <Download size={18} />;
  }
}

export function GraphToolbar({
  activeCategories,
  onToggleCategory,
  nodes,
  onSelectNode,
  viewMode,
  onViewModeChange,
  onPathFind,
  onExport,
  onFullscreen
}: GraphToolbarProps) {
  const [activePanel, setActivePanel] = useState<ToolbarPanel>(null);
  /** 搜索框本地输入态：只在提交时才动主图，避免每次按键触发重算。 */
  const [searchInput, setSearchInput] = useState("");
  const [pathSource, setPathSource] = useState("");
  const [pathTarget, setPathTarget] = useState("");
  const [pathFinding, setPathFinding] = useState(false);

  /** 面板切换：点已展开的收起，点其他切换（与 v1 一致的单面板互斥）。 */
  function togglePanel(panel: ToolbarPanel) {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }

  /** 提交搜索：把输入交给上层做「名字包含」匹配并选中。 */
  function handleSearchSubmit() {
    const keyword = searchInput.trim();
    if (keyword === "") {
      return;
    }
    const hit = nodes.find((node) => node.name.includes(keyword));
    if (hit !== undefined) {
      onSelectNode(hit.id);
    }
  }

  /** 提交路径查找：起点终点都非空才发起，命中后收起面板（v1 同策略）。 */
  async function handlePathSubmit() {
    if (pathSource.trim() === "" || pathTarget.trim() === "" || pathFinding) {
      return;
    }
    setPathFinding(true);
    try {
      const found = await onPathFind(pathSource.trim(), pathTarget.trim());
      if (found) {
        setActivePanel(null);
      }
    } finally {
      setPathFinding(false);
    }
  }

  const activeLabel =
    activePanel === null
      ? ""
      : activePanel === "layout"
        ? "布局"
        : (TOOL_BUTTONS.find((btn) => btn.id === activePanel)?.label ?? "");

  return (
    <div className="graph-toolbar">
      {/* 工具图标列：5 个功能入口 + 分隔线 + 全屏。 */}
      <div className="graph-toolbar-icons">
        {TOOL_BUTTONS.map((btn) => (
          <button
            key={btn.id}
            type="button"
            onClick={() => {
              togglePanel(btn.id);
            }}
            className="graph-toolbar-btn"
            data-active={activePanel === btn.id}
            aria-label={btn.label}
            aria-pressed={activePanel === btn.id}
            title={btn.label}
          >
            <ToolIcon id={btn.id} />
          </button>
        ))}

        <div className="graph-toolbar-divider" />

        <button
          type="button"
          onClick={onFullscreen}
          className="graph-toolbar-btn"
          aria-label="全屏"
          title="全屏"
        >
          <Maximize size={18} />
        </button>
      </div>

      {/* 可展开功能面板：单面板互斥，内容按 `activePanel` 切换。 */}
      {activePanel === null ? null : (
        <div className="graph-toolbar-panel">
          <div className="graph-toolbar-panel-head">
            <span className="graph-toolbar-panel-title">{activeLabel}</span>
            <button
              type="button"
              onClick={() => {
                setActivePanel(null);
              }}
              className="graph-toolbar-panel-close"
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          </div>

          {activePanel === "filter" ? (
            <div className="graph-toolbar-filter">
              <p className="graph-toolbar-panel-label">关系类型</p>
              <div className="graph-toolbar-chip-row">
                {RELATION_GROUPS.map((group) => (
                  <button
                    key={group.category}
                    type="button"
                    onClick={() => {
                      onToggleCategory(group.category);
                    }}
                    className="graph-toolbar-chip"
                    data-selected={
                      activeCategories.size === 0 || activeCategories.has(group.category)
                    }
                  >
                    {group.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {activePanel === "search" ? (
            <div className="graph-toolbar-search">
              <input
                type="text"
                placeholder="搜索人物..."
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleSearchSubmit();
                  }
                }}
                className="graph-toolbar-input"
                aria-label="搜索人物"
              />
              <button type="button" onClick={handleSearchSubmit} className="graph-toolbar-submit">
                搜索
              </button>
            </div>
          ) : null}

          {activePanel === "path" ? (
            <div className="graph-toolbar-path">
              <input
                type="text"
                placeholder="起点人物名..."
                value={pathSource}
                onChange={(event) => {
                  setPathSource(event.target.value);
                }}
                className="graph-toolbar-input"
                aria-label="起点人物名"
              />
              <input
                type="text"
                placeholder="终点人物名..."
                value={pathTarget}
                onChange={(event) => {
                  setPathTarget(event.target.value);
                }}
                className="graph-toolbar-input"
                aria-label="终点人物名"
              />
              <button
                type="button"
                onClick={() => {
                  void handlePathSubmit();
                }}
                disabled={pathSource.trim() === "" || pathTarget.trim() === "" || pathFinding}
                className="graph-toolbar-submit"
              >
                {pathFinding ? "查找中..." : "查找路径"}
              </button>
            </div>
          ) : null}

          {activePanel === "layout" ? (
            <div className="graph-toolbar-list">
              {VIEW_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => {
                    onViewModeChange(opt.mode);
                  }}
                  className="graph-toolbar-list-item"
                  data-selected={viewMode === opt.mode}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}

          {activePanel === "export" ? (
            <div className="graph-toolbar-list">
              {(
                [
                  { format: "png" as const, label: "导出 PNG" },
                  { format: "svg" as const, label: "导出 SVG" },
                  { format: "json" as const, label: "导出 JSON" }
                ]
              ).map((opt) => (
                <button
                  key={opt.format}
                  type="button"
                  onClick={() => {
                    onExport(opt.format);
                  }}
                  className="graph-toolbar-list-item"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
