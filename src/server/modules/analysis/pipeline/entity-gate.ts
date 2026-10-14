import { normalizeName } from "@/lib/text";

import { DEFAULT_GENRE_PACK, type GenrePack } from "../genre-pack";
import type { EntityType, ExtractedEntity, ExtractedRelation, SliceExtraction } from "../schemas";

import { rejectCandidateReason, type CandidateRejectionReason } from "./dictionary";
import { isNameGrounded, type GroundingIndex } from "./grounding";

/**
 * P1 输出侧的**实体准入闸门**（纯规则，零 LLM 成本）。
 *
 * 存在理由（一次实测审计暴露的责任错配）：
 * - P0 候选名单**只用于构造提示词的锚点**（`buildExtractionUserPrompt`），
 *   从不参与 P1 输出的过滤；
 * - P1 的提取结果**原样落库**（`run.ts` 的 `results[sliceIndex] = {...}`）；
 * - P2 grounding 只校验「字面在原文出现过」—— 而泛称当然出现过，拦不住。
 *
 * 结果是泛称与碎片**没有任何一道闸门**。对《儒林外史》的实测：
 * `县`（地点，225 次提及，全图第 3 位）、`衙门`（87 次，第 11 位）、
 * `监`（组织，61 次，第 16 位）—— 三条合计 373 次提及，全部作为正常实体入谱。
 *
 * 关键教训：**噪声在头部，不在尾部**。「低频即噪声」的直觉对泛称无效 ——
 * 泛称天然高频，频次阈值永远过滤不掉它，必须靠**词形规则**。
 *
 * 设计原则：
 * - **只做词形判定，不猜测语义**。语义判定是 P3 二审的职责；
 * - **宁可漏杀，不可误杀**。每一条规则都必须能指出它救下的真实专名
 *   （见题材包里 `OFFICE_SUFFIXES` 的「鲁编修」反例）；
 * - 纯函数，无副作用、无 IO，可脱离数据库单测。
 *
 * ⚠️ 五张词表已搬进**题材包**（`genre-pack/classical/lexicon.ts`）。
 * 本模块的函数签名保持向后兼容（题材包是**可选尾参**，省略即用默认包），
 * 因此既有调用方与测试一行都不用改 —— 这正是「纯重构零行为变更」的证明方式。
 */

/** 闸门拒绝原因。前四项与 P0 候选扫描**共用同一套口径**（见 `rejectCandidateReason`）。 */
export type GateRejectionReason =
  | CandidateRejectionReason
  | "official_title"
  | "generic_appellation"
  | "enumeration_name";

/** 闸门判定结果。 */
export type GateVerdict =
  | { accepted: true; nameType: "NAMED" | "TITLE_ONLY" }
  | { accepted: false; reason: GateRejectionReason };

/**
 * 实体名长度上限（归一化后字符数）。
 *
 * ⚠️ 五张词表（官职后缀 / 官署尾字 / 职业称谓 / 尊称 / 排行字）
 * **已全部搬进题材包**（`genre-pack/classical/lexicon.ts`），
 * 本模块只保留这一个转发常量，使 `entity-gate.test.ts` 的既有断言不必改动。
 * 搬迁是**逐字**的，行为零变更。
 *
 * 关于每张表为什么长这样（尤其是「不得误杀『鲁编修』」那条边界），
 * 证据注释随表一起搬到了题材包里 —— 那些注释是这些表最贵的部分。
 */
export const MAX_ENTITY_NAME_LENGTH = DEFAULT_GENRE_PACK.lexicon.maxEntityNameLength;

/**
 * **硬**列举分隔符（**闸门**用）：中文专名里**不可能**出现的符号。
 *
 * 命中即说明模型把**一串并列名词**当成了一个实体名 —— 例如第一回原文
 * 「三年一科，用**五经、四书、八股文**」被原样抄成了规范名。
 *
 * ⚠️ 表里**故意不含** `·` / `・`（间隔号）与 `-`：
 * 前者是**外来音译名的合法分隔**（`弗拉基米尔·普京`），加进来会误杀真专名。
 * 判据是「**列举**」而不是「分隔」—— 只有逗号族与斜杠族算列举。
 *
 * ⚠️ 归一化会做 NFKC，全角 `，；／` 会被折成半角 `,;/`；
 * 两套都列出来只是为了让这张表**自己读得懂**，不依赖归一化的实现细节。
 */
const HARD_ENUMERATION_SEPARATORS: readonly string[] = ["，", "；", "／", ",", ";", "/"];

