import "server-only";

import { eq } from "drizzle-orm";

import { normalizeName } from "@/lib/text";
import { getDatabase } from "@/server/db/client";
import {
  chapters,
  entities as entitiesTable,
  entityAliases,
  entityMentions,
  evidenceSpans,
  paragraphs,
  relationships,
  works
} from "@/server/db/schema";

import type { MergedEntity } from "./merge";

/**
 * 图谱落库（P5/P6 的持久化）。
 *
 * 设计原因（对应 v1 缺陷「归并后引用丢失」）：
 * - v1 归并后靠 `name` 字符串精确匹配回填 mentions，只要写法有差异就会丢引用；
 * - v3 的 mentions 通过**归一化键 → 实体 ID** 映射写入，名字不再参与匹配；
 * - 同一次解析的图谱数据整体替换（先删后建），避免多次运行叠加出脏数据。
 *
 * ── 提及的作用域（缺陷 N1，2026-10-10 修）──
 * 提及必须限制在**该实体被观测到的章节**内。此前的做法是「按归一化成员键
 * 去全库段落索引里取」，而索引是**子串匹配**（见 `buildMentionIndex`），
 * 于是泛称别名会把别回的提及搬进本回。实测两例：
 *   · `王公` —— 全书 10 次、**第一回 0 次**，但别名含 `老父台`，
 *     而 `老父台` 是第一回 段 9 里危素对时知县的敬称 → `王公` 在第一回被记了一次提及；
 *   · `严大位` —— 全书 3 次、**第一回 0 次**，别名含 `老大`，
 *     而第一回 段 12 有 `王老大` → 同样被搬进第一回。
 * 结果是第一回切片里凭空多出两个不属于第一回的人物。
 *
 * ⚠️ 这只修了三个因子里的**一个**：① 泛称被写成别名（P1 的 LLM 产出）、
 * ② 子串 `includes` 匹配（设计使然）、③ 全库索引而非观测章节（**这才是 bug**）。
 * 因此验收口径是「**显著下降**」，**不是 0** —— 真别名驱动的提及
 * （`老太太`→贾母、`琏二`→贾琏）是**正确数据**，不该被消掉。
 *
 * 事务边界：整个落库过程在单个事务内完成 —— 中途失败必须整体回滚，
 * 否则会留下「有实体无关系」的半成品图谱。
 */

/**
 * 待落库的关系。
 *
 * 结构上兼容 P4 的 `VotedRelation`，但额外要求 P6 聚合出的生命周期字段 ——
 * 这样「关系有效期」才会真正落到 `relationships.start_chapter` / `end_chapter`，
 * 而不是算完即弃。
 */
export interface PersistableRelation {
  typeCode    : string;
  sourceKey   : string;
  targetKey   : string;
  /** 支撑证据引用。 */
  quotes      : readonly string[];
  /** 首次观测章节（来自 P6）。 */
  startChapter: number;
  /** 末次观测章节；null 表示到全书结束仍成立（来自 P6）。 */
  endChapter  : number | null;
  /** 生命周期状态（来自 P6）。 */
  status      : "ACTIVE" | "ENDED";
}

/** 落库输入。 */
export interface PersistGraphInput {
  workId          : string;
  runId           : string;
  entities        : readonly MergedEntity[];
  relations       : readonly PersistableRelation[];
  /** 归一化键 → 实体下标（来自 P5），用于 mentions 回填。 */
  keyToEntityIndex: ReadonlyMap<string, number>;
}

/** 落库结果。 */
export interface PersistGraphSummary {
  entityCount        : number;
  aliasCount         : number;
  relationCount      : number;
  mentionCount       : number;
  /**
   * 因「落在该实体的观测章节之外」而被丢弃的提及命中数（缺陷 N1 的验收口径）。
   *
   * 为 0 有两种含义，必须靠上下文区分：① 本作品确实没有跨回搬运；
   * ② 调用方没提供观测章节（`observedChapters` 为空 → 不施加限制）。
   * 生产路径下 ① 才是常态 —— 因此这个数**变小**是回归信号，不是好事。
   */
  mentionScopeDropped: number;
  /** 逐实体的丢弃明细；只含丢弃数 > 0 者，按丢弃数降序。 */
  mentionScopeDrops  : { canonical: string; dropped: number }[];
}

/**
 * 提及回填的一条命中：段落 ID + 该段落所属的**章节序号**。
 *
 * 为什么必须带上章节序号：提及要限制在实体的观测章节内（N1），
 * 而「这个段落属于哪一回」只有建索引时（已经 join 了 `chapters`）知道。
 * 若不带，`persistGraph` 就只能按段落 ID 反查章节 —— 多一次查询，且丢了顺序。
 */
