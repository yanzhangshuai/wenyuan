import { buildRelationIdentity } from "@/lib/relations";

/**
 * P6 关系聚合：把分片级的「一次性观测」压缩成带有效期的关系记录（零 LLM 成本）。
 *
 * 设计原因（对应 v1 缺陷：关系无生命周期）：
 * v1 把每次观测都当作独立关系写入，导致：
 * 1. 同一对人物出现大量重复边；
 * 2. 随时间变化的关系（如「同僚 → 仇敌」「夫妻 → 离婚」）无法表达。
 *
 * v3 用「章节区间」表达生命周期：
 * - 首次观测 → INSERT，`startChapter` 记为观测章节，`endChapter` 为 null（仍有效）；
 * - 后续观测 → EXTEND，仅推进 `endChapter`；
 * - 类型切换 → 旧记录 CLOSE（`endChapter` 落在切换前），新类型 INSERT。
 *
 * 关键约束：聚合结果与输入顺序无关 —— 输入先按章节排序，
 * 保证「先发生的事先处理」，使同一批数据无论从哪个分片开始处理都得到相同结果。
 */

/** 一条分片级关系观测。 */
export interface RelationObservation {
  typeCode       : string;
  sourceKey      : string;
  targetKey      : string;
  /** 观测所在章节序号（从 1 开始）。 */
  chapterOrdinal : number;
  /** 展示用的原始名字。 */
  sourceCanonical: string;
  targetCanonical: string;
}

/** 聚合后的关系记录。 */
export interface AggregatedRelation {
  typeCode       : string;
  sourceKey      : string;
  targetKey      : string;
  sourceCanonical: string;
  targetCanonical: string;
  /**
   * 关系身份键，与 P4 `VotedRelation.identity` 同源（均出自 `buildRelationIdentity`）。
   * 编排层据此把聚合出的生命周期字段回填到待落库的关系上。
   */
  identity       : string;
  /** 首次观测章节。 */
  startChapter   : number;
  /** 末次观测章节；null 表示到全书结束仍成立。 */
  endChapter     : number | null;
  /** 观测次数。 */
  observations   : number;
  status         : "ACTIVE" | "ENDED";
}

/** 聚合参数。 */
export interface AggregateOptions {
  /**
   * 同一 (source, target) 对是否允许同时存在多种关系类型。
   *
   * 默认 true —— 现实中「既是同僚又是朋友」很常见。
   * 置为 false 时仅保留观测次数最多的类型，用于「一对人物只画一条边」的简化视图。
   */
  allowMultipleTypes?: boolean;
}

/** 关系对的身份键（不含类型，用于判断类型是否发生切换）。 */
function buildPairKey(sourceKey: string, targetKey: string, symmetric: boolean): string {
  if (!symmetric) {
    return `${sourceKey}\u0000${targetKey}`;
  }
  const [first, second] =
    sourceKey <= targetKey ? [sourceKey, targetKey] : [targetKey, sourceKey];
  return `${first}\u0000${second}`;
}

/**
 * 折叠键（**缺陷 N21 的修复点**）—— 把一条聚合关系映射到「落库口径」的分组键。
 *
 * ## 为什么需要它
 *
 * 本函数上游的 `aggregateRelations` 按 `buildRelationIdentity(sourceKey, targetKey,
 * typeCode, symmetric)` 分组 —— 对**对称码**它把两端**排序**（无序对）。
 * 而落库唯一索引 `relationships_triple_uq` 建在 **(workId, sourceEntityId,
 * targetEntityId, relationTypeCode)** 上，是**有向**的。
 *
 * 两个口径在「两个不同的键归并成同一个实体」时不重合（这正是 N16 的成因）。
 * N16 只修了**非对称**那一半；**对称**那一半被漏掉了：
 * 两条**键不同、实体对相同、方向相反**的对称关系（如 `朋友 甲→乙` 与
 * `朋友 甲某→乙某` 反向）在 P6 看来是两条、在语义上是**同一条边**，
 * 于是被落库成两行，**绕过**了 P4/P6 的对称去重。实测 8 组（儒林 3 / 红楼 5）。
 *
 * ## 口径
 *
 * · 两端解析不到实体 → 退回归一化键身份键（落库时整条跳过，折叠它没有意义）；
 * · **非对称码** → 保留方向（`父子 A→B` 与 `父子 B→A` 是两条不同的关系）；
 * · **对称码** → 两端下标**排序**，与 `buildRelationIdentity` 的键级排序**同口径**。
 *
 * ⚠️ 这是 `buildRelationIdentity` 的**实体下标版**。两处必须始终一致 ——
 * 「同一个概念在两个地方各写一遍、然后走样」正是 N21 的成因本身。
 */
