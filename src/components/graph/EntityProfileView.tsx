"use client";

import { useMemo, useState } from "react";

import { useHydratedTheme } from "@/hooks/use-hydrated-theme";
import { ENTITY_TYPE_LABELS } from "@/lib/entities";
import { getEdgeColorForCategory, getRelationGroupLabel } from "@/lib/graph/grouping";
import { classifyDensity, DENSITY_THRESHOLDS } from "@/lib/graph/profile";
import { getEdgeTypeColorsForTheme } from "@/theme";
import {
  DEEDS_PER_CHAPTER_PREVIEW,
  type EntityDeed,
  type EntityProfile,
  type EntityRelationBrief
} from "@/types/profile";

/**
 * 人物档案视图（客户端）。
 *
 * ## 为什么是 Client Component
 *
 * 时间线需要「逐回展开/收起」的本地状态（rich 档人物可跨上百回，
 * 一次全展开会变成无限长页面）。取数仍全部在服务端完成。
 *
 * ## 🚨 分档是承重设计，不是优化
 *
 * 实测《儒林外史》提及数中位数 **2**、《红楼梦》**1** —— 过半实体只出现一两次。
 * 因此：
 * - `sparse`（< 10）：**只给原文落点，不编造小传**（本页本来也没有小传字段）；
 * - `moderate`（≥ 10）：展示时间线，标出「信息有限」；
 * - `rich`（≥ 30）：完整时间线。
 *
 * 若不分档，743 + 874 个长尾实体会得到一堆空洞页面。
 */

export interface EntityProfileViewProps {
  profile  : EntityProfile;
  relations: readonly EntityRelationBrief[];
  bookId   : string;
}

export function EntityProfileView({ profile, relations, bookId }: EntityProfileViewProps) {
  const density = classifyDensity(profile.mentionCount);

  return (
    <div className="profile-page">
      <ProfileHeader profile={profile} density={density} bookId={bookId} />
      <RelationTimeline relations={relations} />
      <DeedTimeline profile={profile} density={density} />
    </div>
  );
}

/** 档案头：姓名 / 类型 / 统计 / 别名 / 密度分档。 */
function ProfileHeader({
  profile,
  density,
  bookId
}: {
  profile: EntityProfile;
  density: ReturnType<typeof classifyDensity>;
  bookId : string;
}) {
  const densityInfo = DENSITY_LABELS[density];

  return (
    <section className="profile-header">
      <div className="profile-header-main">
        <h2 className="profile-name">{profile.name}</h2>
        <p className="profile-meta">
          {ENTITY_TYPE_LABELS[profile.type]} · 出现 {profile.mentionCount} 段 · 跨{" "}
          {profile.chapterCount} 回
          {profile.firstChapter === null
            ? ""
            : ` · 第 ${String(profile.firstChapter)}–${String(profile.lastChapter ?? profile.firstChapter)} 回`}
        </p>
        {profile.aliases.length === 0 ? null : (
          <p className="profile-aliases">
            别名：{profile.aliases.join("、")}
          </p>
        )}
      </div>
      <div className="profile-header-side">
        <span className="profile-density" data-density={density}>
          {densityInfo.label}
        </span>
        <a className="profile-graph-link" href={`/book/${bookId}`}>
          在图谱中查看 →
        </a>
      </div>
    </section>
  );
}

/** 密度分档的展示文案。 */
const DENSITY_LABELS: Readonly<
  Record<ReturnType<typeof classifyDensity>, { label: string; note: string }>
> = {
  rich    : { label: "信息丰富", note: "该人物在全书中出现频繁，时间线较为完整。" },
  moderate: { label: "信息有限", note: "该人物的出现次数中等，时间线可读但可能不完整。" },
  sparse  : {
    label: "信息稀少",
    note : `该人物仅出现 ${String(DENSITY_THRESHOLDS.moderate)} 段以下，只呈现原文落点，不编造小传。`
  }
};