export interface MentionHit {
  paragraphId   : string;
  chapterOrdinal: number;
}

/** 提及回填输入：归一化键 → 其出现的段落列表。 */
export type MentionIndex = ReadonlyMap<string, readonly MentionHit[]>;

/**
 * 把图谱写入数据库。
 *
 * @param input 归并实体、投票关系与键映射
 * @param mentionIndex 归一化键 → 出现过的段落 ID 列表
 * @returns 落库统计
 */
export async function persistGraph(
  input: PersistGraphInput,
  mentionIndex: MentionIndex
): Promise<PersistGraphSummary> {
  const db = getDatabase();
  let aliasCount = 0;
  let mentionCount = 0;
  let relationCount = 0;
  let mentionScopeDropped = 0;
  const mentionScopeDrops: { canonical: string; dropped: number }[] = [];

  await db.transaction(async (tx) => {
    // 整体替换：删除旧图谱（关系与提及随外键级联删除）。
    await tx.delete(entitiesTable).where(eq(entitiesTable.workId, input.workId));

    /** 实体下标 → 数据库 ID。 */
    const indexToEntityId = new Map<number, string>();

    for (const [index, entity] of input.entities.entries()) {
      const [inserted] = await tx
        .insert(entitiesTable)
        .values({
          workId        : input.workId,
          canonical     : entity.canonical,
          normalizedName: normalizeName(entity.canonical),
          type          : entity.type,
          // 必须用归并结果里的名字类型，不能硬编码 —— 此前写死 "NAMED"，
          // 导致「全篇只有称谓没有本名」的人物（如胡屠户）与
          // P1 提示词里明确要求输出的 TITLE_ONLY 判定被静默丢弃。
          nameType      : entity.nameType,
          factionIndex  : null
        })
        .returning({ id: entitiesTable.id });

      if (inserted === undefined) {
        throw new Error(`实体写入失败：${entity.canonical}`);
      }
      indexToEntityId.set(index, inserted.id);

      // 别名：同一作品的归一化别名唯一，重复即跳过（不视为错误）。
      for (const alias of entity.aliases) {
        const normalizedAlias = normalizeName(alias);
        if (normalizedAlias.length === 0 || normalizedAlias === normalizeName(entity.canonical)) {
          continue;
        }
        await tx
          .insert(entityAliases)
          .values({
            workId  : input.workId,
            entityId: inserted.id,
            alias,
            normalizedAlias
          })
          .onConflictDoNothing();
        aliasCount += 1;
      }

      // 提及：按归一化键取段落列表 —— 名字只作为**查找键**，不参与匹配写入。
      //
      // ⚠️ 必须把提及限制在该实体的**观测章节**内（缺陷 N1）。
      // 索引是**子串匹配**（见 `buildMentionIndex`），所以只要泛称别名落在别回，
      // 就会把别回的提及搬进本回 —— 详见文件头「提及的作用域」。
      //
      // 空数组 = 调用方未提供观测章节 → **不施加限制**（见 `MergedEntity`）。
      // 这条分支是为了让不构造章节信息的旧调用点（大量单测）行为不变；
      // 生产路径（`run.ts`）始终提供，因此不会走到这里。
      const observedChapters = new Set(entity.observedChapters);
      const restricted = observedChapters.size > 0;

      // ⚠️ **必须去重**：`memberKeys` 本来就含规范名键（见 `merge.ts` 的 `keys`），
      // 而下面按 `memberKeys` **逐键累加** `droppedHits` —— 不去重就会把规范名的
      // 每一次**越界**命中数两遍，使 `mention_scope_filtered.dropped` 虚高
      // （规范名主导时接近 2×，批次 11 的 1664 / 5172 就是虚高值）。
      // 本行曾在批 10 修好，**随 N19 回滚一起被撤销**，故在此重做。
      // 去重对**落库结果无影响**（`paragraphIds` 是 Set，重复键只是重复写同一个 id），
      // 它只纠正这个计数口径 —— 因此本改动**零成本、不需要重跑**。
      const memberKeys = [...new Set([normalizeName(entity.canonical), ...entity.memberKeys])];
      const paragraphIds = new Set<string>();
      let droppedHits = 0;
      for (const key of memberKeys) {
        for (const hit of mentionIndex.get(key) ?? []) {
          if (restricted && !observedChapters.has(hit.chapterOrdinal)) {
            droppedHits += 1;
            continue;
          }
          paragraphIds.add(hit.paragraphId);
        }
      }

      if (droppedHits > 0) {
        mentionScopeDropped += droppedHits;
        mentionScopeDrops.push({ canonical: entity.canonical, dropped: droppedHits });
      }

      const mentionRows = [...paragraphIds].map((paragraphId) => ({
        paragraphId,
        entityId         : inserted.id,
        surface          : entity.canonical,
        normalizedSurface: normalizeName(entity.canonical),
        startOffset      : 0,
        endOffset        : 0
      }));

      if (mentionRows.length > 0) {
        await tx.insert(entityMentions).values(mentionRows);
        mentionCount += mentionRows.length;
      }
    }

    // 关系：需要把归一化键解析为实体 ID。
    for (const relation of input.relations) {
      const sourceIndex = input.keyToEntityIndex.get(relation.sourceKey);
      const targetIndex = input.keyToEntityIndex.get(relation.targetKey);
      if (sourceIndex === undefined || targetIndex === undefined) {
        continue;
      }
      const sourceId = indexToEntityId.get(sourceIndex);
      const targetId = indexToEntityId.get(targetIndex);
      if (sourceId === undefined || targetId === undefined) {
        continue;
      }

      const [insertedRelation] = await tx
        .insert(relationships)
        .values({
          workId          : input.workId,
          sourceEntityId  : sourceId,
          targetEntityId  : targetId,
          relationTypeCode: relation.typeCode,
          startChapter    : relation.startChapter,
          endChapter      : relation.endChapter,
          status          : relation.status
        })
        .onConflictDoNothing()
        .returning({ id: relationships.id });

      if (insertedRelation === undefined) {
        continue;
      }
      relationCount += 1;

      // 证据：把引用文本挂到首个可定位的段落上。
      //
      // ⚠️ 这里的坐标是**造假**的（缺陷 N7：取源实体的首个提及段落、`offset` 恒为 0），
      // `quote` 与所挂段落往往毫无关系。**本批次刻意不动它** ——
      // 批次 9 只收「修 bug」性质的改动，好让 F1 的变化可独立归因；
      // N7 需要重新设计证据溯源（把证据挂到关系被观测到的那一段），属另一批。
      // 此处只把 `MentionHit` 拆回 `paragraphId`，**行为与改动前逐字节相同**。
      for (const quote of relation.quotes) {
        const paragraphId = mentionIndex.get(relation.sourceKey)?.[0]?.paragraphId;
        if (paragraphId === undefined) {
          continue;
        }
        await tx.insert(evidenceSpans).values({
          relationshipId: insertedRelation.id,
          paragraphId,
          startOffset   : 0,
          endOffset     : quote.length,
          quote
        });
      }
    }

    await tx.update(works).set({ updatedAt: new Date() }).where(eq(works.id, input.workId));
  });

  return {
    entityCount      : input.entities.length,
    aliasCount,
    relationCount,
    mentionCount,
    mentionScopeDropped,
    // 降序：谁被搬得最厉害排最前，读的人不必自己排序。
    mentionScopeDrops: mentionScopeDrops.sort((left, right) => right.dropped - left.dropped)
  };
}

