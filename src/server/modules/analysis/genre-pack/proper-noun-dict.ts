import type { WorkPack } from "./types";

/**
 * 作品层专名词典的**通用**校验与渲染。
 *
 * 这两个函数刻意与具体的作品包解耦（接收 `WorkPack`／条目数组而非读模块常量），
 * 这样新增作品时**不需要复制这段逻辑**，也不需要改这里的任何一行 ——
 * 这正是「作品层可插拔」的最低要求。
 */

/** 词典条目：`[写法, 词性码]`。 */
type DictEntry = readonly [surface: string, postag: number];

/**
 * 找出互为前缀的词典条目。
 *
 * ## 为什么禁止前缀包含
 *
 * `segmentit` 按 DAG 最大匹配切词，**词元数打平时优先取较短的那个候选**。
 * 因此若词典里同时存在 `杨执` 与 `杨执中`，实际切分结果是：
 *
 * ```
 * 杨执中道 → 杨执 | 中道        （❌ 错，且「中道」还被当成实词）
 * ```
 * 而只剩 `杨执中` 时才是正确的：
 * ```
 * 杨执中道 → 杨执中 | 道        （✅ 对）
 * ```
 *
 * 这个坑的隐蔽之处在于：**短条目本身看着「也是一个合法写法」，加进去不报错，
 * 却会静默破坏长条目的切分**。故此处用程序化校验把它变成硬约束，
 * 而不是靠人记住。
 *
 * ## ⚠️ 本检查是**保守的**（实测界定，2026-10-10，`_wb_n13_mech.ts` / `_wb_n13_freq.ts`）
 *
 * 「是前缀」是**危险的充分条件，不是必要条件**。实测把这条边界钉死了：
 *
 * - **危险条件**：去掉短前缀后的**余部能与后续字吞成一个词元**，使
 *   `短|余部` 与 `长|后续` 两条路径**词元数打平** → 打平时取短词 → 破坏。
 *   `杨执中` 的余部是 `中`，而 `中道`／`中的`／`中间` 都是词元 → 在 `道/的/间` 前**必坏**；
 * - **被冤枉的**（同频下**本来就正确**）：`周瑞 ⊂ 周瑞家的`、`林之孝 ⊂ 林之孝家的`、
 *   `赖大 ⊂ 赖大家的`、`吴新登 ⊂ 吴新登媳妇` —— 它们的余部是 `家的`／`媳妇`，
 *   无法把后续字吞成一个词元，所以不构成打平；
 * - **与词频无关**：把长条目的词频从 1 提到 `1e8`（5 组组合）**全部照样被破坏** ——
 *   所以「给包格式加 per-entry 频次」**解决不了**这个问题（N13 原假设由此证伪）。
 *
 * 之所以仍按「凡前缀即拒」执行：精确判据依赖**上下文**，静态化会**误报**
 * （实测 `宝玉道` 会被误判为危险，实际安全）。本项目对词典的取向是
 * **宁缺毋滥**（错收比漏收更难排查），故保留这条保守边界，
 * 代价是需要成对写法时只能二选一 —— 但要知道那是**守卫的选择**，不是切分器的限制。
 *
 * @param entries 词典条目
 * @returns 冲突对 `[前缀, 被前缀包含的较长词]` 列表；无冲突时为空数组
 */
export function findPrefixConflicts(entries: readonly DictEntry[]): [short: string, long: string][] {
  const conflicts: [string, string][] = [];
  for (const [short] of entries) {
    for (const [long] of entries) {
      if (short !== long && long.startsWith(short)) {
        conflicts.push([short, long]);
      }
    }
  }
  return conflicts;
}

/**
 * 渲染为 `segmentit` 可用的词典文本。
 *
 * 输出格式严格为 `词|词性|词频`（**三段**）——
 * 少于三段会被 `loadDict` 静默忽略，这是本模块最需要注意的陷阱。
 *
 * ⚠️ 词频取自 `pack.properNounFrequency`（统一值），不是写死的常量 ——
 * 换作品包时词频可以不同，但**同一部书内必须一致**，
 * 否则长词与短词的优先级会随条目漂移。
 *
 * @param pack 作品包
 * @returns 每行一个词典条目的文本
 * @throws 当存在前缀冲突时抛错（前缀冲突会静默破坏长词切分，见 `findPrefixConflicts`）
 */
export function renderSegmentitDict(pack: WorkPack): string {
  const conflicts = findPrefixConflicts(pack.properNouns);
  if (conflicts.length > 0) {
    const detail = conflicts
      .map(([short, long]) => `「${short}」是「${long}」的前缀`)
      .join("；");
    throw new Error(
      `专名词典存在前缀冲突，会静默破坏长词切分：${detail}。` +
        "请删除较短的那条 —— 同词频下 segmentit 会优先取短词。"
    );
  }

  return pack.properNouns
    .map(([surface, postag]) => `${surface}|${String(postag)}|${String(pack.properNounFrequency)}`)
    .join("\n");
}
