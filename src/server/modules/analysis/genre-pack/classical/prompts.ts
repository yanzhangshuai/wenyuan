import type { RelationTypeDefinition } from "@/lib/relations";

import type { PromptKnowledge } from "../types";

/**
 * 古典白话中文题材包 —— 提示词片段。
 *
 * ## 这一层为什么值钱（对应缺陷一「token 消耗大」）
 *
 * v1 的问题 —— `extractor.ts` 每次调用都重新拼装一段冗长的「领域知识 + 全部关系类型
 * 说明 + 大量正反例」，每片约 35K token 且**内容完全不变**。这导致：
 * 1. 输入 token 被同一段静态文本反复计费；
 * 2. 长系统提示挤压了正文的可读长度，模型注意力被稀释。
 *
 * v3 的解法：
 * 1. 提示词极简 —— 只保留「任务 + 输出格式 + 候选词典」，静态部分压到千字以内；
 * 2. 利用前缀缓存 —— 系统提示在连续调用间保持**逐字节一致**（不含任何分片变量），
 *    使供应商的 prompt caching 能够命中；
 * 3. 关系码说明由**题材包自己的** `relationTypes` 程序化生成，
 *    杜绝手写清单与代码漂移 —— 这也是关系目录能整表进包的依据之一。
 *
 * ⚠️ **换题材包时不得越界（C3）**：改提示词文本不改变调用点的位置与数量。
 * 这里可以改「怎么问」，但不能改「问几次、在哪问」。
 */

/** 关系码说明（由代码生成，避免与关系目录漂移）。 */
function renderRelationCodes(relationTypes: readonly RelationTypeDefinition[]): string {
  return relationTypes
    .map((item) => {
      const direction = item.direction === "SYMMETRIC" ? "无向" : "有向";
      return `- ${item.code}（${direction}）：${item.aliases.slice(0, 2).join("、")}`;
    })
    .join("\n");
}

/**
 * P1 提取的系统提示词（常量，可被前缀缓存命中）。
 *
 * 设计要点：
 * - 明确「只输出 JSON」，并要求逐字摘录证据，与 P2 grounding 的字面匹配约束对齐；
 * - 明确要求使用**候选词典中的写法**作为 canonical，降低同一人物的多种写法；
 * - 明示「不要输出代词与泛称」，减轻 P5 归并护栏的负担。
 */
function renderExtractionSystemPrompt(relationTypes: readonly RelationTypeDefinition[]): string {
  return `你是中文小说人物关系抽取引擎。你的唯一任务是从给定的文本片段中抽取实体与人物关系。

## 实体规则
1. 只抽取**具体专名**：人名、地名、机构名、特定的抽象概念名。
2. 严禁抽取代词（他、她、我、其、之）与泛称（大哥、妇人、众人、那人）。
3. canonical 必须是原文中**逐字出现过**的完整写法，不得改写、翻译或补全。
4. aliases 只填原文中真实出现过的其他称呼（如字、号、官职、乳名）；没有则填空数组。
5. type 取值只能是：PERSON、LOCATION、ORGANIZATION、CONCEPT。
6. 若某人物全篇只有称谓没有本名（如"周娘子"），nameType 填 TITLE_ONLY，否则填 NAMED。

## 关系规则
1. 只抽取**明确文本依据**的关系，不得依据常识推测。
2. typeCode 只能取以下之一：
${renderRelationCodes(relationTypes)}
3. quote 必须是原文中**逐字复制**的一句话（10-60 字），能直接支撑该关系。
4. 有向关系（父子、母子、师生、主仆）的 source 为上位/主动方，target 为下位/被动方。
5. 无向关系（兄弟、夫妻、同年、同僚、朋友、仇敌）两端顺序不限。

## 输出格式
只输出一个 JSON 对象，不要任何解释文字、不要 Markdown 代码围栏：
{"entities":[{"canonical":"范进","type":"PERSON","nameType":"NAMED","aliases":["范老爷"]}],"relations":[{"typeCode":"师生","sourceCanonical":"周进","targetCanonical":"范进","quote":"周进道：'贤契……'"}]}

没有可用内容时输出 {"entities":[],"relations":[]}。`;
}

/**
 * P0 词典分类的系统提示词。
 *
 * 用途：把预扫描出的高频名交给小模型判定「是否为可入图谱的实体」，
 * 而不是让提取阶段每片都重新判断一次 —— 这是省 token 的第二个来源。
 */
const DICTIONARY_SYSTEM_PROMPT = `你是中文小说专名筛选器。给定一批高频词，判断每个词是否是值得加入人物图谱的**实体专名**。

判定标准：
- 是实体：具体的人名、地名、机构名、有特定内涵的概念名（如"科举"）。
- 不是实体：普通名词、动词短语、时间词、泛称（如"众人"、"当时"）、分词错误产生的碎词。

type 取值：PERSON、LOCATION、ORGANIZATION、CONCEPT。

只输出 JSON，不要解释与代码围栏：
{"verdicts":[{"name":"范进","accepted":true,"type":"PERSON"},{"name":"如今","accepted":false,"type":"CONCEPT"}]}`;

/**
 * P3 二审的系统提示词 —— **已删除（2026-10-10）**。
 *
 * 原设计（数据路径隔离：二审只看名字清单、不看原文）在纸面上合理，
 * 但实现要求「对每个实体回答三件事」，输出体量 O(名字数)，
 * 在 908 / 1002 个实体、`maxTokens = 8192` 下**必然截断** —— 实测历史上从未成功一次。
 *
 * 实测与决策见 `pipeline/run.ts` 文件头「为什么没有 P3」。
 * 若将来改用**分批**方案，提示词应连同 `reviewSystem` 字段一起恢复。
 */

/** 滚动上下文的体积上限：摘要字符数。与规划「≤300 字摘要」对齐。 */
export const MAX_ROLLING_SUMMARY_CHARS = 300;

/** 滚动上下文中附带的名字数量上限。 */
export const MAX_ROLLING_NAMES = 40;

/**
 * 组装本题材包的提示词知识。
 *
 * 做成函数而非常量对象的原因：关系码说明必须由**本包自己的**关系目录生成。
 * 若写死成常量，换题材包时提示词里的关系码会与实际目录不一致 ——
 * 那正是 v1 手写清单与代码漂移的老毛病。
 *
 * @param relationTypes 本题材包的关系目录
 * @returns 提示词知识
 */
export function buildPromptKnowledge(
  relationTypes: readonly RelationTypeDefinition[]
): PromptKnowledge {
  return {
    extractionSystem      : renderExtractionSystemPrompt(relationTypes),
    dictionarySystem      : DICTIONARY_SYSTEM_PROMPT,
    maxRollingSummaryChars: MAX_ROLLING_SUMMARY_CHARS,
    maxRollingNames       : MAX_ROLLING_NAMES
  };
}
