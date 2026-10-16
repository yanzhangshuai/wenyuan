"use client";

import { groupMarksByKind } from "@/lib/graph/uncertainty";
import type { UncertaintyMark, UncertaintyReport } from "@/types/graph";

/**
 * 不确定性面板（二期：浮层分区展示）。
 *
 * 设计文档 §六「一二期捆绑交付」：检测一期只在信息头给了计数，
 * 本面板把标记按类别分组摊开 —— 「系统能意识到自己的不确定」由此第一次对用户可见。
 *
 * 交互约定：
 * - 实体标记可点击 → 选中该节点（并关闭本面板，让详情卡展示逐实体徽标）；
 * - 关系标记仅展示（定位到关系属矩阵交互，超出二期范围）；
 * - 面板默认关闭，由信息头按钮开关；仅在 `mode === "full"` 渲染
 *   （批 63 教训：浮层门槛用 `mode === "full"`，防止压住 FocusView）。
 */

export interface UncertaintyPanelProps {
  /** 不确定性报告（全库口径，读时派生）。 */
  report       : UncertaintyReport;
  /**
   * 当前**已渲染**的实体 id 集合（画布按连接度裁剪，只画前 N 个）。
   *
   * ⚠️ 浏览器验收实测：报告是全库口径，若对未渲染的实体也渲染成可点击按钮，
   * 用户点了会「什么都不发生」（`nodeById` 查不到 → 详情卡不出现）。
   * 故非渲染集内的实体只展示、不可点。
   */
  selectableIds: ReadonlySet<string>;
  /** 点击实体标记时选中对应节点。 */
  onSelectNode : (nodeId: string) => void;
  /** 关闭面板。 */
  onClose      : () => void;
}

export function UncertaintyPanel({
  report,
  selectableIds,
  onSelectNode,
  onClose
}: UncertaintyPanelProps) {
  const groups = groupMarksByKind(report.marks);

  return (
    <aside className="graph-uncertainty-panel" aria-label="不确定性列表">
      <header className="graph-uncertainty-head">
        <h2 className="graph-uncertainty-title">不确定性</h2>
        <span className="graph-uncertainty-total">{report.marks.length} 条</span>
        <button
          type="button"
          className="graph-uncertainty-close"
          aria-label="关闭不确定性面板"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {groups.length === 0 ? (
        <p className="graph-uncertainty-hint">当前图谱没有检出不确定性标记。</p>
      ) : (
        groups.map((group) => (
          <section key={group.kind} className="graph-uncertainty-group">
            <h3 className="graph-uncertainty-group-title">
              {group.label}
              <span className="graph-uncertainty-group-count">{group.marks.length}</span>
            </h3>
            <ul className="graph-uncertainty-list">
              {group.marks.map((mark) => (
                <UncertaintyItem
                  key={`${mark.kind}-${mark.subjectId}-${mark.subjectKey}`}
                  mark={mark}
                  selectableIds={selectableIds}
                  onSelectNode={onSelectNode}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </aside>
  );
}

function UncertaintyItem({
  mark,
  selectableIds,
  onSelectNode
}: {
  mark         : UncertaintyMark;
  selectableIds: ReadonlySet<string>;
  onSelectNode : (nodeId: string) => void;
}) {
  if (mark.subjectType === "entity" && selectableIds.has(mark.subjectId)) {
    return (
      <li className="graph-uncertainty-item">
        <button
          type="button"
          className="graph-uncertainty-subject"
          data-selectable="true"
          title={mark.detail}
          onClick={() => {
            onSelectNode(mark.subjectId);
          }}
        >
          {mark.subjectKey}
        </button>
        <span className="graph-uncertainty-confidence" data-confidence={mark.confidence}>
          {mark.confidence}
        </span>
      </li>
    );
  }

  // 关系标记，或未纳入当前渲染子集的实体：只展示（点了也定位不到）。
  const reason =
    mark.subjectType === "entity"
      ? `${mark.detail}（该实体未纳入当前渲染子集，按连接度裁剪）`
      : mark.detail;
  return (
    <li className="graph-uncertainty-item">
      <span className="graph-uncertainty-subject" data-selectable="false" title={reason}>
        {mark.subjectKey}
      </span>
      <span className="graph-uncertainty-confidence" data-confidence={mark.confidence}>
        {mark.confidence}
      </span>
    </li>
  );
}
