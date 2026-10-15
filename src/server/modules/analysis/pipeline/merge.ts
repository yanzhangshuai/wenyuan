import { normalizeName } from "@/lib/text";

import type { EntityType, NameType } from "../schemas";

import { isStopWord } from "./dictionary";
import { isProperNameForm } from "./name-form";

/**
 * P5 实体归并与别名护栏（零 LLM 成本）。
 *
 * 修复 v1 的两个缺陷：
 * 1. v1 `aliasResolver.ts` 仅按 alias **精确字符串**桥接，无归一化，
 *    「司马 光」与「司马光」不会合并 —— v3 全程使用 `normalizeName()` 作为键；
 * 2. v1 归并后靠 `name` 字符串回填 `mentions`，差异即导致引用丢失 ——
 *   v3 通过 `keyToEntityIndex` 输出「归一化键 → 合并实体下标」映射，
 *   上层只改 `entity_mentions.entity_id` 外键，**永不靠名字回填**。
 *
 * 安全护栏（借鉴 AI-Reader-V2 `_is_unsafe_alias`）：
 * 代词、自称与泛类称谓没有区分度，用它们桥接会把不同人物错误合并
 * （例如「大哥」同时指代多人），因此禁止作为合并依据。
 */

/**
 * 代词与自称：永远不能作为实体别名。
 * 归一化后比较（`normalizeName` 已折叠全角并小写）。
 */
const PRONOUN_ALIASES: ReadonlySet<string> = new Set([
  "我", "吾", "予", "余", "汝", "尔", "你", "他", "她", "它", "其", "之",
  "在下", "老夫", "贫道", "朕", "寡人", "臣", "妾", "小生", "晚生",
  "咱们", "我们", "你们", "他们", "大家", "众人", "诸位", "彼此"
]);

/**
 * 泛类称谓：脱离具体语境后无区分度，禁止作为合并依据。
 *
 * 注意这是对**独立别名值**的判断，不含后缀匹配 ——
 * 「娄三公子」不在表内，因此仍可作为别名正常参与合并。
 */
const GENERIC_ALIASES: ReadonlySet<string> = new Set([
  "大哥", "大姐", "小弟", "小妹", "哥哥", "姐姐", "弟弟", "妹妹",
  "父亲", "母亲", "爹", "娘", "儿子", "女儿", "丈夫", "妻子",
  "老爷", "夫人", "娘子", "相公", "公子", "小姐", "大人", "先生",
  "师父", "徒弟", "官人", "师傅", "徒弟们", "老爷们"
]);

/**
 * 判断别名是否不安全（禁止用于实体桥接）。
 *
 * 三类：
 * 1. 代词与自称（「在下」「寡人」）—— 指代对象随语境变化；
 * 2. 泛类称谓（「大哥」「夫人」）—— 无区分度；
 * 3. **共用泛称表**（`dictionary.STOP_WORDS`）—— 与 P0/P1 的实体准入共用同一张表。
 *
 * 第 3 条是本轮新增：实测发现「丈人」「岳父」「老爹」「少爷」「太公」「公孙」
 * 这类亲属/身份泛称**不在原来的两张表里**，而它们恰恰是把无关人物
 * 桥接成一个大组件的元凶（「杜少卿」名下堆积了 17 个亲属称谓）。
 * 与其再维护第三张表，不如复用已有的那张 —— 泛称就是泛称，
 * 作为规范名不合格，作为别名同样不合格。
 *
 * @param alias 原始别名
 * @returns 代词、自称或泛类称谓时为 true
 */
export function isUnsafeAlias(alias: string): boolean {
  const key = normalizeName(alias);
  return PRONOUN_ALIASES.has(key) || GENERIC_ALIASES.has(key) || isStopWord(key);
}

/** 待归并的候选实体。 */
export interface MergeCandidate {
  canonical        : string;
  type             : EntityType;
  aliases          : readonly string[];
  /**
   * 名字类型（`NAMED` / `TITLE_ONLY`）。
   *
   * 缺省为 `NAMED` —— 使本函数在旧调用点上行为不变。
   * 该字段来自 P1 提取（闸门可将其降为 `TITLE_ONLY`，如「胡屠户」「鲁编修」）。
   */
  nameType?        : NameType;
  /**
   * 该候选**被观测到**的章节序号（来自 P1 提取的 `chapterOrdinal`）。
   *
   * ⚠️ **缺省（或空数组）= 「未提供观测章节 → 不施加任何章节限制」**。
   *
   * 为什么缺省是「不限制」而不是「限制到零章节」：本仓库有 20 多处测试调用点
   * 只关心归并本身、不构造章节信息；若把空数组解释成「限制到零章节」，
   * 它们会**静默产出零提及** —— 一个比原缺陷更难发现的失败模式。
   * 生产路径（`run.ts`）**始终**提供该字段，因此「不限制」这条分支在真实运行中不会被走到。
   *
   * 用途见 `persist-graph.ts`：提及必须限制在观测章节内，否则泛称别名会把
   * **别回**的提及搬进本回（缺陷 N1 —— 实测 `王公` 全书 10 次、第一回 0 次，
   * 却因别名 `老父台` 出现在第一回 段 9 而在第一回被记了一次提及）。
   */
  observedChapters?: readonly number[];
}

