import type {
  UncertaintyCoverage,
  UncertaintyKind,
  UncertaintyMark,
  UncertaintyReport
} from "@/types/graph";

/**
 * 不确定性检测器（设计文档 §3，修正案 1/4）。
 *
 * 定位：**图谱的确定性派生** —— 只依赖图谱自身，读时计算，永不落库。
 * 本模块是纯函数层：所有依赖词表/闸门判定的信息都以「读侧预计算的字段」
 * 注入（`gateRejection` / `honorificForm` / `properNameForm`），本文件不 import
 * 任何管线模块，保持 `src/lib` 的零依赖方向。
 *
 * 纪律（修正案 1）：
 * - 每个检测器有 `{ id, version }`，版本号只增不减；改动判定逻辑必须升版本；
 * - 每条标记必带 `confidence`；拿不准的检测器降 confidence，而不是先上线再说；
 * - 宁可少标，不可错标（继承 P5 归并原则）。
 *
 * ⚠️ 口径警告：输入必须是**全库**实体/关系。`loadGraphSnapshot` 的 nodes/edges
 * 是裁剪后的渲染子集，用它当输入就是「切片尺子」（命中率随裁剪阈值漂移）。
 *
 * 第六类 `recall_suspect`（P0 候选差集）已经探针验证可行且有真阳性，
 * 但需要在请求路径上跑全书分词（红楼梦 2.57 MB），性能方案未定，
 * 本批不接线 —— 详见设计文档 §3.6 与未决问题 8。
 */

/** 实体侧输入（读侧按全库实体逐条装配）。 */
export interface UncertaintyEntityInput {
  id             : string;
  canonical      : string;
  /** 实体类型（`PERSON` / `LOCATION` / …）。 */
  type           : string;
  aliasCount     : number;
  /** 读侧用 `isHonorificForm(canonical)` 预计算。 */
  honorificForm  : boolean;
  /** 读侧用 `isProperNameForm(canonical)` 预计算。 */
  properNameForm : boolean;
  /**
   * 读侧用现行闸门 `judgeEntityName(canonical, type)` 复核的结果：
   * `null` = 闸门放行；否则为闸门拒绝原因（`official_title` / `generic_appellation` 等）。
   * ③ 号检测器的「溯源矛盾」只吃这两个原因 —— 它们对应的词表是闸门第 4/5 步
   * 的已验证资产（尊称 / 官职），其余原因（如列举式）与类型判定无关。
   */
  gateRejection  : string | null;
  mentionCount   : number;
  /** 提及所在段落 ID 集（④ 互斥共现用）。 */
  paragraphIds   : readonly string[];
  /** 提及所在回号集（④ 章节分布重叠用）。 */
  chapterOrdinals: readonly number[];
}

/** 关系侧输入（读侧按全库关系逐条装配）。 */
export interface UncertaintyRelationInput {
  id           : string;
  sourceId     : string;
  targetId     : string;
  /** 展示用键：`甲⇄乙[码]`。 */
  pairKey      : string;
  status       : string;
  evidenceCount: number;
}

export interface UncertaintyInput {
  entities : readonly UncertaintyEntityInput[];
  relations: readonly UncertaintyRelationInput[];
}

/* ── 检测器身份登记（版本只增不减） ───────────────────────────── */

/** 检测器身份：每条标记的必填件（修正案 1）。 */
export interface DetectorIdentity {
  readonly id     : string;
  readonly version: number;
}

export const NAME_INCOMPLETE_DETECTOR: DetectorIdentity = { id: "name_incomplete", version: 1 };
export const NAME_AMBIGUOUS_DETECTOR: DetectorIdentity = { id: "name_ambiguous", version: 1 };
export const TYPE_SUSPECT_DETECTOR: DetectorIdentity = { id: "type_suspect", version: 1 };
export const ALIAS_SUSPECT_DETECTOR: DetectorIdentity = { id: "alias_suspect", version: 1 };
export const RELATION_SINGLE_SOURCE_DETECTOR: DetectorIdentity = {
  id     : "relation_single_source",
  version: 1
};

/** ④ 号检测器参数：两个实体各自至少被提及这么多次才进入候选（宁可少标）。 */
export const ALIAS_SUSPECT_MIN_MENTIONS = 5;
/** ④ 号检测器参数：章节分布重叠度 = |∩| / min(|A|, |B|) 的下限。 */
export const ALIAS_SUSPECT_MIN_CHAPTER_OVERLAP = 0.5;

