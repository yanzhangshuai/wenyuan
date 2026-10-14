/**
 * `segmentit` 的类型补充声明。
 *
 * 背景：`segmentit@2.0.3` 未随包发布 `.d.ts`，直接 import 会触发
 * `noImplicitAny`。此处按实际使用到的 API 面做最小化声明，
 * 避免在业务代码里用 `as` 断言或 `any` 绕过类型检查。
 *
 * 声明范围刻意保持最小 —— 只要用到新的导出，就应在此处补充而不是放宽类型。
 *
 * ---
 *
 * ## 为什么只声明 `dist/esm/segmentit.js` 这一个子路径
 *
 * 包根 `"segmentit"` 在 Node 原生 ESM 下解析到 CJS 产物且**丢失全部具名导出**
 * （详见 `pipeline/tokenizer.ts` 顶部注释）。业务代码已改为直接导入 ESM 产物，
 * 因此这里只需为该子路径提供类型。
 *
 * 刻意**不**在这里声明包根 `"segmentit"`：一旦声明，TS 会认为
 * `import { useDefault } from "segmentit"` 合法，从而掩盖运行时崩溃 ——
 * 这正是本次故障「类型检查通过但线上崩溃」的根源。宁可在编译期就报错。
 */
declare module "segmentit/dist/esm/segmentit.js" {
  /** 分词结果的单个词元。 */
  export interface SegmentToken {
    /** 词面。 */
    w : string;
    /** 词性标注（未启用词性时可能缺失）。 */
    p?: number;
  }

  /** 分词器实例。 */
  export interface Segmenter {
    /**
     * 对文本分词。
     *
     * @param text 待分词文本
     * @param options `simple` 为 true 时只分词不标注词性
     * @returns 词元数组
     */
    doSegment(text: string, options?: { simple?: boolean }): SegmentToken[];

    /**
     * 装载 Module 列表（由 `useDefault` 内部调用）。
     *
     * @param modules Module 实例数组
     */
    use(modules: unknown[]): void;

    /**
     * 加载主词典。
     *
     * 词典文本格式为 `词|词性|词频`（**必须三段**）。
     * 少于三段的行会被**静默忽略**（不报错、不生效），
     * 详见 `analysis/genre-pack/proper-noun-dict.ts`。
     *
     * @param dicts 词典字符串数组；数组会被逐项递归加载
     * @returns 传参同一个实例（便于链式调用）
     */
    loadDict(dicts: string[]): Segmenter;

    /**
     * 加载同义词词典。
     *
     * @param synonyms 同义词词典字符串数组
     */
    loadSynonymDict(synonyms: string[]): void;

    /**
     * 加载停用词词典。
     *
     * @param stopwords 停用词词典字符串数组
     */
    loadStopwordDict(stopwords: string[]): void;
  }

  /** 分词器构造器。 */
  export class Segment implements Segmenter {
    doSegment(text: string, options?: { simple?: boolean }): SegmentToken[];
    use(modules: unknown[]): void;
    loadDict(dicts: string[]): Segmenter;
    loadSynonymDict(synonyms: string[]): void;
    loadStopwordDict(stopwords: string[]): void;
  }

  /**
   * 装入默认词典并返回同一个分词器实例。
   *
   * @param segmentInstance 待初始化的分词器实例（**必传**）
   * @returns 传参同一个实例（便于链式调用）
   */
  export function useDefault(segmentInstance: Segmenter): Segmenter;
}