/**
 * 顿号（U+3001）。
 *
 * ⚠️ 与硬分隔符**分开处理**：顿号是**合法**的并列连词。
 * 实测反例（批次 26，回原文核过）：《红楼梦》的 `荣、宁二府`（全书 3 次）、
 * `宁、荣二府`（4 次）、`荣、宁两府`（2 次，第 2 回即出现）都是**真专名**
 * （指「荣国府 + 宁国府」），《儒林外史》的 `王、李七子`（第 30 回 1 次）
 * 指王世贞/李攀龙「后七子」—— 这些若一并拒掉就是**过度拒绝**。
 */
const IDEOGRAPHIC_COMMA = "、";

/**
 * 顿号分隔时，判定为「列举」所需的最少段数。
 *
 * 取 **3** 而不是 2，正是为了放过上面那批 **2 段真专名**；
 * 而目标 FP `五经、四书、八股文` 恰好是 **3 段**。
 * 这是「**把需要判断的变成不需要判断的**」：段数可枚举，语义不可枚举。
 */
const ENUMERATION_MIN_SEGMENTS = 3;

/**
 * 规范名是否像「一串并列名词」。
 *
 * 两级判据：
 *   ① 含**硬分隔符**（`，；／,;/`）→ 一律判列举（中文专名不含这些符号）；
 *   ② 含**顿号** → 只有切成 **≥3 段**才算列举（2 段可能是 `荣、宁两府` 这类真专名）。
 *
 * @param normalized 归一化字面
 * @returns 像列举时为 true
 */
function isEnumerationName(normalized: string): boolean {
  if (HARD_ENUMERATION_SEPARATORS.some((separator) => normalized.includes(separator))) {
    return true;
  }
  if (!normalized.includes(IDEOGRAPHIC_COMMA)) {
    return false;
  }
  const segments = normalized
    .split(IDEOGRAPHIC_COMMA)
    .filter((segment) => segment.length > 0);
  return segments.length >= ENUMERATION_MIN_SEGMENTS;
}

/**
 * 在归一化字面上做后缀匹配（最长优先）。
 *
 * @param normalized 归一化字面
 * @param suffixes 已按长度降序排列的后缀表
 * @returns 命中的后缀；未命中返回 null
 */
function matchSuffix(normalized: string, suffixes: readonly string[]): string | null {
  for (const suffix of suffixes) {
    if (normalized.length >= suffix.length && normalized.endsWith(suffix)) {
      return suffix;
    }
  }
  return null;
}

/**
 * 前缀是否以行政区划/官署尾字结尾。
 *
 * @param prefix 待判前缀
 * @param adminTailChars 官署尾字表（由题材包提供）
 * @returns 以官署尾字结尾时为 true
 */
function endsWithAdminChar(prefix: string, adminTailChars: ReadonlySet<string>): boolean {
  const tail = prefix.slice(-1);
  return tail.length > 0 && adminTailChars.has(tail);
}

/**
 * 判断一个实体名是否应进入图谱。
 *
 * 判定顺序（先拒后留，与 P0 口径一致）：
 * 1. 复用 P0 的基础规则（单字 / 超长 / 停用表 / 无 CJK）；
 * 2. **列举式规范名**（含**硬**分隔符 `，；／,;/`，或顿号切成 **≥3** 段）→ 拒（批次 26）；
 * 3. **闸门专用**泛称表（资格词 / 类别词 / 处所泛称，光杆）→ 拒（8c）；
 * 4. 姓氏 + 「氏」（如「杜氏」）→ 拒；
 * 5. 尊称 → 光杆者拒；**单字排行前缀 + 尊称**者拒（「二先生」）；其余放行；
 * 6. 官职后缀 → 按前缀与声明类型决定拒或降级；
 * 7. 身份/职业后缀 → 带前缀者降为 `TITLE_ONLY`，光杆者拒；
 * 8. 其余 → 原样接受。
 *
 * ⚠️ 第 2 步排在泛称表之前是**有意的**：列举式规范名是**结构性**错误
 * （模型抄了原文的一串并列名词），比词表命中更能定位根因；
 * 两者的交集为空（泛称表里没有任何含分隔符的条目），因此顺序不影响结果。
 *
 * ⚠️ 第 2 步**只按「段数」判**，不按「像不像专名」判 ——
 * 顿号是合法的并列连词（`荣、宁两府` 是真专名），所以要求 ≥3 段才判列举。
 * 代价是 2 段的列举（`五经、四书`）会漏判，但那是**安全方向**：
 * 漏判只是多留一条 FP，误判会删掉一条真实体（FN）。
 * 现有库内实测：含分隔符的规范名总共只有 **5** 条，全部落在正确一侧。
 *
 * ⚠️ 第 4 步排在官职/身份之前是**防御性**的，不是当前必需：
 * 实测两张表的交集只有「老先生」一个词，而它在两种顺序下结果相同（都判拒）。
 * 之所以仍前置，是因为尊称是比职业**更强**的泛称信号 ——
 * 若日后有人把「老爷」「太爷」补进 `OCCUPATION_SUFFIXES`，
 * 前置能保证「二老爷」这类排行称谓不被身份规则的「带前缀即放行」放过。
 * （反例已实测：`大老先生` 走尊称规则判拒，若走身份规则会判 TITLE_ONLY 放行。）
 *
 * @param canonical 模型给出的规范名
 * @param declaredType 模型声明的实体类型（用于区分「官职当机构」与「以官职为称呼的人」）
 * @param genrePack 题材包（提供五张词表）；省略时用默认包
 * @returns 判定结果
 */
