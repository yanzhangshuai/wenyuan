import type { EntityType } from "@/lib/entities";
import type { RelationCategory } from "@/lib/relations";

/**
 * 实体档案视图模型（「人物百科」的数据契约）。
 *
 * 设计原因：图谱回答「谁和谁有关系」，档案回答「这个人做过什么」。
 * 后者是本项目**已有数据**的重新组织 —— 提及记录（`entity_mentions`）
 * 本身带段落坐标，按回次排序即得事迹时间线，**无需新增任何 LLM 调用**。
 *
 * 核心约束（与图谱视图模型一致）：
 * 1. 不把数据库行直接透传，收敛成「渲染所需的最小集合」；
 * 2. 派生指标（跨回数、提及数）在服务端一次算好；
 * 3. 字段可判空 —— 大量实体只被提及一两次，时间线可能极短，
 *    渲染层必须能表达「信息不足」而不是假装有内容。
 */

/** 一条事迹：实体在某一段落中的一次出现。 */
export interface EntityDeed {
  /** 章节回号（`chapters.ordinal`；前置内容为 0）。 */
  chapterOrdinal  : number;
  /** 章节标题。 */
  chapterTitle    : string;
  /** 段落在章内的序号。 */
  paragraphOrdinal: number;
  /** 命中的字面形式（可能是别名）。 */
  surface         : string;
  /** 该段落原文（渲染层按需截断，不由数据层截断 —— 截断是展示决策）。 */
  paragraphText   : string;
  /** 命中片段在该段落内的起始偏移。 */
  startOffset     : number;
  /** 命中片段在该段落内的结束偏移。 */
  endOffset       : number;
}

/** 事迹时间线按回次聚合后的一份。 */
export interface EntityDeedChapter {
  chapterOrdinal: number;
  chapterTitle  : string;
  deeds         : EntityDeed[];
}

/** 实体档案快照。 */
export interface EntityProfile {
  id          : string;
  /** 规范名。 */
  name        : string;
  type        : EntityType;
  factionIndex: number | null;
  /** 别名列表（不含规范名本身）。 */
  aliases     : string[];
  /** 在原文中被提及的段落总数。 */
  mentionCount: number;
  /** 覆盖的章节数（回号去重后的个数）。 */
  chapterCount: number;
  /** 首次出现的回号；无提及时为 null。 */
  firstChapter: number | null;
  /** 末次出现的回号；无提及时为 null。 */
  lastChapter : number | null;
  /** 事迹时间线（按回次升序）。 */
  timeline    : EntityDeedChapter[];
}

/**
 * 信息量分档的类型与判据在 `@/lib/graph/profile`（纯逻辑，可测）。
 * 此处只保留视图模型形状。
 */

/** 时间线单回内最多展示的事迹条数（防止单回刷屏）；超出部分计数提示。 */
export const DEEDS_PER_CHAPTER_PREVIEW = 6;

/** 档案面板展示所需的关系项（复用图谱边形状的精简形式）。 */
export interface EntityRelationBrief {
  id          : string;
  /** 对端实体名。 */
  counterpart : string;
  typeCode    : string;
  category    : RelationCategory;
  startChapter: number;
  endChapter  : number | null;
  status      : "ACTIVE" | "ENDED";
  quote       : string | null;
}