/** 关系时间轴（第 2 层）：谁在第几回起成为什么人。 */
function RelationTimeline({ relations }: { relations: readonly EntityRelationBrief[] }) {
  const { selectedTheme, isHydrated } = useHydratedTheme();
  const edgeColors = useMemo(
    () => getEdgeTypeColorsForTheme(isHydrated ? (selectedTheme ?? undefined) : undefined),
    [isHydrated, selectedTheme]
  );

  if (relations.length === 0) {
    return (
      <section className="profile-section">
        <h3 className="profile-section-title">关系时间轴</h3>
        <p className="profile-empty">该人物暂无已解析出的关系记录。</p>
      </section>
    );
  }

  return (
    <section className="profile-section">
      <h3 className="profile-section-title">
        关系时间轴 <span className="profile-section-count">{relations.length}</span>
      </h3>
      <ul className="profile-relations">
        {relations.map((relation) => (
          <li key={relation.id} className="profile-relation">
            <span
              className="profile-relation-swatch"
              style={{ backgroundColor: getEdgeColorForCategory(edgeColors, relation.category) }}
              aria-hidden="true"
            />
            <span className="profile-relation-group">{getRelationGroupLabel(relation.category)}</span>
            <span className="profile-relation-code">{relation.typeCode}</span>
            <span className="profile-relation-counterpart">{relation.counterpart}</span>
            <span className="profile-relation-range">
              {formatRelationRange(relation)}
            </span>
            {relation.quote === null ? null : (
              <span className="profile-relation-quote">「{truncate(relation.quote, 36)}」</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 事迹时间线（第 1 层）：按回次分组的原文落点。 */
function DeedTimeline({
  profile,
  density
}: {
  profile: EntityProfile;
  density: ReturnType<typeof classifyDensity>;
}) {
  if (profile.timeline.length === 0) {
    return (
      <section className="profile-section">
        <h3 className="profile-section-title">事迹时间线</h3>
        <p className="profile-empty">该人物在原文中没有可定位的提及记录。</p>
      </section>
    );
  }

  return (
    <section className="profile-section">
      <h3 className="profile-section-title">
        事迹时间线 <span className="profile-section-count">{profile.timeline.length} 回</span>
      </h3>
      <p className="profile-density-note">{DENSITY_LABELS[density].note}</p>
      <ol className="deed-timeline">
        {profile.timeline.map((group) => (
          <DeedChapter key={group.chapterOrdinal} group={group} />
        ))}
      </ol>
    </section>
  );
}

/** 单回的事迹块（默认只展示前 N 条，超出可展开）。 */
function DeedChapter({
  group
}: {
  group: EntityProfile["timeline"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? group.deeds : group.deeds.slice(0, DEEDS_PER_CHAPTER_PREVIEW);
  const hiddenCount = group.deeds.length - visible.length;

  return (
    <li className="deed-chapter">
      <h4 className="deed-chapter-title">
        <span className="deed-chapter-ordinal">第 {group.chapterOrdinal} 回</span>
        {group.chapterTitle === "" ? null : (
          <span className="deed-chapter-name">{group.chapterTitle}</span>
        )}
        <span className="deed-chapter-count">{group.deeds.length} 处</span>
      </h4>
      <ul className="deed-list">
        {visible.map((deed, index) => (
          <li key={`${String(deed.paragraphOrdinal)}-${String(index)}`} className="deed-item">
            <span className="deed-surface">{deed.surface}</span>
            <p className="deed-text">{renderHighlighted(deed)}</p>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="deed-more"
          onClick={() => {
            setExpanded(true);
          }}
        >
          展开其余 {hiddenCount} 处
        </button>
      ) : null}
    </li>
  );
}

/**
 * 渲染一段原文，并把命中片段加粗。
 *
 * 用 `startOffset` / `endOffset` 切分而不是字符串替换：
 * 同一段可能出现多次同名，替换会命中全部；而 `(surface, offset)` 才是精确落点。
 * ⚠️ 偏移量是**整段文本**内坐标（与 `entity_mentions` 写入时一致），不做任何重排。
 */
function renderHighlighted(deed: EntityDeed): React.ReactNode {
  const { paragraphText, startOffset, endOffset } = deed;
  if (
    startOffset < 0 ||
    endOffset > paragraphText.length ||
    startOffset >= endOffset
  ) {
    // 坐标越界时退回整段（宁可不加粗，也不要切出错乱的文本）。
    return truncate(paragraphText, 160);
  }

  const before = paragraphText.slice(0, startOffset);
  const hit = paragraphText.slice(startOffset, endOffset);
  const after = paragraphText.slice(endOffset);

  return (
    <>
      {truncateHead(before)}
      <mark className="deed-hit">{hit}</mark>
      {truncateTail(after)}
    </>
  );
}

/** 命中片段前的文本：过长时保留尾部（贴近命中处）。 */
function truncateHead(text: string, max = 60): string {
  return text.length <= max ? text : `…${text.slice(text.length - max)}`;
}

/** 命中片段后的文本：过长时截断（按展示决策截断，不改数据）。 */
function truncateTail(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** 关系区间文案。 */
function formatRelationRange(relation: EntityRelationBrief): string {
  if (relation.endChapter === null || relation.endChapter === relation.startChapter) {
    return `第 ${String(relation.startChapter)} 回起`;
  }
  return `第 ${String(relation.startChapter)}–${String(relation.endChapter)} 回`;
}

/** 通用截断。 */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