function buildCollapseKey(
  sourceIndex: number | undefined,
  targetIndex: number | undefined,
  typeCode: string,
  identity: string,
  symmetric: boolean
): string {
  if (sourceIndex === undefined || targetIndex === undefined) {
    return `key\u0000${identity}`;
  }
  if (!symmetric) {
    return `${String(sourceIndex)}\u0000${String(targetIndex)}\u0000${typeCode}`;
  }
  const [first, second] =
    sourceIndex <= targetIndex ? [sourceIndex, targetIndex] : [targetIndex, sourceIndex];
  return `${String(first)}\u0000${String(second)}\u0000${typeCode}`;
}

/**
 * 聚合结果的稳定排序：起始章节 → 类型码 → 源键。
 *
 * 抽出来是因为**两处**都要用：`aggregateRelations` 的输出，
 * 以及 `collapseByEntityTriple` 折叠之后的输出（折叠会把 `startChapter` 提前，
 * 于是原有的顺序不再成立）。共用一个比较器，两处的确定性保证才是同一个。
 */
function compareAggregated(left: AggregatedRelation, right: AggregatedRelation): number {
  if (left.startChapter !== right.startChapter) {
    return left.startChapter - right.startChapter;
  }
  if (left.typeCode !== right.typeCode) {
    return left.typeCode.localeCompare(right.typeCode);
  }
  return left.sourceKey.localeCompare(right.sourceKey);
}

/**
 * 聚合关系观测为带有效期的记录。
 *
 * @param observations 分片级观测（顺序无关，内部会排序）
 * @param symmetricRelations 对称关系码集合
 * @param options 聚合参数
 * @returns 按 (起始章节, 类型码) 升序排列的关系记录
 */
export function aggregateRelations(
  observations: readonly RelationObservation[],
  symmetricRelations: ReadonlySet<string>,
  options: AggregateOptions = {}
): AggregatedRelation[] {
  const allowMultipleTypes = options.allowMultipleTypes ?? true;

  // 先排序：按章节升序，同章内按类型码与两端键排序，消除输入顺序影响。
  const ordered = [...observations].sort((left, right) => {
    if (left.chapterOrdinal !== right.chapterOrdinal) {
      return left.chapterOrdinal - right.chapterOrdinal;
    }
    if (left.typeCode !== right.typeCode) {
      return left.typeCode.localeCompare(right.typeCode);
    }
    const leftPair = `${left.sourceKey}\u0000${left.targetKey}`;
    const rightPair = `${right.sourceKey}\u0000${right.targetKey}`;
    return leftPair.localeCompare(rightPair);
  });

  /** 身份键（对 + 类型）→ 聚合记录。 */
  const byIdentity = new Map<string, AggregatedRelation>();
  /** 关系对键 → 当前生效记录的身份键（用于类型切换判定）。 */
  const activeByPair = new Map<string, string[]>();

  for (const observation of ordered) {
    const symmetric = symmetricRelations.has(observation.typeCode);
    const pairKey = buildPairKey(observation.sourceKey, observation.targetKey, symmetric);
    const identity = buildRelationIdentity(
      observation.sourceKey,
      observation.targetKey,
      observation.typeCode,
      symmetric
    );

    const existing = byIdentity.get(identity);
    if (existing !== undefined) {
      // 同类型再次观测：延长有效期（EXTEND）。
      existing.endChapter = observation.chapterOrdinal;
      existing.observations += 1;
      continue;
    }

    if (!allowMultipleTypes) {
      // 简化视图：该对已有其他类型时，比较观测次数决定是否替换。
      const activeIdentities = activeByPair.get(pairKey) ?? [];
      const competitor = activeIdentities
        .map((key) => byIdentity.get(key))
        .filter((item): item is AggregatedRelation => item !== undefined)
        .sort((left, right) => right.observations - left.observations)[0];

      if (competitor !== undefined && competitor.observations >= 1) {
        continue;
      }
    } else {
      // 多类型视图：同对出现新类型时，旧类型在切换章节前结束（CLOSE）。
      const activeIdentities = activeByPair.get(pairKey) ?? [];
      for (const activeIdentity of activeIdentities) {
        const active = byIdentity.get(activeIdentity);
        if (active === undefined || active.status === "ENDED") {
          continue;
        }
        active.status = "ENDED";
        active.endChapter = Math.max(active.startChapter, observation.chapterOrdinal - 1);
      }
    }

    byIdentity.set(identity, {
      typeCode       : observation.typeCode,
      sourceKey      : observation.sourceKey,
      targetKey      : observation.targetKey,
      sourceCanonical: observation.sourceCanonical,
      targetCanonical: observation.targetCanonical,
      identity,
      startChapter   : observation.chapterOrdinal,
      endChapter     : null,
      observations   : 1,
      status         : "ACTIVE"
    });

    const activeIdentities = activeByPair.get(pairKey) ?? [];
    activeIdentities.push(identity);
    activeByPair.set(pairKey, activeIdentities);
  }

  return [...byIdentity.values()].sort(compareAggregated);
}