/** 各类别的中文标签（UI 悬浮与审计报告共用，避免两处各写一份）。 */
export const UNCERTAINTY_KIND_LABELS: Record<UncertaintyKind, string> = {
  name_incomplete       : "本名缺失",
  name_ambiguous        : "同人歧义",
  type_suspect          : "类型存疑",
  alias_suspect         : "疑似拆人",
  relation_single_source: "关系单源"
};

/* ── ① 本名缺失：称谓型 canonical 且零别名 ────────────────────── */

export function detectNameIncomplete(
  entities: readonly UncertaintyEntityInput[]
): UncertaintyMark[] {
  const marks: UncertaintyMark[] = [];
  for (const entity of entities) {
    if (entity.honorificForm && entity.aliasCount === 0) {
      marks.push({
        subjectType: "entity",
        subjectId  : entity.id,
        subjectKey : entity.canonical,
        kind       : "name_incomplete",
        detector   : { ...NAME_INCOMPLETE_DETECTOR },
        confidence : "high",
        detail     : `「${entity.canonical}」是称谓形式且无任何别名，本名可能不在原文中`
      });
    }
  }
  return marks;
}

/* ── ② 同人歧义：① 的子集，且同姓存在「像本名」的实体 ─────────── */

export function detectNameAmbiguous(
  entities: readonly UncertaintyEntityInput[]
): UncertaintyMark[] {
  const properNamesBySurname = new Map<string, string[]>();
  for (const entity of entities) {
    if (!entity.properNameForm) continue;
    const surname = entity.canonical.slice(0, 1);
    const list = properNamesBySurname.get(surname) ?? [];
    list.push(entity.canonical);
    properNamesBySurname.set(surname, list);
  }

  const marks: UncertaintyMark[] = [];
  for (const entity of entities) {
    if (!entity.honorificForm || entity.aliasCount > 0) continue;
    const candidates = properNamesBySurname.get(entity.canonical.slice(0, 1)) ?? [];
    if (candidates.length === 0) continue;
    marks.push({
      subjectType: "entity",
      subjectId  : entity.id,
      subjectKey : entity.canonical,
      kind       : "name_ambiguous",
      detector   : { ...NAME_AMBIGUOUS_DETECTOR },
      confidence : "medium",
      detail     : `同姓存在本名形态实体（${candidates.slice(0, 3).join("、")}），需判定同人/异人`
    });
  }
  return marks;
}

/* ── ③ 类型存疑（溯源矛盾形态，修正案 4） ─────────────────────── */

/**
 * 正确形态是**溯源矛盾**而非词形矛盾：canonical 命中闸门第 4/5 步的
 * 尊称/官职词表（`generic_appellation` / `official_title`），却被投票成 PERSON。
 * `PLACE_SUFFIX` 词形方案已被证伪（「江/山/亭」是人名常用字），不得回退。
 */
export function detectTypeSuspect(
  entities: readonly UncertaintyEntityInput[]
): UncertaintyMark[] {
  const marks: UncertaintyMark[] = [];
  for (const entity of entities) {
    if (entity.type !== "PERSON") continue;
    if (entity.gateRejection !== "official_title" && entity.gateRejection !== "generic_appellation") {
      continue;
    }
    marks.push({
      subjectType: "entity",
      subjectId  : entity.id,
      subjectKey : entity.canonical,
      kind       : "type_suspect",
      detector   : { ...TYPE_SUSPECT_DETECTOR },
      confidence : "medium",
      detail     : `规范名命中闸门词表（${entity.gateRejection}）却以 PERSON 落库，类型存疑`
    });
  }
  return marks;
}

/* ── ④ 疑似拆人（互斥共现形态，修正案 4） ─────────────────────── */

/**
 * 信号方向（修正案 4）：同段落共现的两人**恰恰大多是不同的人**（实测 3/4 为亲属），
 * 「同一人被拆」的正确内部信号是其反面 —— **互斥共现**：
 * 同姓、从不共段、章节分布高度重叠，且两人之间没有关系边（有边 = 管线已认定二人互动）。
 */