/** 归并后的实体。 */
export interface MergedEntity {
  /** 选定的规范名（展示用，取自原文出现的写法）。 */
  canonical       : string;
  type            : EntityType;
  /**
   * 名字类型：**仅当参与合并的所有写法都不是本名时**才为 `TITLE_ONLY`。
   *
   * 语义解释：只要知道任何一个真实姓名，这个实体就不再是「只有称谓」。
   * 因此取「全部成员键都是 TITLE_ONLY」的合取，而非任取一个。
   */
  nameType        : NameType;
  /** 合并后保留的全部别名（去重、去规范名本身）。 */
  aliases         : string[];
  /** 参与合并的全部归一化键。 */
  memberKeys      : string[];
  /**
   * 合并后实体的**观测章节**：全部成员观测章节的并集，升序去重。
   *
   * ⚠️ 空数组的含义与 `MergeCandidate.observedChapters` **完全一致**：
   * 「未提供观测章节 → 不施加章节限制」。生产路径不会为空 ——
   * `run.ts` 给每个候选都带上 P1 的 `chapterOrdinal`。
   *
   * 为什么在**归并后**才算并集：归并会把「同一人的不同写法」并成一个实体，
   * 而不同写法可能在不同章节被观测到。只取某一成员的章节会误删其余成员的提及。
   */
  observedChapters: number[];
}

/** 归并输入。 */
export interface MergeInput {
  entities            : readonly MergeCandidate[];
  /** 归一化名字 → 全书出现次数，用于规范名决策。 */
  nameFrequency       : ReadonlyMap<string, number>;
  /**
   * 归一化键 → 外部已判定的类型（当前来自 P0 词典分类）。
   *
   * 为什么需要它：P0 已经用模型对每个候选名判过一次类型，若此处忽略，
   * 那次调用的类型信息就被浪费，且实体类型会退化为「谁先出现谁说了算」。
   * 该映射作为**与分片提取等权的额外票**参与类型投票。
   */
  declaredTypes?      : ReadonlyMap<string, EntityType>;
  /**
   * 作品包声明的**别名组**（批次 43）：组内名字指同一实体。
   *
   * 缺省 `[]` → **零行为变更**。语义与风险见 `WorkPack.aliasGroups` 与
   * `mergeDeclaredAliasGroups`。
   */
  declaredAliasGroups?: readonly (readonly string[])[];
}

/** 归并输出。 */
export interface MergeOutcome {
  entities              : MergedEntity[];
  /** 被安全护栏拒绝的别名（留档用）。 */
  rejectedAliases       : string[];
  /**
   * 因「被 ≥2 个**不同**实体声称」而无区分度、被丢弃的别名（本轮新增，留档用）。
   *
   * 这是切断错并级联的关键机制，详见 `mergeEntities` 的说明。
   */
  conflictingAliases    : string[];
  /**
   * 冲突别名的**声称者**：`{ 别名 → [声称它的规范名] }`（批次 26B 新增，留档用）。
   *
   * 为什么必须留档（这是「P5 可 $0 预演」的前提）：
   * 冲突判定用的是**丢弃之前**算出的 `aliasOwners`（见 `mergeEntities` 的预处理），
   * 而它**从不落库**。于是任何「上游改动会怎样改变 P5 的丢弃集合」这个问题，
   * 在库内**无法回答** —— 因为「谁声称过这个别名」这个输入**被这一步自己抹掉了**。
   * 批次 25 正是因此吃了亏：A 放行的 20/21 条桥接别名被这道护栏吃掉 8/1 条，
   * 却**没有任何留档**能算出「吃掉的是哪几条、为什么」。
   *
   * ⚠️ 键是**展示形**（与 `conflictingAliases` 同一个字符串），值是**展示形**规范名、
   * 已排序（保证留档稳定）。消费方（如 $0 预演器）**必须**先 `normalizeName` 两侧
   * **再去重**，才与生产的 `Set<normalizeName(canonical)>` 等价 ——
   * 生产是「按不同**规范名**去重」，两个展示形不同的规范名若归一化后相同，只算一个声称者。
   */
  conflictingAliasOwners: Record<string, string[]>;
  /**
   * N18 行政后缀白名单**实际发生**的归并次数（留档用）。
   *
   * 它是「同地双份」被消掉的直接证据。为 0 有两种含义，必须靠上下文区分：
   * ① 本作品确实没有这类重复；② 规则被类型判据或「≥2 个行政后缀兄弟」挡住了。
   * 两者在 PRF 数字里长得一模一样 —— 所以必须显式留档。
   */
  administrativeMerges  : number;
  /**
   * R3 书名号**实际发生**的归并次数（留档用）。
   *
   * 它是「同一部作品的带号 / 不带号写法」被消掉的直接证据
   * （`庄子` + `《庄子》`）。为 0 同样有两种含义：① 本作品没有这类重复；
   * ② 被**类型护栏**（只并 CONCEPT）挡住了 —— 两者在 PRF 里无法区分。
   */
  bookTitleMerges       : number;
  /**
   * 声明式别名组**真正生效的组数**（批次 43，留档用）。
   *
   * 「生效」= 该组在图谱里命中 **≥2 个不同的组**（否则是空操作 —— 那些人已经是一个实体）。
   * 为 0 有两种含义，必须靠上下文区分：① 作品包没声明别名组；
   * ② 声明的组全都已是同一实体（说明上游切分本来就干净）。**两者在 PRF 里长得一模一样。**
   *
   * ⚠️ 与 `administrativeMerges` / `bookTitleMerges` 的计数口径**不同**：
   * 那两个数**成对归并的次数**，本数**生效的组数**（一组可能触发多次并）。
   */
  declaredAliasMerges   : number;
  /**
   * 归一化键 → `entities` 下标。
   *
   * 上层据此重指向 `entity_mentions.entity_id`，取代 v1 的名字回填方案。
   */
  keyToEntityIndex      : ReadonlyMap<string, number>;
}