export function judgeEntityName(
  canonical: string,
  declaredType: EntityType,
  genrePack: GenrePack = DEFAULT_GENRE_PACK
): GateVerdict {
  const normalized = normalizeName(canonical);
  const lexicon = genrePack.lexicon;

  const basic = rejectCandidateReason(normalized, lexicon.maxEntityNameLength, genrePack);
  if (basic !== null) {
    return { accepted: false, reason: basic };
  }

  // 批次 26：**列举式规范名** → 拒。
  //
  // 实测（儒林 1-1，那把唯一「穷尽标注 + 精确率可读」的尺子）：P1 把第一回原文
  // 「三年一科，用**五经、四书、八股文**」整串抄成了一个规范名，落库后
  // **同时**造成 1 FP（这条假实体）与 3 FN（`五经`/`四书`/`八股文` 三个真金标名）。
  // FN 的成因是**成员键集合不相交**：该实体的成员键只有那一整串
  // （规范化后含 `、`），与任何金标名都不相等 —— 而指标是**集合相交**判定，
  // 不是子串判定，所以它一个金标名也认领不到，反而白占一个精确率分母。
  // 修它 = 儒林 1-1 实体 FP 1→0、F1 79.45→80.56（确定性，$0 可预演，
  // 见 `_wb_enum_sim.ts` / `_wb_enum_sim.out`）。
  //
  // ⚠️ 判据**不是**「含分隔符」，而是「含**硬**分隔符 **或** 顿号切成 ≥3 段」——
  // 第一版写成「含 `、` 即拒」，$0 预演立刻暴露出它会**误杀真专名**
  // （`荣、宁两府` / `王、李七子`，均已回原文核过），于是当场收窄。
  // 这条正是「**预测写成表、跑完逐条对账**」的价值：对账对出了**没预测到的**误伤。
  //
  // 为什么放在**闸门**而不是 P0 的 `rejectCandidateReason`：那张表被 P0 候选扫描
  // 与闸门**共用**，改它会改动注入 P1 的候选词典 → 改了提示词 → 无法 $0 预演
  // （与第 3 步 `gateGenericWords` 分开写是**同一条理由**）。
  if (isEnumerationName(normalized)) {
    return { accepted: false, reason: "enumeration_name" };
  }

  // 8c：泛称 / 资格词 / 类别词（光杆）→ 拒。
  //
  // 与第 1 步的 `rejectCandidateReason` 分开写，是因为**消费方不同**：
  // 第 1 步的表（`stopWords`）被 P0 候选扫描与闸门**共用**，改它会同时改动
  // 注入 P1 的候选词典 → 改了提示词 → 改了 P1 的 LLM 输出 → **无法 $0 预演**。
  // 本表（`gateGenericWords`）**只被闸门消费**，所以加词是纯 P1 输出侧过滤，
  // 可以在现有图谱上**精确重放**（`_wb_8c_sim.ts`）。
  //
  // 为什么必须有这一步：这些词是**跨运行稳定**的金标实体 FP
  // （`监生` / `老太太` / `省城` / `张府` …）。它们天然高频，
  // **频次阈值永远过滤不掉**，只能靠词形规则；而模型仍会照常抽出来 ——
  // 提示词里那句「严禁抽取泛称」覆盖不到「资格词」这一族。
  //
  // 匹配是**精确相等**：只砍光杆（`监生`），带前缀的具体称呼（`严监生`）照常放行。
  if (lexicon.gateGenericWords.has(normalized)) {
    return { accepted: false, reason: "generic_appellation" };
  }

  // 姓氏 + 「氏」：古典文本里指代某姓女子，全书可能有多人共用，不构成实体身份。
  if (normalized.length <= 3 && normalized.endsWith("氏")) {
    return { accepted: false, reason: "generic_appellation" };
  }

  const appellation = matchSuffix(normalized, lexicon.appellationWords);
  if (appellation !== null) {
    const prefix = normalized.slice(0, normalized.length - appellation.length);
    // 光杆尊称（「老师」「太爷」）→ 无指代对象。
    if (prefix.length === 0) {
      return { accepted: false, reason: "generic_appellation" };
    }
    // 单字排行前缀（「二先生」「大先生」「大老官」）→ 仍是泛称，见 RANK_PREFIX_CHARS 注释。
    // 前缀是姓氏或两个以上字符（「虞老师」「慎卿先生」）→ 落到下面按具体的人处理。
    if (prefix.length === 1 && lexicon.rankPrefixChars.has(prefix)) {
      return { accepted: false, reason: "generic_appellation" };
    }
  }

  const office = matchSuffix(normalized, lexicon.officeSuffixes);
  if (office !== null) {
    const prefix = normalized.slice(0, normalized.length - office.length);
    // 前缀为空（光杆官名）或以辖区/官署结尾 → 指的是机构或职位，不是人物。
    if (prefix.length === 0 || endsWithAdminChar(prefix, lexicon.adminTailChars)) {
      return { accepted: false, reason: "official_title" };
    }
    // 前缀像姓氏，但模型把官名判成了机构（实测「河南道监察御史」被标为 ORGANIZATION）
    // → 官名被误当组织，拒。
    if (declaredType !== "PERSON") {
      return { accepted: false, reason: "official_title" };
    }
    // 姓氏 + 官职 = 以官职为唯一称呼的人物（「鲁编修」）→ 保留但标注名字类型。
    return { accepted: true, nameType: "TITLE_ONLY" };
  }

  const occupation = matchSuffix(normalized, lexicon.occupationSuffixes);
  if (occupation !== null) {
    const prefix = normalized.slice(0, normalized.length - occupation.length);
    if (prefix.length === 0) {
      return { accepted: false, reason: "generic_appellation" };
    }
    return { accepted: true, nameType: "TITLE_ONLY" };
  }

  return { accepted: true, nameType: "NAMED" };
}