/**
 * 待落库关系：聚合结果 + 被折叠进来的全部键级身份键。
 */
export interface CollapsedRelation extends AggregatedRelation {
  /**
   * 被折叠到本记录的全部**键级身份键**（含自身，按折叠顺序）。
   *
   * 为什么必须带出来：P4 的证据引用按键级身份键索引（`run.ts` 的 `quotesByIdentity`）。
   * 折叠之后一个实体三元组可能对应多个键级身份键，若只留一个，
   * 被折叠那条的证据引用就**静默丢失**了。
   * 未发生折叠时长度为 1 —— 此时下游行为与改动前**逐字节相同**。
   */
  mergedIdentities: readonly string[];
}

/** 折叠结果。 */
export interface CollapseOutcome {
  relations       : CollapsedRelation[];
  /** 实际被折叠掉（两条并一条）的记录数；0 表示本作品没有这个问题。 */
  collapsedCount  : number;
  /**
   * 被剔除的**自环**条数（缺陷 N22）；0 表示本作品没有这个问题。
   *
   * ⚠️ **必须与 `collapsedCount` 分开计**。自环是**被丢掉**（1 → 0），不是被折进去
   * （2 → 1）；若把它并进 `collapsedCount`，`run.ts` 那条可验伪等式
   * `aggregated − collapsedCount − droppedSelfLoops === relations`
   * **照样成立**（丢 1 条时两个计数一增一减相抵）→ 「自环被剔了几条」在留档里**不可见**。
   * 这正是本仓库反复出现的「数字看起来有、其实没测到」。
   */
  droppedSelfLoops: number;
}

/**
 * 按**实体三元组**折叠聚合结果 —— 修复「聚合口径 ≠ 落库口径」导致的静默丢边（缺陷 N16）。
 *
 * ## 问题
 *
 * 本函数上一步的 `aggregateRelations` 按 **归一化键三元组**
 * （`buildRelationIdentity(sourceKey, targetKey, typeCode, symmetric)`）分组；
 * 而 `persist-graph.ts` 写库时，唯一索引 `relationships_triple_uq` 建在
 * **(workId, sourceEntityId, targetEntityId, relationTypeCode)** 上，用的是**实体 id**。
 *
 * 两个口径在「两个不同的键归并成同一个实体」时不重合：
 * 此时两条关系在 P6 看来是两条，在数据库看来是**同一条**，
 * 第二条被 `.onConflictDoNothing()` **静默吞掉** —— 而且**不写任何 issue**，
 * 所以在审计与金标里**完全不可见**。
 *
 * 实测（2026-10-10）：`aggregate_summary.relations` 与落库关系数
 * 《儒林外史》373 vs 361（丢 12 条，3.2%）、《红楼梦》659 vs 599（丢 60 条，9.1%）。
 *
 * ## 修法
 *
 * 把去重**提前到 P6**，并且用与落库**同一个键**（实体三元组）。
 * 折叠时生命周期取并集 —— 这是唯一诚实的选择：两条观测本来就是
 * 「同一对人物、同一种关系」的两种写法，分开看是重复，合起来才是全貌。
 *
 * ⚠️ **本改动不改变图谱的边集合**：改动前「先插入的那条胜出」，
 * 改动后「合并后的那条胜出」，两者的 (源, 目标, 类型) 三元组**完全相同**
 * —— 行数也一样。变的只有两处：
 * ① `aggregate_summary` 的**报数方式**：修好后 P6 的输出就是最终集合，
 *    因此只报 `relations` 再与落库数比较会**恒真**。`run.ts` 因此改报四个数
 *    （`aggregated` / `collapsedByEntityTriple` / `relations` / `persistedRelations`），
 *    让不变量 `aggregated − collapsedByEntityTriple === relations === persistedRelations`
 *    **可以被验伪**；
 * ② 被折叠那 12 / 60 条的 `startChapter` / `endChapter` / `status` 从
 *    「第一条说了算」变成「两条的并集」。
 *    ⚠️ 这一条**会影响评测**：`startChapter` 取 `min`，于是原本因
 *    「首次观察晚于区间末回」而被排除的边，现在可能**进入区间** ——
 *    金标关系指标因此可能与改动前不可直接比较。
 *
 * ## 批次 30 更新：N21 / N22（**本函数的两条补丁**）
 *
 * ⚠️ 上面「本改动不改变图谱的边集合」**只对 N16 成立**。批次 30 的两条补丁
 * **会改变边集合**（各去掉几行），因此这段注释必须分开读：
 *
 * · **N21 —— 折叠键漏了对称码**。上面的修法用**有向**实体三元组作去重键，
 *   而上游 `aggregateRelations` 对**对称码**是按**无序对**分组的 →
 *   两个口径在对称码上不一致，「同码反向」的两行不被折叠、落库成两行，
 *   绕过 P4/P6 的对称去重。实测 8 组（儒林 3 / 红楼 5）。
 *   → 修法：折叠键改走 `buildCollapseKey`，对称码把两端下标排序。
 *   ⚠️ **只对 SYMMETRIC 码生效**；INVERSE 码（父子/母子/师生/主仆）保留方向，
 *   行为**逐字节不变**（缺陷 N8 已于批次 29 结案「不做」，本批**不得**顺手动它）。
 *
 * · **N22 —— 归并后的自环无人复查**。P4 `vote.ts` 只在**归一化键**上判自环
 *   （`sourceKey === targetKey`），而 P5 归并可把**两个不同的键**映射到
 *   **同一个实体下标** → 本函数产出 `(i, i, 码)` 这种非法行，此前**无人复查**。
 *   实测 6 条（儒林 1 / 红楼 5）。→ 修法：在**实体下标**上重判一次，命中即剔除，
 *   计入 `droppedSelfLoops`。
 *
 * 两条补丁的实例**全部落在 ch ≥ 6**，而当时三条金标的最大上界是 **3**
 * → 对当时的 F1 影响 **0**；它们是**扩区间 / 扩金标**的阻塞项。
 *
 * @param relations 聚合结果（`aggregateRelations` 的输出）
 * @param keyToEntityIndex 归一化键 → 实体下标（P5 的输出）
 * @param symmetricRelations 对称关系码集合（**必填**：与 `aggregateRelations` 同一个口径。
 *   漏传会让对称码退回有向口径 = N21 复发，因此刻意**不给默认值**）
 * @returns 折叠后的关系（按起始章节排序）、被折叠的记录数、被剔除的自环条数
 */