export function detectAliasSuspect(
  entities: readonly UncertaintyEntityInput[],
  relations: readonly UncertaintyRelationInput[]
): UncertaintyMark[] {
  const linked = new Set<string>();
  for (const relation of relations) {
    linked.add(`${relation.sourceId}|${relation.targetId}`);
    linked.add(`${relation.targetId}|${relation.sourceId}`);
  }

  const candidates = entities.filter(
    (entity) => entity.type === "PERSON" && entity.mentionCount >= ALIAS_SUSPECT_MIN_MENTIONS
  );

  const bySurname = new Map<string, UncertaintyEntityInput[]>();
  for (const entity of candidates) {
    const surname = entity.canonical.slice(0, 1);
    const list = bySurname.get(surname) ?? [];
    list.push(entity);
    bySurname.set(surname, list);
  }

  const marks: UncertaintyMark[] = [];
  for (const group of bySurname.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i];
        const right = group[j];
        if (left === undefined || right === undefined) continue;
        if (linked.has(`${left.id}|${right.id}`)) continue;

        const leftParagraphs = new Set(left.paragraphIds);
        const sharesParagraph = right.paragraphIds.some((id) => leftParagraphs.has(id));
        if (sharesParagraph) continue;

        const leftChapters = new Set(left.chapterOrdinals);
        const rightChapters = new Set(right.chapterOrdinals);
        let overlap = 0;
        for (const chapter of leftChapters) {
          if (rightChapters.has(chapter)) overlap += 1;
        }
        const base = Math.min(leftChapters.size, rightChapters.size);
        if (base === 0) continue;
        const ratio = overlap / base;
        if (ratio < ALIAS_SUSPECT_MIN_CHAPTER_OVERLAP) continue;

        marks.push({
          subjectType: "entity",
          subjectId  : left.id,
          subjectKey : `${left.canonical}⇄${right.canonical}`,
          kind       : "alias_suspect",
          detector   : { ...ALIAS_SUSPECT_DETECTOR },
          // 新检测器、未经抽查校准 —— 按修正案 1 只给 low。
          confidence : "low",
          detail:
            `同姓、全书从不共段、章节分布重叠 ${(ratio * 100).toFixed(0)}%，` +
            `疑似同一人被拆（对端：${right.canonical}）`
        });
      }
    }
  }
  return marks;
}

/* ── ⑤ 关系单源：只有一条原文证据 ─────────────────────────────── */

export function detectRelationSingleSource(
  relations: readonly UncertaintyRelationInput[]
): UncertaintyMark[] {
  const marks: UncertaintyMark[] = [];
  for (const relation of relations) {
    if (relation.evidenceCount !== 1) continue;
    marks.push({
      subjectType: "relationship",
      subjectId  : relation.id,
      subjectKey : relation.pairKey,
      kind       : "relation_single_source",
      detector   : { ...RELATION_SINGLE_SOURCE_DETECTOR },
      confidence : "high",
      detail     : `仅 1 条原文证据（${relation.status}），无法交叉自证`
    });
  }
  return marks;
}

/* ── 汇总：覆盖率（表态率） ───────────────────────────────────── */

export function computeUncertainty(input: UncertaintyInput): UncertaintyReport {
  const marks: UncertaintyMark[] = [
    ...detectNameIncomplete(input.entities),
    ...detectNameAmbiguous(input.entities),
    ...detectTypeSuspect(input.entities),
    ...detectAliasSuspect(input.entities, input.relations),
    ...detectRelationSingleSource(input.relations)
  ];

  const markedEntities = new Set(
    marks.filter((m) => m.subjectType === "entity").map((m) => m.subjectId)
  );
  const markedRelations = new Set(
    marks.filter((m) => m.subjectType === "relationship").map((m) => m.subjectId)
  );

  const kinds: UncertaintyKind[] = [
    "name_incomplete",
    "name_ambiguous",
    "type_suspect",
    "alias_suspect",
    "relation_single_source"
  ];
  const byKind = kinds.map((kind) => ({
    kind,
    count: marks.filter((m) => m.kind === kind).length
  }));

  const coverage: UncertaintyCoverage = {
    entityTotal   : input.entities.length,
    entityMarked  : markedEntities.size,
    relationTotal : input.relations.length,
    relationMarked: markedRelations.size,
    byKind
  };

  return { marks, coverage };
}

/* ── 自知准确率口径：确定性抽查样本 ───────────────────────────── */

/**
 * 从标记中抽**确定性**样本供人工核对（自知准确率的取样器）。
 *
 * 为什么带 seed：抽查结果要可复核 —— 同一批标记 + 同一 seed 必须给出同一份样本，
 * 否则「上次抽查的 30 个」无法复盘。标记先按 (subjectId, kind) 排序消掉输入顺序依赖，
 * 再用 mulberry32 做稳定洗牌。
 */
export function sampleMarksForAudit(
  marks: readonly UncertaintyMark[],
  count: number,
  seed: number
): UncertaintyMark[] {
  const sorted = [...marks].sort((a, b) => {
    if (a.subjectId !== b.subjectId) return a.subjectId < b.subjectId ? -1 : 1;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });

  let state = seed >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = sorted.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = sorted[i];
    const b = sorted[j];
    if (a !== undefined && b !== undefined) {
      sorted[i] = b;
      sorted[j] = a;
    }
  }
  return sorted.slice(0, Math.max(0, count));
}
