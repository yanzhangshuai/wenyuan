/**
 * `segmentit` 2.0.3 的分词封装（P0 阶段使用）。
 *
 * ## 为什么要从 `dist/esm/segmentit.js` 直接导入
 *
 * `segmentit@2.0.3` 的 `package.json` 只有 `"main"` / `"module"` / `"browser"`，
 * **没有 `"exports"` 字段**，且 `"main": "dist/cjs"` 指向的是一个**目录**。
 *
 * 由此产生两条**宿主解析路径不一致**的行为：
 *
 * | 宿主 | 解析依据 | 结果 |
 * | --- | --- | --- |
 * | Vite / vitest | 读 `"module"` → `dist/esm/segmentit.js` | 真 ESM，具名导出齐全 ✅ |
 * | Node 原生 ESM (tsx) | 读 `"main"` → `dist/cjs/index.js`（CJS） | 具名导出**全部丢失** ❌ |
 *
 * Node 侧之所以丢失具名导出：`dist/cjs/index.js` 是
 * `module.exports = require("./segmentit.min.js")`，
 * 而 CJS 具名导出的静态分析（cjs-module-lexer）对**动态 `require()` 转发**无能为力，
 * 只能给出 `default`。于是：
 *
 * ```
 * SyntaxError: The requested module 'segmentit' does not provide an export named 'useDefault'
 * ```
 *
 * 这正是「单测全绿、`pnpm analyze` 崩溃」的原因 —— 属于**宿主解析差异**，
 * 不是业务逻辑缺陷，只能靠端到端跑真实脚本暴露。
 *
 * 直接指向 ESM 产物即可让 Node 与 Vite 走到同一条路径。
 *
 * ## 为什么必须 `useDefault(new Segment())`
 *
 * `useDefault` 的真实实现是：
 * ```js
 * function useDefault(segmentInstance) {
 *   segmentInstance.use(modules);        // ← 需要传入一个 Segment 实例
 *   segmentInstance.loadDict(dicts);
 *   segmentInstance.loadSynonymDict(synonyms);
 *   segmentInstance.loadStopwordDict(stopwords);
 *   return segmentInstance;
 * }
 * ```
 * 省略参数会报 `TypeError: Cannot read properties of undefined (reading 'use')`。
 * 该签名与库自身的 CommonJS 具名导出共用同一实现，故行为一致。
 *
 * ## react-hooks 误报
 *
 * `useDefault` 以 `use` 开头，会被 `react-hooks/rules-of-hooks` 误判为 React Hook，
 * 故导入时即重命名为 `createSegmenter`。
 */
import { Segment, useDefault as createSegmenter } from "segmentit/dist/esm/segmentit.js";

import { UNREGISTERED_WORK_PACK, renderSegmentitDict, type WorkPack } from "../genre-pack";

import type { CandidateName } from "./dictionary";
import { collectCandidateNames } from "./dictionary";

/**
 * 中文分词的薄封装。
 *
 * 设计原因：
 * - 分词库（`segmentit`）体积不小且初始化（加载 5 本词典）有成本，
 *   因此做**进程内缓存**；
 * - 本模块只暴露「章节文本 → 候选名」的领域接口，
 *   不向上层泄漏分词库的类型，使替换分词实现只需改这一个文件。
 */

/**
 * 分词器实例的惰性缓存，**按作品包 id 分桶**。
 *
 * 初始化做两件事：
 * 1. 装入 `segmentit` 默认词典（现代汉语）；
 * 2. **叠加该作品的专名词典**（`genre-pack/works/*`），修正默认词典对古典小说专名的
 *    切分错误（实测「杜少卿」会被切成「杜少/卿道」、「马纯上」切成「马纯/上」）。
 *
 * 第 2 步是必需的而非可选的：截断后的碎片（如「杜少」）会作为独立候选名
 * 进入词典锚点并注入提示词，污染整条解析链路 —— 后续模块拿到的已是错误输入，
 * 无法补救。因此必须在分词阶段修正。
 *
 * ⚠️ **必须按作品包 id 分桶，不能只做一个全局单例。**
 * 曾经的写法是 `segmenter ??= createSegmenter(...)` —— 一个进程内单例。
 * 那样第二本书会**沿用第一本的专名词典**（`loadDict` 只增不减，没有卸载接口）。
 * 这个缺陷在「一次进程只跑一本书」的 CLI 里永远看不出来，
 * 但在 UI（常驻进程）与批处理里必现，且症状是「分词莫名其妙变差」而不是报错。
 */
const segmenters = new Map<string, ReturnType<typeof createSegmenter>>();

/** 获取分词器（首次遇到某个作品包时初始化）。 */
function getSegmenter(workPack: WorkPack): ReturnType<typeof createSegmenter> {
  const cached = segmenters.get(workPack.id);
  if (cached !== undefined) {
    return cached;
  }
  const created = createSegmenter(new Segment()).loadDict([renderSegmentitDict(workPack)]);
  segmenters.set(workPack.id, created);
  return created;
}

/**
 * 对单章文本分词并抽取词元。
 *
 * @param text 章节正文
 * @param workPack 作品包（决定叠加哪份专名词典）；省略时用**未注册兜底**（零专名）
 * @returns `{ word, tag }` 序列（tag 为数字词性码的字符串形式；未标注时为 `""`）
 */
export function segmentChapter(
  text: string,
  workPack: WorkPack = UNREGISTERED_WORK_PACK
): { word: string; tag: string }[] {
  const tokens = getSegmenter(workPack).doSegment(text);
  return tokens.map((token) => ({
    word: token.w,
    tag : token.p === undefined ? "" : String(token.p)
  }));
}

/** 参与预扫描的章节。 */
export interface ScannableChapter {
  ordinal: number;
  text   : string;
}

/**
 * 全书预扫描：分词 + 候选名统计。
 *
 * @param chapters 章节列表
 * @param workPack 作品包（决定叠加哪份专名词典）；省略时用**未注册兜底**（零专名）
 * @returns 按频次降序排列的候选名列表
 *
 * 注意：为控制内存与耗时，这里逐章处理后即丢弃词元序列，
 * 只保留累计的统计结果。
 */
export function scanBookCandidates(
  chapters: readonly ScannableChapter[],
  workPack: WorkPack = UNREGISTERED_WORK_PACK
): CandidateName[] {
  const tokenized = chapters.map((chapter) => ({
    chapterOrdinal: chapter.ordinal,
    words         : segmentChapter(chapter.text, workPack)
  }));
  return collectCandidateNames(tokenized);
}
