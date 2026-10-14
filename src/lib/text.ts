/**
 * 文本归一化（跨层共享的纯函数）。
 *
 * 关键约束：`normalizeName()` 是**唯一**的名字等价判定实现，
 * 必须同时被以下三处使用，任何一处偏离都会导致归并或评测口径不一致：
 * 1. 落库：`entities.normalized_name` / `entity_aliases.normalized_alias` / `entity_mentions.normalized_surface`
 * 2. 归并：Union-Find 的键
 * 3. 评测：`scripts/eval` 的 gold 与 extracted 比较
 *
 * 本文件不得引入数据库、React 或 Node 专属依赖，以便浏览器与服务端共用。
 */

/**
 * 名字归一化：NFKC 折叠全角字符 → 去除全部空白（含全角空格）→ 小写折叠。
 *
 * 设计原因：
 * - v1 仅去空白，导致「ＡＢＣ」与「ABC」、「Darcy」与「darcy」被判为不同实体；
 * - NFKC 同时处理全角字母/数字与 CJK 兼容字符，是覆盖中文古典文本的稳妥选择；
 * - 去除**全部**空白而非仅首尾，使「司马 光」与「司马光」归为同一实体。
 *
 * @param value 原始名字
 * @returns 归一化后的比较键；空输入返回空串
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, "")
    .toLowerCase();
}

/**
 * 归一化并保留可读性的展示用裁剪：折叠连续空白为单个半角空格。
 *
 * 用途：错误提示、日志与调试输出 —— 这些场景需要保留可读性，
 * 不能使用会把空白全部删除的 `normalizeName()`。
 *
 * @param value 原始文本
 * @returns 首尾去空白、内部连续空白折叠为单空格的文本
 */
export function collapseWhitespace(value: string): string {
  return value.normalize("NFKC").replace(/[\s\u3000]+/g, " ").trim();
}