/** 类型决策的固定优先级顺序，保证结果与 Map 插入顺序无关。 */
const ENTITY_TYPE_ORDER: readonly EntityType[] = [
  "PERSON",
  "LOCATION",
  "ORGANIZATION",
  "CONCEPT"
];

/** 极简并查集：键为归一化名字。 */
class UnionFind {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    const parent = this.parent.get(key);
    if (parent === undefined) {
      this.parent.set(key, key);
      return key;
    }
    if (parent === key) {
      return key;
    }
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent.set(rootB, rootA);
    }
  }
}

/**
 * 选择规范名：**优先专名**；同层内按「出现次数多者」，次数相同取较短者。
 *
 * ## 为什么把「形态」提到「频次」之前
 *
 * 原实现只按频次选（同频次才取短名），而书里对人物的**称谓**出现次数
 * **必然多于**本名 ——《儒林外史》「马二先生」全书几十次、「马纯上」几次
 * ⇒ 规范名落成敬称。实测 428 个人物里 **18 个**如此，且本名**已在别名里**。
 *
 * ## 分层而非替换（关键）
 *
 * 先按「是否称谓形式」把候选键分两层，**只在存在专名时**收窄到专名层；
 * 若候选**全是**称谓（如「三公子」），则**回退**到原逻辑。
 * 这样 `isHonorificForm` **漏收**的后果只是「少修一个」，绝不会「改错一个」。
 *
 * ⚠️ 只改变「选中哪个键作为显示名」，**不改变成员键集合** ⇒
 * 实体/关系/提及的图结构完全不变（`aliases` 会自动把落选的原规范名收进去）。
 *
 * @param keys 候选归一化键
 * @param frequency 名字频次表
 * @returns 选中的归一化键
 */
function pickCanonicalKey(
  keys: readonly string[],
  frequency: ReadonlyMap<string, number>
): string {
  const proper = keys.filter((key) => isProperNameForm(key));
  const pool = proper.length > 0 ? proper : keys;

  let best = "";
  let bestFrequency = -1;

  for (const key of pool) {
    const current = frequency.get(key) ?? 0;
    if (current > bestFrequency || (current === bestFrequency && key.length < best.length)) {
      best = key;
      bestFrequency = current;
    }
  }

  return best;
}

/**
 * 选择实体类型。
 *
 * 决策优先级（从高到低）：
 * 1. **P0 声明类型**（若该实体的任一成员键被 P0 判定过）—— 采用票数最高的声明；
 * 2. 分片提取观测的多数票，按 `ENTITY_TYPE_ORDER` tie-break（PERSON 优先）。
 *
 * 为什么 P0 声明优先于分片观测：
 * P0 是**全书维度**的分类（模型看到的是全量候选名清单），而分片观测是
 * 局部判断。若二者等权，则「某书院」在正文里被某片标成 PERSON、
 * 又在 P0 被正确判为 ORGANIZATION 时会打成平票，最终由 tie-break
 * 决定 —— 这会让 P0 的模型调用在关键时刻失效。故 P0 有声明时以其为准。
 *
 * @param keys 成员归一化键
 * @param keyToType 键 → 类型（分片提取阶段的观测）
 * @param declaredTypes 键 → 外部声明类型（P0）
 * @returns 最终类型；无任何证据时返回 PERSON
 */
function pickType(
  keys: readonly string[],
  keyToType: ReadonlyMap<string, EntityType>,
  declaredTypes: ReadonlyMap<string, EntityType>
): EntityType {
  // 优先级 1：P0 声明。
  const declaredCounts = new Map<EntityType, number>();
  for (const key of keys) {
    const declared = declaredTypes.get(key);
    if (declared !== undefined) {
      declaredCounts.set(declared, (declaredCounts.get(declared) ?? 0) + 1);
    }
  }
  if (declaredCounts.size > 0) {
    return pickByCounts(declaredCounts);
  }

  // 优先级 2：分片观测。
  const observationCounts = new Map<EntityType, number>();
  for (const key of keys) {
    const observed = keyToType.get(key);
    if (observed !== undefined) {
      observationCounts.set(observed, (observationCounts.get(observed) ?? 0) + 1);
    }
  }
  return pickByCounts(observationCounts);
}