/** 被闸门拒绝的实体记录（写入 `analysis_issues` 供事后归因）。 */
export interface EntityRejection {
  canonical: string;
  type     : EntityType;
  reason   : GateRejectionReason;
}

/**
 * 别名被丢弃的原因。
 *
 * `not_in_book` 是关键一条：模型声称「实体 A 的别名是 B」，
 * 但 B 在**全书正文里根本没有字面出现** —— 说明它是凭空编的，
 * 而这类幻觉别名正是把无关人物桥接起来的元凶。
 *
 * ⚠️ 口径演进（2026-10-11，批次 25）：本条原为 `not_in_slice`（要求别名
 * **在本片**出现）。实测发现它**比 P2 grounding 更严**（grounding 只要求
 * **全书**出现），而闸门的丢弃是**终局**的 —— 于是「在本片之外、但在全书之内」
 * 的**真别名**被闸门永久删掉（儒林+红楼共 68 条，其中 62 条经回原文核对为真）。
 * 改为**全书**口径后，闸门与 grounding 的别名作用域**由构造保证一致**
 * （两者消费同一个 `GroundingIndex`），不再存在「更严的中间闸门」。
 */
export type AliasDropReason = GateRejectionReason | "not_in_book";

/** 被丢弃的别名记录。 */
export interface AliasRejection {
  alias : string;
  /** 声称该别名的实体规范名。 */
  owner : string;
  reason: AliasDropReason;
}

/** 闸门对单片提取结果的处理产物。 */
export interface GatedSlice {
  /** 过滤后的提取结果（实体与别名已剔除、关系已清理）。 */
  extraction      : SliceExtraction;
  /** 被拒绝的实体明细。 */
  rejections      : EntityRejection[];
  /** 被丢弃的别名明细。 */
  droppedAliases  : AliasRejection[];
  /**
   * 因**端点被本闸门拒绝**而一并剔除的关系数。
   *
   * 语义严格限定为「端点确实被拒」，不包含「端点未出现在本片实体表」的情况 ——
   * 后者是分片固有的正常现象（实体在别片被提取），若在此一并丢弃会造成召回损失。
   */
  droppedRelations: number;
}