export function collapseByEntityTriple(
  relations: readonly AggregatedRelation[],
  keyToEntityIndex: ReadonlyMap<string, number>,
  symmetricRelations: ReadonlySet<string>
): CollapseOutcome {
  /** 折叠中的草稿：关系本体 + 已被折进来的身份键。 */
  interface Draft {
    relation  : AggregatedRelation;
    identities: string[];
  }

  const byTriple = new Map<string, Draft>();
  let collapsedCount = 0;
  let droppedSelfLoops = 0;

  for (const relation of relations) {
    const sourceIndex = keyToEntityIndex.get(relation.sourceKey);
    const targetIndex = keyToEntityIndex.get(relation.targetKey);

    // 自环剔除（缺陷 N22）—— 必须在**实体下标**上判，不能在归一化键上判。
    // P4 已经丢过键级自环（`vote.ts`：`sourceKey === targetKey`），但 P5 归并
    // 可以把两个**不同的键**映射到**同一个实体** → 到这里才第一次看得出来。
    // ⚠️ 单独计数：自环是「丢掉」（1 → 0）而不是「折进去」（2 → 1），
    // 混进 `collapsedCount` 会让 run.ts 的可验伪等式失衡（见 `CollapseOutcome`）。
    if (sourceIndex !== undefined && targetIndex !== undefined && sourceIndex === targetIndex) {
      droppedSelfLoops += 1;
      continue;
    }

    // 两端解析不到实体时**不折叠**：这条关系在落库时会被整条跳过
    // （`persist-graph.ts` 找不到 id 就 continue），折叠它没有意义。
    // 用键级身份键作去重键，保证这种情况下的行为与改动前一致。
    const triple = buildCollapseKey(
      sourceIndex,
      targetIndex,
      relation.typeCode,
      relation.identity,
      symmetricRelations.has(relation.typeCode)
    );

    const existing = byTriple.get(triple);
    if (existing === undefined) {
      byTriple.set(triple, { relation: { ...relation }, identities: [relation.identity] });
      continue;
    }

    collapsedCount += 1;
    const merged = existing.relation;
    merged.startChapter = Math.min(merged.startChapter, relation.startChapter);
    merged.observations += relation.observations;
    // 只要有一条仍「未结束」（endChapter = null），合并结果就仍未结束 ——
    // 否则会把「还在延续」的关系错误地标成已终止（这是本函数唯一容易写错的地方）。
    if (merged.endChapter === null || relation.endChapter === null) {
      merged.endChapter = null;
      merged.status = "ACTIVE";
    } else {
      merged.endChapter = Math.max(merged.endChapter, relation.endChapter);
    }
    existing.identities.push(relation.identity);
  }

  const collapsed: CollapsedRelation[] = [...byTriple.values()].map((draft) => ({
    ...draft.relation,
    mergedIdentities: draft.identities
  }));

  // 折叠会把 startChapter 提前，原有顺序不再成立 → 重新按同一个比较器排序。
  return { relations: collapsed.sort(compareAggregated), collapsedCount, droppedSelfLoops };
}
