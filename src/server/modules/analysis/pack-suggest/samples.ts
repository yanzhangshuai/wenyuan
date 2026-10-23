/**
 * 从原文里为某个候选名抽取上下文片段（纯函数，零依赖）。
 *
 * ## 为什么要片段
 *
 * L2 让模型判断「这些名字是不是同一个人」，而模型**不能靠记忆猜**——
 * 它必须看到原文依据。片段的唯一职责就是当**证据**：
 * 「第 3 回里『宝玉』和『宝二爷』出现在同一段对话的上下文里」。
 *
 * ## 为什么是「整句」而不是固定窗口
 *
 * 固定窗口（前后各 25 字）会切断句子，模型看到半句反而更容易误判。
 * 按句末标点切分后取整句，长度上限只是兜底（防止一段里塞进几百字）。
 */

/** 单条片段的长度上限（字符）。 */
const MAX_SAMPLE_CHARS = 80;

/** 句子分隔符（中文句末 + 换行）。 */
const SENTENCE_BOUNDARY = /(?<=[。！？；\n])/u;

/**
 * 抽取包含目标名的句子片段。
 *
 * @param text 章节正文（或全书正文）
 * @param name 候选名（原文写法）
 * @param limit 最多返回几条
 * @returns 片段数组；找不到时返回空数组（调用方据此判断「这名字在原文里没有依据」）
 */
export function extractSamples(text: string, name: string, limit = 3): string[] {
  if (name.length === 0) return [];
  const sentences = text.split(SENTENCE_BOUNDARY);
  const picked: string[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences) {
    if (!sentence.includes(name)) continue;
    const trimmed = sentence.trim();
    if (trimmed.length === 0) continue;
    // 去重：同一句重复出现（如整段重复）只留一条，避免 3 条片段全一样。
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    picked.push(trimmed.length > MAX_SAMPLE_CHARS ? `${trimmed.slice(0, MAX_SAMPLE_CHARS)}…` : trimmed);
    if (picked.length >= limit) break;
  }

  return picked;
}