/**
 * 对单片提取结果施加闸门。
 *
 * 三件事必须一起做，缺一不可：
 * 1. **实体准入**：`judgeEntityName` 判定规范名；
 * 2. **别名净化**：别名同样要过词形闸门，且必须有**字面证据**（见下）；
 * 3. **关系清理**：端点被拒的关系必须同步剔除，否则下游会拿到悬空端点
 *    （该实体已不存在，但关系仍指向它），P5 归并时会静默跳过或产生错误的键映射。
 *
 * 为什么别名净化与实体准入一样重要：别名是 P5 归并的**唯一合并依据**。
 * 一个泛称别名（「老爹」）同时挂在两个人物名下，就会把他们永久并成一个实体，
 * 且**被吞掉的一方在库里会彻底消失**（本名降级为别名，再被唯一约束挤掉）。
 * 实测曾因此丢掉 40% 的主要人物（范进、严监生、胡屠户…）。
 *
 * ## ⚠️ 别名作用域：**全书**，不是本片（批次 25 的口径修正）
 *
 * 这里刻意**复用 P2 grounding 的索引**（`GroundingIndex`），而不是本片正文。
 * 原因是一次实测：本片口径**比 grounding 更严**（grounding 只要求全书出现），
 * 而闸门的丢弃是**终局**的 —— 「在本片之外、但在全书之内」的真别名被闸门
 * 永久删掉（68 条里 62 条经回原文核对为真），随后 grounding 再也见不到它们。
 * 改用同一个索引后，闸门与 grounding 的作用域**由构造保证一致**，不可能漂移。
 *
 * @param extraction P1 单片的原始提取结果
 * @param groundingIndex 全书 grounding 索引（与 P2 同源）；提供时启用「别名必须有字面证据」校验
 * @param genrePack 题材包（提供五张词表）；省略时用默认包
 * @returns 过滤后的结果与被拒/被丢弃明细
 */
export function gateExtraction(
  extraction: SliceExtraction,
  groundingIndex?: GroundingIndex,
  genrePack: GenrePack = DEFAULT_GENRE_PACK
): GatedSlice {
  const rejections: EntityRejection[] = [];
  const droppedAliases: AliasRejection[] = [];
  const rejectedKeys = new Set<string>();
  const keptEntities: ExtractedEntity[] = [];

  for (const entity of extraction.entities) {
    const verdict = judgeEntityName(entity.canonical, entity.type, genrePack);
    if (!verdict.accepted) {
      rejections.push({ canonical: entity.canonical, type: entity.type, reason: verdict.reason });
      rejectedKeys.add(normalizeName(entity.canonical));
      continue;
    }

    // 别名净化：词形闸门 + **全书**字面证据（与 P2 grounding 同一个索引）。
    const aliases: string[] = [];
    for (const alias of entity.aliases) {
      const aliasVerdict = judgeEntityName(alias, entity.type, genrePack);
      if (!aliasVerdict.accepted) {
        droppedAliases.push({ alias, owner: entity.canonical, reason: aliasVerdict.reason });
        continue;
      }
      if (groundingIndex !== undefined && !isNameGrounded(alias, groundingIndex)) {
        droppedAliases.push({ alias, owner: entity.canonical, reason: "not_in_book" });
        continue;
      }
      aliases.push(alias);
    }

    // 仅在判定改变了名字类型、或别名被剔除时才复制对象，避免无谓的整片重建。
    const unchanged =
      verdict.nameType === entity.nameType && aliases.length === entity.aliases.length;
    keptEntities.push(unchanged ? entity : { ...entity, nameType: verdict.nameType, aliases });
  }

  // 无拒绝项时直接复用原数组：多数分片不含噪声，没必要为每片重建一次关系表。
  const keptRelations: ExtractedRelation[] =
    rejectedKeys.size === 0
      ? extraction.relations
      : extraction.relations.filter(
          (relation) =>
            !rejectedKeys.has(normalizeName(relation.sourceCanonical)) &&
            !rejectedKeys.has(normalizeName(relation.targetCanonical))
        );

  return {
    extraction      : { entities: keptEntities, relations: keptRelations },
    rejections,
    droppedAliases,
    droppedRelations: extraction.relations.length - keptRelations.length
  };
}
