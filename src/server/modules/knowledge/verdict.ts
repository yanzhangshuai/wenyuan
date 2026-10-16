import { repairTruncatedJson } from "@/server/modules/analysis/pipeline/repair-json";

import type { KnowledgeConfidence, KnowledgeResolution, KnowledgeVerdict, SearchHit } from "./types";
import type { KnowledgeTarget } from "./types";

/**
 * 判定层的**保守判决**（纯函数，可单测）。
 *
 * 定位（设计文档 §5.4）：外部资料**擅长证伪、不擅长证真**。
 * 它只能产出「疑点」与「置信度」，**不产出事实** —— 因此本模块的职责是
 * 把模型输出**往下压**（宁可 unresolvable，不可编一个值），而不是往上抬。
 *
 * 五条降级规则（全部是单向的）：
 * 1. 无检索命中 → `unresolvable`（连模型都不用调）；
 * 2. JSON 解析失败 → `unresolvable`；
 * 3. 闭集外的 `resolution` / `confidence` → `unresolvable` / `none`；
 * 4. `resolved` 但 `value` 为空 → `unresolvable`；
 * 5. `resolved` 但没有任何**可复核来源**（`used_urls` 为空或全不在命中里）→ `unresolvable`。
 */

const RESOLUTIONS: readonly KnowledgeResolution[] = ["resolved", "disputed", "unresolvable"];
const CONFIDENCES: readonly KnowledgeConfidence[] = ["high", "medium", "low", "none"];

export const KNOWLEDGE_SYSTEM_PROMPT = [
  "你在为一部中文古典小说的**人物实体**整理外部资料。",
  "",
  "铁律（必须遵守）：",
  "1. 只依据**用户给出的检索片段**作答，不得使用你自己的记忆补充任何事实；",
  "2. 资料不足时，必须输出 `unresolvable` —— 这是被允许且被鼓励的终态，**不许猜**；",
  "3. 资料与小说情节可能冲突时（历史人物 vs 文学形象），输出 `disputed` 并说明冲突点；",
  "4. `used_urls` 只能填写检索片段里出现过的 URL，**一个都不许编**；",
  "5. 外部资料只用于**标注**，绝不改写图谱。",
  "",
  "只输出 JSON，不要任何解释性文字：",
  '{"resolution":"resolved|disputed|unresolvable","confidence":"high|medium|low|none",',
  ' "value":"补出的内容（unresolvable 时写 null）","used_urls":["..."],"rationale":"一句话理由"}'
].join("\n");

/** 组装单次判定的用户消息（检索片段截断，避免超长）。 */
export function buildKnowledgeUserPrompt(
  target: KnowledgeTarget,
  hits: readonly SearchHit[],
  options: { maxHits?: number; maxCharsPerHit?: number } = {}
): string {
  const maxHits = options.maxHits ?? 5;
  const maxChars = options.maxCharsPerHit ?? 1200;
  const blocks = hits.slice(0, maxHits).map((hit, index) => {
    const body = (hit.content ?? hit.snippet).slice(0, maxChars);
    return `[${String(index + 1)}] ${hit.title}\nURL: ${hit.url}\n正文: ${body}`;
  });
  const ask =
    target.field === "canonical_name"
      ? "任务：判断这些资料能否确定该人物的**本名**（原文只用了称谓）。若能，value 写本名。"
      : [
          "任务：从资料中提取**原文没有的背景信息**，value 用一句话概括（≤60 字）。",
          "可取的维度（有哪个取哪个，都没有则 unresolvable）：",
          "① 身份定位与亲属关系（如「贾琏之妻，贾府实际管家」）；",
          "② 文学评价/人物形象（如「金陵十二钗正册第九位」）；",
          "③ 历史原型或作者意图；④ 籍贯 / 字号。",
          "⚠️ 虚构人物没有籍贯字号是正常的 —— 只要资料能支撑①或②，就判 resolved，不要因此判 unresolvable。"
        ].join("\n");
  return [
    `作品：《${target.bookTitle}》`,
    `实体（图谱规范名）：${target.subjectKey}`,
    `字段：${target.field}`,
    ask,
    "",
    "检索片段：",
    blocks.length > 0 ? blocks.join("\n\n") : "（无命中）"
  ].join("\n");
}

/** 解析并**向下压**模型输出。 */
export function parseKnowledgeVerdict(rawText: string, hits: readonly SearchHit[]): KnowledgeVerdict {
  if (hits.length === 0) {
    return {
      resolution: "unresolvable",
      confidence: "none",
      value     : null,
      sourceUrls: [],
      rationale : "检索无命中"
    };
  }

  const repaired = repairTruncatedJson(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(repaired.text);
  } catch {
    return {
      resolution: "unresolvable",
      confidence: "none",
      value     : null,
      sourceUrls: [],
      rationale : "模型输出不是合法 JSON"
    };
  }

  if (parsed === null || typeof parsed !== "object") {
    return { resolution: "unresolvable", confidence: "none", value: null, sourceUrls: [], rationale: "输出形状非法" };
  }
  const record = parsed as Record<string, unknown>;

  const resolution = RESOLUTIONS.includes(record.resolution as KnowledgeResolution)
    ? (record.resolution as KnowledgeResolution)
    : "unresolvable";
  const confidence = CONFIDENCES.includes(record.confidence as KnowledgeConfidence)
    ? (record.confidence as KnowledgeConfidence)
    : "none";
  const value = typeof record.value === "string" && record.value.trim().length > 0 ? record.value.trim() : null;
  const rationale = typeof record.rationale === "string" ? record.rationale : "";

  // 来源必须来自本次命中（不许编 URL）。
  const allowed = new Set(hits.map((hit) => hit.url));
  const rawUrls = Array.isArray(record.used_urls) ? record.used_urls : [];
  const sourceUrls = rawUrls.filter((url): url is string => typeof url === "string" && allowed.has(url));

  if (resolution === "resolved" && value === null) {
    return { resolution: "unresolvable", confidence: "none", value: null, sourceUrls, rationale: `判 resolved 但无值；${rationale}` };
  }
  if (resolution === "resolved" && sourceUrls.length === 0) {
    // ⚠️ 这里**不能**降成 unresolvable（批 84 实测教训）：
    // 「模型没写 used_urls」≠「查不到」—— 降成 unresolvable 会把**查得到的对象缓存成查不到**，
    // 后续运行直接跳过，永远修不回来。正确做法：保留值、置信度降为 low，
    // 来源回落为**本次检索命中的前若干条**（出处仍然可复核）。
    return {
      resolution: "resolved",
      confidence: "low",
      value,
      sourceUrls: hits.slice(0, 3).map((hit) => hit.url),
      rationale : `模型未指明具体来源，已按本次命中留档；${rationale}`
    };
  }

  return { resolution, confidence, value, sourceUrls, rationale };
}
