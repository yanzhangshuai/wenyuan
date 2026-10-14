import type { RelationTypeDefinition } from "@/lib/relations";

/**
 * 题材包（genre pack）的类型契约。
 *
 * ## 为什么要有这一层
 *
 * 本项目的控制流是**冻结**的：P0–P6 的拓扑、各阶段的输入输出契约、
 * 以及「全流程只有 3 个 LLM 调用点」这三件事**不允许**因为换题材而改变。
 * 能被替换的只有「领域知识」——本文件定义的就是这块知识的形状。
 *
 * 判据（换题材包时**不得越界**的四条）：
 * - **C1** 阶段数量与顺序不变；
 * - **C2** 阶段之间的输入输出契约不变；
 * - **C3** LLM 调用点的**位置与数量**不变（题材包**不得**新增调用点）；
 * - **C4** 确定性阶段（P2 grounding / P4 投票 / P5 归并 / P6 聚合）保持零 LLM 纯函数。
 *
 * ## ⚠️ 必须分三层，不是两层
 *
 * 实测发现的一个层级错位：`proper-nouns.ts` 的注释写着「便于后续扩充到**其他古典小说**」，
 * 但它的内容是**《儒林外史》这一部书**的专名（`周进`／`严监生`／`高要县`…），
 * 并不是「古典中文」这个**题材**的。若把它放进题材包，下一部书
 * （《三国演义》）会带着《儒林外史》的人名进分词词典。
 *
 * 因此分三层：
 *
 * | 层 | 内容 | 例子 |
 * | --- | --- | --- |
 * | **通用层** | 与语言/题材都无关的字面规则 | 单字拒、超长拒、无 CJK 拒 |
 * | **题材层**（本文件的 `GenrePack`） | 一层语言/文体的领域知识 | 官职后缀、尊称词、关系目录、提示词 |
 * | **作品层**（`WorkPack`） | 一部书自己的专名词典 | 《儒林外史》的人名/地名 |
 *
 * 三层之间是**包含**关系：一次解析用「一个题材包 + 一个作品包」。
 */

/** 字面层知识：实体准入闸门与 P0 候选扫描共用的词表。 */
export interface LexiconKnowledge {
  /**
   * 归一化字面长度上限（**闸门**用）。
   *
   * 刻意大于 P0 的 `maxCandidateNameLength`：
   * P0 的 6 是为了控制提示词体积（200 个锚点要短），属于预算约束；
   * 闸门的 12 只是为了拦「分词把整句粘成一个词」的病态产物，属于兜底。
   * 若此处也取 6，会连带砍掉「河南道监察御史」之外的大量真实长专名。
   */
  readonly maxEntityNameLength   : number;
  /** P0 候选扫描的长度上限。 */
  readonly maxCandidateNameLength: number;
  /** P0 候选扫描的最低频次。 */
  readonly minCandidateFrequency : number;
  /** P0 候选清单条数上限。 */
  readonly candidateLimit        : number;

  /**
   * 停用表（**精确匹配**，不是子串）。
   *
   * ⚠️ 匹配语义是整张表的安全边界：只砍**光杆泛称**，
   * 带前缀的具体称呼一律放行（`夫人` 在表内，`王夫人` 不受影响）。
   */
  readonly stopWords: ReadonlySet<string>;

  /**
   * **闸门专用**泛称表（资格词 / 类别词 / 处所泛称），**不进 P0 候选扫描**。
   *
   * ⚠️ 与 `stopWords` 的关键区别：`stopWords` 被 **P0 与闸门共用** ——
   * 改它会同时改动注入 P1 的候选词典（即改了提示词 → 改了 P1 的 LLM 输出），
   * 使改动**无法 $0 预演**。本表**只被 `judgeEntityName` 消费**，
   * 因此加词是**纯 P1 输出侧过滤**，可在现有图谱上精确重放。
   *
   * 匹配语义与 `stopWords` 相同：**精确相等**，不是子串（只砍光杆泛称）。
   */
  readonly gateGenericWords: ReadonlySet<string>;

  /** 官职通名后缀（**必须按长度降序**，保证最长匹配优先）。 */
  readonly officeSuffixes    : readonly string[];
  /** 行政区划／官署的尾字（用于区分「机构」与「以官职为称呼的人」）。 */
  readonly adminTailChars    : ReadonlySet<string>;
  /** 身份／职业称谓后缀（**必须按长度降序**）。 */
  readonly occupationSuffixes: readonly string[];
  /** 尊称词（**必须按长度降序**）。光杆即为泛称。 */
  readonly appellationWords  : readonly string[];
  /** 排行字／泛称前缀字。 */
  readonly rankPrefixChars   : ReadonlySet<string>;
}

/** 提示词片段。 */
export interface PromptKnowledge {
  /**
   * P1 提取的系统提示词。
   *
   * ⚠️ 必须在进程内是**常量**、不得拼入任何分片相关内容 ——
   * 它逐字节一致才能命中供应商的 prompt caching（省 token 的主要来源）。
   */
  readonly extractionSystem      : string;
  /** P0 词典分类的系统提示词。 */
  readonly dictionarySystem      : string;
  /** 滚动上下文摘要的字符数上限。 */
  readonly maxRollingSummaryChars: number;
  /** 滚动上下文中附带的名字数量上限。 */
  readonly maxRollingNames       : number;
  // ⚠️ 原 `reviewSystem`（P3 二审提示词）字段已于 2026-10-10 删除。
  // 删除理由见 `pipeline/run.ts` 文件头「为什么没有 P3」：二审要求逐实体输出判定，
  // 体量 O(名字数)，在 `maxTokens = 8192` 下必然截断，历史上从未成功过一次。
  // 将来若改用**分批**方案让二审真正生效，恢复该字段即可（提示词与 schema 需一并恢复）。
}

