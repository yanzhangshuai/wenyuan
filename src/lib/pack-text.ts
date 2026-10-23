/**
 * 「解析条件」文本框的格式解析与回填（纯函数，零依赖）。
 *
 * ## 为什么单独成文件
 *
 * 这四个函数被两个地方用：客户端编辑器（`pack-editor.tsx`）负责展示与解析，
 * 服务端保存接口负责清洗。放进组件文件会让服务端 import 到一个 `"use client"` 模块，
 * 单测也得拉起整个 React 环境才能测一行字符串解析。
 */

/** 专名条目。`postag` 128=人名 / 64=地名。 */
export interface PackNoun {
  name  : string;
  postag: number;
}

/**
 * 专名文本 → 数组。
 *
 * 格式：每行一个名字；地名写成 `名字,64`（也认全角逗号）。
 * 只有明确写 `64` 才当地名，其它一律按人名 —— 分词层面两者等价，
 * 区别只在后续闸门的类型判定，默认取更常见的那个。
 */
export function parseNounsText(text: string): PackNoun[] {
  const result: PackNoun[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const [namePart, tagPart] = line.split(/[,，]/u);
    const name = (namePart ?? "").trim();
    if (name.length === 0) continue;
    const tag = (tagPart ?? "").trim();
    result.push({ name, postag: tag === "64" ? 64 : 128 });
  }
  return result;
}

/** 别名组文本 → 数组。每行 `甲 = 乙 = 丙`（`=` 与 `＝` 都认），单元素行丢弃。 */
export function parseGroupsText(text: string): string[][] {
  const groups: string[][] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const members = line
      .split(/[=＝]/u)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (members.length < 2) continue;
    groups.push([...new Set(members)]);
  }
  return groups;
}

/** 数组 → 文本（保存后回填，与 `parseNounsText` 互为逆运算）。 */
export function formatNounsText(items: readonly PackNoun[]): string {
  return items.map((item) => (item.postag === 64 ? `${item.name},64` : item.name)).join("\n");
}

/** 数组 → 文本（与 `parseGroupsText` 互为逆运算）。 */
export function formatGroupsText(groups: readonly (readonly string[])[]): string {
  return groups.map((group) => group.join(" = ")).join("\n");
}