/**
 * 构建提及索引：遍历全部段落，找出每个归一化键在哪些段落中出现。
 *
 * @param workId 作品 ID
 * @param keys 需要检索的归一化键集合
 * @returns 归一化键 → 段落命中列表（每项带该段落所属的章节序号）
 *
 * 设计说明：这里做的是**子串包含**判定（与 P2 grounding 同口径），
 * 而不是精确相等 —— 因为实体可能以别名或部分写法出现在段落中。
 *
 * ⚠️ 这个索引**故意**覆盖全书段落，不做章节过滤：过滤发生在 `persistGraph`，
 * 因为「允许落在哪些章节」是**每个实体各自**的（它的观测章节），
 * 不是索引本身的属性。若在这里过滤，就得为每个实体重建一次索引。
 *
 * 附带章节序号是必需的（缺陷 N1）：过滤判据是 `hit.chapterOrdinal ∈ 观测章节`，
 * 而「这个段落属于哪一回」只有这里（已 join `chapters`）知道。
 */
export async function buildMentionIndex(
  workId: string,
  keys: readonly string[]
): Promise<MentionIndex> {
  const db = getDatabase();
  const rows = await db
    .select({ id: paragraphs.id, text: paragraphs.text, chapterOrdinal: chapters.ordinal })
    .from(paragraphs)
    .innerJoin(chapters, eq(paragraphs.chapterId, chapters.id))
    .where(eq(chapters.workId, workId));

  const index = new Map<string, MentionHit[]>();
  for (const row of rows) {
    const normalizedText = normalizeName(row.text);
    for (const key of keys) {
      if (key.length === 0) {
        continue;
      }
      if (normalizedText.includes(key)) {
        const bucket = index.get(key) ?? [];
        bucket.push({ paragraphId: row.id, chapterOrdinal: row.chapterOrdinal });
        index.set(key, bucket);
      }
    }
  }

  return index;
}