/** 流水线阈值。 */
export interface ThresholdKnowledge {
  /** 单片注入提示词的词典锚点条数上限。 */
  readonly sliceAnchorLimit: number;
}

/**
 * 作品层：**某一部书**自己的专名词典。
 *
 * 与题材层的分工：题材层说「古典白话小说里哪些字是官职后缀」，
 * 作品层说「《儒林外史》里有个人叫周进」。
 */
export interface WorkPack {
  readonly id                 : string;
  readonly label              : string;
  /**
   * `segmentit` 词典条目：`[写法, 词性码]`。
   *
   * 词性码统一用 `128`（人名）或 `64`（地名），使这些专名能直接通过
   * `isAllowedPostag` 准入判定。
   */
  readonly properNouns        : readonly (readonly [surface: string, postag: number])[];
  /**
   * 专名词频。远高于 `segmentit` 内置词表量级，
   * 确保只要文本里出现这些专名就**一定按整词切出**。
   *
   * 实测界定（2026-10-10，`_wb_n13_param.ts`）——这个数的**唯一用途是压过内置词典**：
   * - 对**内置词典没有**的名字（`杜少卿`／`马纯上`），频次取 **1** 就已足够；
   * - 对**内置词典已有切法**的词（`老婆子` 会被切成 `老 | 婆子`），频次需 ≥ `1e5` 才能翻转。
   * 两种需求是**同一个**（「专名一律整词」），故**单个数是合适的**，不需要 per-entry 频次。
   * 另注：这个数**不影响**前缀冲突的判定（那由词元数打平决定），见 `proper-noun-dict.ts`。
   */
  readonly properNounFrequency: number;
  /**
   * **同一人/同一物的别名组**：组内名字**指同一个实体**（批次 43 新增）。
   *
   * ## 为什么需要它（这是 P5 归并的结构性缺口）
   *
   * 归并的**唯一实质依据是 P1 逐片填的 `aliases`** —— 那是**局部视角**：
   * 同一人在第 2 回被抽成 `贾政`、在第 3 回被抽成 `政老爷`，两片互不知情，
   * 于是各自声称同一个桥接别名 → 触发 P5 的**冲突别名护栏**（被 ≥2 个规范名声称 → 丢弃）
   * → 共享键消失 → **union 永不发生 → 永久碎片**。
   *
   * 实测代价（红楼 1-3）：**实体 FP 14 条里 8 条、关系 FP 17 条里 12 条**来自这一族
   * （金标注记 §8 亦独立记载同一现象）。
   *
   * 参考项目 AI-Reader-V2 的 `entity_dictionary` **有 `aliases` 字段**
   * （预扫描 Phase 2 由 LLM 做**全书视角**的别名分组）—— 本字段是它的**同构形态**，
   * 只是数据来自**人工策展**而非自动生成（参考项目自认该步准确率仅 45%）。
   *
   * ## 语义（消费方必须照此实现）
   * - 组内名字**指同一实体** → P5 **无条件 union**，**绕过冲突别名护栏**。
   * - ⚠️ **声明即断言**：错的声明会**错并**（批次 18 灾难：`王夫人` 被并进 9 个王爷）。
   *   因此**每一组都必须能回原文逐对辩护**，且必须排除
   *   「夫妻」「父女」这类**两个人都能用同一称谓**的组（如 `周瑞` / `周瑞家的`）。
   * - 缺省 `[]`（或 `undefined`）= **零行为变更**。
   *
   * ## 实测效果（`_wb_aliasgroup_sim.ts`，$0 确定性预演，红楼 1-3）
   * 关系 F1 **51.49 → 66.67（+15.18）**、实体 F1 **86.15 → 88.89（+2.74）**，
   * 且**不变量成立**（新增 FP/FN 全为 0）。儒林 1-3 **0 变化**。
   */
  readonly aliasGroups?       : readonly (readonly string[])[];
}

/** 题材包：一层语言／文体的领域知识。 */
export interface GenrePack {
  readonly id           : string;
  readonly label        : string;
  readonly lexicon      : LexiconKnowledge;
  readonly prompts      : PromptKnowledge;
  readonly thresholds   : ThresholdKnowledge;
  /**
   * 关系类型目录。
   *
   * 默认包的取值即 `@/lib/relations` 的 `RELATION_TYPES`（UI 也依赖它，
   * 因此**不搬移**，只在这里引用）。其他题材包可给出自己的目录。
   *
   * 注意：目录本身**已经是参数化的** —— `voteRelations()` 与
   * `aggregateRelations()` 都把对称关系码集合作为**参数**接收，
   * 且 `schemas.ts` 的 `typeCode` 是 `z.string()` 而非 `z.enum`，
   * 未知码会经 `unknown_relation_code` 降级。因此加关系类型是**数据变更**，不是 DDL。
   */
  readonly relationTypes: readonly RelationTypeDefinition[];
}

/** 一次解析所用的完整领域知识（题材包 + 作品包）。 */
export interface ResolvedPack {
  readonly genre: GenrePack;
  readonly work : WorkPack;
}