/**
 * 从计票结果中取出票数最高者；平票时按 `ENTITY_TYPE_ORDER` 决定。
 *
 * @param counts 类型 → 票数
 * @returns 胜出类型；票池为空时返回 PERSON
 */
function pickByCounts(counts: ReadonlyMap<EntityType, number>): EntityType {
  let best: EntityType = "PERSON";
  let bestCount = 0;
  for (const type of ENTITY_TYPE_ORDER) {
    const count = counts.get(type) ?? 0;
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

/**
 * 行政后缀（N18 白名单，**唯一一条实测安全的形式**）。
 *
 * 为什么只收这五个：`县/府/州/城/省` 是**行政层级**的嵌套写法，
 * `天长` 与 `天长县` 必然指同一地。而 `会稽 ⊂ 会稽山`（山）、
 * `薛家 ⊂ 薛家集`（集）、`雷峰 ⊂ 雷峰塔`（塔）、`秦淮 ⊂ 秦淮河`（河）
 * 恰恰是**不同实体** —— 它们属于「能枚举的用正则/白名单，不能枚举的用词典」
 * 这条判据里**不能枚举**的那一半，所以**故意不收**。
 *
 * ⚠️ 扩这个表要格外小心：`findPrefixConflicts` 保持只查前缀（N2 词表侧已证伪），
 * 本表是**产出侧**的归并，与词表无关。
 */
const ADMINISTRATIVE_SUFFIXES: readonly string[] = ["县", "府", "州", "城", "省"];

/**
 * N18：把「同一地名的简称 / 全称」并成一个实体（`汶上` + `汶上县`）。
 *
 * 规则（`docs/问题清单与后续工作.md` §2.A N18 / §2.I 结论 4）：
 * `长规范名 = 短规范名 + {县,府,州,城,省}` ∧ **短名是 LOCATION**
 * ∧ **短名无 ≥2 个行政后缀兄弟**。
 *
 * 为什么值得做：同一地名被切成两个实体 → 实体数虚高、提及数被劈开、
 * 关系端点可能挂到短名那一份上（与 N1 / N16 同属「一个缺陷同时压低精确率
 * 与召回率」的机制）。实测（`_wb_n19_sim.ts`，**$0 确定性预演**）：
 * 儒林当前库 20 对，1-3 回实体 F1 **91.39 → 92.00**，且**不损失任何召回**
 * （FP `汶上` 消失、TP 不变、FN 不变）。
 *
 * 为什么必须在**分组之后**做：规则比的是**规范名**，而规范名要经
 * `pickCanonicalKey` 才算得出来 —— 候选层的 `canonical` 未必是最终规范名。
 *
 * 为什么要求「无 ≥2 个行政后缀兄弟」：府与县是**嵌套的两级**，所以
 * `长安` 同时有 `长安县` 与 `长安府` 时**整组跳过**。这是**领域选择，不是证明**
 * （R7→R6 实测 37→33 对）。
 *
 * @param groups 按并查集根分好的组
 * @param unionFind 并查集（本函数在其上追加 N18 的并）
 * @param keyToType 分片观测到的键 → 类型
 * @param declaredTypes P0 声明的键 → 类型
 * @param nameFrequency 键 → 全书出现次数（用于选规范名）
 * @returns 实际发生的归并次数（0 = 本作品没有这类重复，或被判据挡住）
 */
function mergeAdministrativeSuffixGroups(
  groups: ReadonlyMap<string, { keys: ReadonlySet<string> }>,
  unionFind: UnionFind,
  keyToType: ReadonlyMap<string, EntityType>,
  declaredTypes: ReadonlyMap<string, EntityType>,
  nameFrequency: ReadonlyMap<string, number>
): number {
  const roots = [...groups.keys()];
  const canonicalOf = new Map<number, string>();
  const allKeys = new Set<string>();

  for (const [index, root] of roots.entries()) {
    const bucket = groups.get(root);
    if (bucket === undefined) {
      continue;
    }
    for (const key of bucket.keys) {
      allKeys.add(key);
    }
    canonicalOf.set(index, pickCanonicalKey([...bucket.keys], nameFrequency));
  }

  // 规范名 → 组下标（首个占用者）。只认**规范名**，与规则表述
  // 「长规范名 = 短规范名 + …」一致，也让规则保持「宁可少并」的保守取向。
  const groupOfCanonical = new Map<string, number>();
  for (const [index, key] of canonicalOf) {
    if (key.length > 0 && !groupOfCanonical.has(key)) {
      groupOfCanonical.set(key, index);
    }
  }

  let merges = 0;
  for (const [index, shortKey] of canonicalOf) {
    if (shortKey.length === 0) {
      continue;
    }
    const root = roots[index];
    const bucket = root === undefined ? undefined : groups.get(root);
    if (root === undefined || bucket === undefined) {
      continue;
    }
    // 短名必须是**地名** —— `布政司 ⊂ 浙江布政司` 这类机构前缀不在白名单内。
    if (pickType([...bucket.keys], keyToType, declaredTypes) !== "LOCATION") {
      continue;
    }
    const longKeys = ADMINISTRATIVE_SUFFIXES.map((suffix) => shortKey + suffix).filter((key) =>
      allKeys.has(key)
    );
    // 行政后缀兄弟 ≥2 → 整组跳过（府/县是嵌套两级，无法判断哪一份才是主形式）。
    if (longKeys.length >= 2) {
      continue;
    }
    for (const longKey of longKeys) {
      const target = groupOfCanonical.get(longKey);
      if (target === undefined || target === index) {
        continue;
      }
      const targetRoot = roots[target];
      if (targetRoot === undefined || unionFind.find(root) === unionFind.find(targetRoot)) {
        continue;
      }
      unionFind.union(root, targetRoot);
      merges += 1;
    }
  }

  return merges;
}

/**
 * R3 书名号：把书名号 / 引号去掉（`《庄子》` → `庄子`）。
 *
 * ⚠️ 字符集必须与批次 18/23 的 $0 预演（`_wb_merge_fix_sim.ts` / `_wb_joint_sim.ts`）
 * **逐字一致** —— 预演已证明「同为 CONCEPT 且去号后相等」的归并对**逐条可辩护**
 * （红楼 7 对：`四书` / `古今人物通考` / `庄子` / `西厢记` / `牡丹亭` / `荆钗记` / `金刚经`）。
 */
function stripBookMarks(key: string): string {
  return key.replace(/[《》〈〉「」『』]/g, "");
}

/**
 * R3：把「同一部作品的带号 / 不带号写法」并成一个实体（`庄子` + `《庄子》`）。
 *
 * 规则（`docs/问题清单与后续工作.md` §3.32，$0 预演已验证）：
 * - **只对 CONCEPT** —— 类型护栏**承重**：`庄子` 既是书（CONCEPT）也是人（PERSON），
 *   去掉护栏会把人与书并成一个；
 * - 规范名去掉书名号后**相等**，且**至少一侧带号**
 *   （两侧都无号则规范名相同，不可能是两个实体）；
 * - 与 N18 一样放在**分组之后**：规则比的是**规范名**，而规范名要
 *   `pickCanonicalKey` 才算得出来 —— 候选层的 `canonical` 未必是最终规范名。
 *
 * 为什么这条规则可以收：类型护栏把作用面限制在 CONCEPT，而实测全库
 * 「去号后同名、但类型不同」的风险组 = **0**（`_wb_r3_type_probe.ts`），
 * 即护栏当前**空转** —— 但规则仍必须保留，它是唯一能拦住「书与人同名」的机制。
 *
 * @param groups 按并查集根分好的组
 * @param unionFind 并查集（本函数在其上追加 R3 的并）
 * @param keyToType 分片观测到的键 → 类型
 * @param declaredTypes P0 声明的键 → 类型
 * @param nameFrequency 键 → 全书出现次数（用于选规范名）
 * @returns 实际发生的归并次数（0 = 本作品没有这类重复，或被类型护栏挡住）
 */
function mergeBookTitleGroups(
  groups: ReadonlyMap<string, { keys: ReadonlySet<string> }>,
  unionFind: UnionFind,
  keyToType: ReadonlyMap<string, EntityType>,
  declaredTypes: ReadonlyMap<string, EntityType>,
  nameFrequency: ReadonlyMap<string, number>
): number {
  const roots = [...groups.keys()];
  const canonicalOf = new Map<number, string>();

  for (const [index, root] of roots.entries()) {
    const bucket = groups.get(root);
    if (bucket === undefined) {
      continue;
    }
    canonicalOf.set(index, pickCanonicalKey([...bucket.keys], nameFrequency));
  }

  // 去号后的键 → 组下标列表。只收 CONCEPT（类型护栏）。
  const byStripped = new Map<string, number[]>();
  for (const [index] of canonicalOf) {
    const root = roots[index];
    const bucket = root === undefined ? undefined : groups.get(root);
    if (bucket === undefined) {
      continue;
    }
    if (pickType([...bucket.keys], keyToType, declaredTypes) !== "CONCEPT") {
      continue;
    }
    const key = canonicalOf.get(index) ?? "";
    if (key.length === 0) {
      continue;
    }
    const stripped = stripBookMarks(key);
    if (stripped.length === 0) {
      continue;
    }
    const sameStripped = byStripped.get(stripped) ?? [];
    sameStripped.push(index);
    byStripped.set(stripped, sameStripped);
  }

  let merges = 0;
  for (const [stripped, indexes] of byStripped) {
    if (indexes.length < 2) {
      continue;
    }
    // 至少一侧带书名号才算 R3 命中（两侧都无号 → 规范名相同，不可能两个实体）。
    if (!indexes.some((index) => (canonicalOf.get(index) ?? "") !== stripped)) {
      continue;
    }
    const first = indexes[0];
    if (first === undefined) {
      continue;
    }
    const firstRoot = roots[first];
    if (firstRoot === undefined) {
      continue;
    }
    for (const other of indexes.slice(1)) {
      const otherRoot = roots[other];
      if (otherRoot === undefined || unionFind.find(firstRoot) === unionFind.find(otherRoot)) {
        continue;
      }
      unionFind.union(firstRoot, otherRoot);
      merges += 1;
    }
  }

  return merges;
}

/**
 * 批次 43：**声明式别名组归并** —— 把「人工确认是同一人」的名字并成一个实体。
 *
 * ## 它补的是哪条结构性缺口
 *
 * 归并的**唯一实质依据是 P1 逐片填的 `aliases`** —— **局部视角**：
 * 同一人在第 2 回被抽成 `贾政`、第 3 回被抽成 `政老爷`，两片互不知情，
 * 于是各自声称同一个桥接别名 → 触发上面的**冲突别名护栏**（被 ≥2 个规范名声称 → 丢弃）
 * → 共享键消失 → **union 永不发生 → 永久碎片**。
 *
 * 实测代价（红楼 1-3）：**实体 FP 14 条里 8 条、关系 FP 17 条里 12 条**来自这一族。
 *
 * ## 为什么必须放在冲突护栏**之后**、且**无条件 union**
 *
 * 声明组是**人工断言**「这些名字是同一个人」，它**不是**从别名共现推出来的猜测，
 * 所以**不受**「别名被 ≥2 个实体声称」这条护栏的约束 —— 那条护栏防的是
 * **模型填的**别名（`哥哥`/`妈妈` 这类泛称桥接），而不是人工核对过的身份。
 *
 * ## ⚠️ 风险与取舍
 *
 * 声明错 = **错并**，而错并在图谱里**不可见**（批次 18：`王夫人` 被并进 9 个王爷）。
 * 因此：
 * - 注册期 `assertWorkPackIsValid` 会拦住「名字出现在两个组」与「组内不足 2 个名字」；
 * - 组本身必须**回原文逐对可辩护**，且必须排除「夫妻/父女」这类**两人共用同一称谓**的情形
 *   （`周瑞` / `周瑞家的` 就是两个人）。
 *
 * @param groups 按并查集根分好的组
 * @param unionFind 并查集（本函数在其上追加声明组的并）
 * @param declaredGroups 作品包声明的别名组（每组 = 指同一实体的名字）
 * @returns **真正生效的声明组数**（命中 ≥2 个组才算生效；0 = 所有声明都已是同一实体）
 */
function mergeDeclaredAliasGroups(
  groups: ReadonlyMap<string, { keys: ReadonlySet<string> }>,
  unionFind: UnionFind,
  declaredGroups: readonly (readonly string[])[]
): number {
  if (declaredGroups.length === 0) {
    return 0;
  }

  const roots = [...groups.keys()];
  // 成员键 → 组下标（首个占用者）。
  // 用**全部成员键**而不是只认规范名：声明里的名字可能当前只是别人的**别名**
  // —— 那样那个实体**本就属于本组**，不能因为「它不是规范名」就漏掉。
  const groupOfKey = new Map<string, number>();
  for (const [index, root] of roots.entries()) {
    const bucket = groups.get(root);
    if (bucket === undefined) {
      continue;
    }
    for (const key of bucket.keys) {
      if (!groupOfKey.has(key)) {
        groupOfKey.set(key, index);
      }
    }
  }

  let mergedGroups = 0;
  for (const declared of declaredGroups) {
    const indices = new Set<number>();
    for (const name of declared) {
      const key = normalizeName(name);
      if (key.length === 0) {
        continue;
      }
      const index = groupOfKey.get(key);
      if (index !== undefined) {
        indices.add(index);
      }
    }
    // 命中 <2 个组 → 空操作（该人已经是一个实体，或名字不在本次图谱里）。
    if (indices.size < 2) {
      continue;
    }

    const [first, ...rest] = [...indices];
    if (first === undefined) {
      continue;
    }
    const firstRoot = roots[first];
    if (firstRoot === undefined) {
      continue;
    }

    let unioned = false;
    for (const index of rest) {
      const otherRoot = roots[index];
      if (otherRoot === undefined || unionFind.find(firstRoot) === unionFind.find(otherRoot)) {
        continue;
      }
      unionFind.union(firstRoot, otherRoot);
      unioned = true;
    }
    if (unioned) {
      mergedGroups += 1;
    }
  }

  return mergedGroups;
}

/**
 * 归并候选实体。
 *
 * ## 关于「冲突别名」（本轮修复的核心）
 *
 * 归并的**唯一依据**是模型填写的 `aliases` 字段。而模型会往里面塞两类东西：
 * 该人物的真实别称（「马纯上」是「马二先生」的本名，正确），
 * 以及**无区分度的泛称或别人的名字**（「丈人」「老爹」「少爷」…）。
 *
 * 在并查集上，**一条假边就会永久合并两个分量，且不可逆、不可见** ——
 * 实测《儒林外史》因此丢掉 40% 的主要人物（范进被并进鲍廷玺、
 * 胡屠户被并进杜少卿、荀老爹被并进儿子荀玫），且被吞一方在库里彻底消失。
 *
 * 修法**不是**去扩充黑名单（永远补不全），而是**数据驱动的冲突检测**：
 * 若某个别名键被 **≥2 个不同的实体**声称，说明它无法指代特定个人 ——
 * 此时**丢弃该别名，而不是用它把两个实体并起来**。
 *
 * 取舍依据（收益不对称）：
 * - 过度合并 → 真实人物静默消失，**不可见**、无人发现；
 * - 合并不足 → 同一人出现两条记录，**可见**、易发现易修。
 * 故**宁可少并，不可错并**。
 *
 * @param input 候选实体与名字频次
 * @returns 归并结果与「键 → 实体下标」映射
 */
export function mergeEntities(input: MergeInput): MergeOutcome {
  const unionFind = new UnionFind();
  const rejectedAliases: string[] = [];
  const conflictingAliases: string[] = [];
  const conflictingAliasKeys = new Set<string>();
  // 批次 26B：冲突别名的声称者（`别名 → [规范名]`）。用 Map 收集，最后 `Object.fromEntries`
  // 转成普通对象 —— `fromEntries` 走 `CreateDataProperty`，别名即使叫 `__proto__` 也只成为
  // **自有属性**，不会污染原型（用 `obj[key] = …` 就会）。
  const conflictingAliasOwners = new Map<string, string[]>();
  const keyToDisplay = new Map<string, string>();
  const keyToType = new Map<string, EntityType>();
  const keyToNameType = new Map<string, NameType>();
  /** 每个候选的成员键 + 它的观测章节（章节在分组时取并集，见下）。 */
  const candidates: { keys: string[]; chapters: readonly number[] }[] = [];

  // 预处理：统计每个别名键被哪些**不同的规范名**声称过。
  // 只统计「通过安全护栏」的别名 —— 已被硬性拒绝的不必再参与冲突判定。
  const aliasOwners = new Map<string, Set<string>>();
  // 批次 26B：`aliasOwners` 存的是**归一化键**，而留档要给人读 → 另记一份键 → 展示形。
  // 同一归一化键可能对应多个展示形（大小写 / 空白差异），取**首次出现**者，
  // 与 `keyToDisplay` 的「谁先出现谁说了算」一致。
  const canonicalDisplay = new Map<string, string>();
  for (const entity of input.entities) {
    const canonicalKey = normalizeName(entity.canonical);
    if (canonicalKey.length === 0) {
      continue;
    }
    if (!canonicalDisplay.has(canonicalKey)) {
      canonicalDisplay.set(canonicalKey, entity.canonical);
    }
    for (const alias of entity.aliases) {
      const aliasKey = normalizeName(alias);
      if (aliasKey.length === 0 || aliasKey === canonicalKey || isUnsafeAlias(aliasKey)) {
        continue;
      }
      const owners = aliasOwners.get(aliasKey) ?? new Set<string>();
      owners.add(canonicalKey);
      aliasOwners.set(aliasKey, owners);
    }
  }

  for (const entity of input.entities) {
    const keys: string[] = [];
    const nameType: NameType = entity.nameType ?? "NAMED";

    const canonicalKey = normalizeName(entity.canonical);
    if (canonicalKey.length > 0) {
      keys.push(canonicalKey);
      if (!keyToDisplay.has(canonicalKey)) {
        keyToDisplay.set(canonicalKey, entity.canonical);
        keyToType.set(canonicalKey, entity.type);
        keyToNameType.set(canonicalKey, nameType);
      }
    }

    for (const alias of entity.aliases) {
      const aliasKey = normalizeName(alias);
      if (aliasKey.length === 0) {
        continue;
      }
      if (isUnsafeAlias(aliasKey)) {
        rejectedAliases.push(alias);
        continue;
      }
      // 冲突别名：被 ≥2 个不同实体声称 → 无区分度 → 丢弃，**不参与 union**。
      if ((aliasOwners.get(aliasKey)?.size ?? 0) > 1) {
        // 去重：同一别名会被 N 个声称者各触发一次，而这里要的是
        // 「有多少个**不同**的别名是无区分度的」——重复计数会让留档数字失去意义。
        if (!conflictingAliasKeys.has(aliasKey)) {
          conflictingAliasKeys.add(aliasKey);
          conflictingAliases.push(alias);
          // 批次 26B：把「谁声称了它」一起留档 —— 这才是 $0 预演 P5 所需的**完整输入**。
          // 排序只为让留档稳定（`Set` 的迭代序依赖插入序，会随分片顺序变）。
          conflictingAliasOwners.set(
            alias,
            [...(aliasOwners.get(aliasKey) ?? [])]
              .map((owner) => canonicalDisplay.get(owner) ?? owner)
              .sort()
          );
        }
        continue;
      }
      keys.push(aliasKey);
      if (!keyToDisplay.has(aliasKey)) {
        keyToDisplay.set(aliasKey, alias);
        keyToType.set(aliasKey, entity.type);
        keyToNameType.set(aliasKey, nameType);
      }
    }

    const head = keys[0];
    if (head !== undefined) {
      for (const key of keys) {
        unionFind.union(head, key);
      }
    }
    candidates.push({ keys, chapters: entity.observedChapters ?? [] });
  }

  // 按并查集根分组。**章节与键一起分组** —— 并集只有在归并之后才算得出来：
  // 归并前「王冕」与「王相公」是两个候选，归并后是同一个实体，
  // 它的观测章节必须是两者之和，否则会误删其中一个写法带来的提及。
  //
  // 抽成函数是因为 N18 归并之后必须**再分一次组**（见下）。
  const groupByRoot = (): Map<string, { keys: Set<string>; chapters: Set<number> }> => {
    const grouped = new Map<string, { keys: Set<string>; chapters: Set<number> }>();
    for (const candidate of candidates) {
      for (const key of candidate.keys) {
        const root = unionFind.find(key);
        const bucket = grouped.get(root) ?? { keys: new Set<string>(), chapters: new Set<number>() };
        bucket.keys.add(key);
        for (const chapter of candidate.chapters) {
          bucket.chapters.add(chapter);
        }
        grouped.set(root, bucket);
      }
    }
    return grouped;
  };

  let groups = groupByRoot();

  // P0 声明类型：缺省为空表，使本函数可独立测试（不依赖词典阶段）。
  const declaredTypes = input.declaredTypes ?? new Map<string, EntityType>();

  // ── N18：LOC 行政后缀白名单归并（`汶上` + `汶上县` 这类「同地双份」）──
  // 放在**分组之后**：规则比的是**规范名**，而规范名要 `pickCanonicalKey`
  // 才算得出来 —— 候选层的 `canonical` 未必是最终规范名。
  const administrativeMerges = mergeAdministrativeSuffixGroups(
    groups,
    unionFind,
    keyToType,
    declaredTypes,
    input.nameFrequency
  );
  if (administrativeMerges > 0) {
    groups = groupByRoot();
  }

  // ── R3：书名号归并（`庄子` + `《庄子》` 这类「同一部作品的两种写法」）──
  // 同样放在分组之后，理由与 N18 相同：规则比的是**规范名**。
  // 类型护栏（只并 CONCEPT）在这里是承重的 —— 见 `mergeBookTitleGroups`。
  const bookTitleMerges = mergeBookTitleGroups(
    groups,
    unionFind,
    keyToType,
    declaredTypes,
    input.nameFrequency
  );
  if (bookTitleMerges > 0) {
    groups = groupByRoot();
  }

  // ── 批次 43：声明式别名组（`贾政` + `政老爷` + `政公` 这类「同一人被逐片抽成多个」）──
  // 放在**最后**：它是对图谱的**人工断言**，应当覆盖上面那些启发式规则的取舍
  // （规则可能因为类型护栏或兄弟数判据而放弃，而人工断言不受那些约束）。
  const declaredAliasMerges = mergeDeclaredAliasGroups(
    groups,
    unionFind,
    input.declaredAliasGroups ?? []
  );
  if (declaredAliasMerges > 0) {
    groups = groupByRoot();
  }

  const entities: MergedEntity[] = [];
  const keyToEntityIndex = new Map<string, number>();

  for (const bucket of groups.values()) {
    const keys = [...bucket.keys];
    const canonicalKey = pickCanonicalKey(keys, input.nameFrequency);
    const canonical = keyToDisplay.get(canonicalKey) ?? canonicalKey;
    const type = pickType(keys, keyToType, declaredTypes);
    // 合取：只要有一个成员键是本名，整体就不是「只有称谓」。
    const nameType: NameType = keys.every((key) => keyToNameType.get(key) === "TITLE_ONLY")
      ? "TITLE_ONLY"
      : "NAMED";

    const index = entities.length;
    const aliases = keys
      .filter((key) => key !== canonicalKey)
      .map((key) => keyToDisplay.get(key) ?? key);

    // 升序去重：章节列表要能被下游直接当集合用，也让输出与 Map 插入顺序无关。
    const observedChapters = [...bucket.chapters].sort((left, right) => left - right);

    entities.push({ canonical, type, nameType, aliases, memberKeys: keys, observedChapters });
    for (const key of keys) {
      keyToEntityIndex.set(key, index);
    }
  }

  return {
    entities,
    rejectedAliases,
    conflictingAliases,
    conflictingAliasOwners: Object.fromEntries(conflictingAliasOwners),
    keyToEntityIndex,
    administrativeMerges,
    bookTitleMerges,
    declaredAliasMerges
  };
}
