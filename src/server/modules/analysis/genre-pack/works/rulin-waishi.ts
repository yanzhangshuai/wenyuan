/**
 * 中国古典小说**专名词典**（供 `segmentit` 的 `loadDict` 注入）。
 *
 * ## 为什么需要这个文件
 *
 * `segmentit` 自带的是**现代汉语词典**，其中几乎没有古典小说的专名。
 * 实测《儒林外史》真实语料，默认词典的切分结果是错的：
 *
 * | 正确专名 | 默认切分 | 症状 |
 * | --- | --- | --- |
 * | 杜少卿 | `杜少` + `卿道` | 截断，还吞掉了下一个字 |
 * | 马纯上 | `马纯` + `上` | 截断 |
 * | 蘧公孙 | `蘧` + `公孙` | 过切为两段 |
 * | 牛布衣 | `牛` + `布衣` | 过切为两段 |
 * | 范进 | `范进进` | 吞掉后一个「进」（进学） |
 *
 * 这类错误的**后果不只是切分难看**：截断后的 `杜少` 会作为独立候选名进入词典锚点，
 * 再被注入提示词，污染整条解析链路。所以必须在 P0 分词阶段就修正，
 * 不能指望后续模块补救 —— 后面的模块拿到的已经是错误输入了。
 *
 * ## 词典格式（**必须三段**，实测自 `dist/esm/segmentit.js` 的 `loadDict`）
 *
 * ```
 * 词|词性|词频
 * ```
 *
 * 源码依据（`loadDict` 内）：
 * ```js
 * var blocks = line.split('|');
 * if (blocks.length > 2) {          // ← 少于 3 段整行被静默忽略
 *   var w = blocks[0].trim();       // 词
 *   var p = Number(blocks[1]);      // 词性（注意是第 2 段）
 *   var f = Number(blocks[2]);      // 词频（注意是第 3 段）
 *   TABLE[w] = { f: f, p: p };
 * }
 * ```
 *
 * ⚠️ **两个静默失败陷阱**（都已实测确认，并由单测钉死）：
 * ① 只写两段（如 `杜少卿|128`）→ **整行被忽略，注入无效、且不报错**；
 * ② 把词性和词频写反 → 不报错，但词性码变成词频，`isAllowedPostag` 会全部拒收。
 *
 * ## 词性码取值
 *
 * 统一使用 `128`（`A_NR`，人名）或 `64`（`A_NS`，地名），
 * 使这些专名能直接通过 `dictionary.ts` 的 `isAllowedPostag` 准入判定。
 *
 * ## 词频取值
 *
 * 词频越大，该词在分词时的切分优先级越高。此处统一给 `100000`（远高于
 * `segmentit` 内置词表量级），确保**只要文本里出现了这些专名，就一定按整词切出**，
 * 不被现代汉语词典拆开。
 *
 * ## 维护约定
 *
 * ⚠️ **本文件是「作品层」，不是「题材层」。**
 * 这里的词只对**《儒林外史》这一部书**成立（「周进」「严监生」「高要县」…）。
 * 题材层（`classical/lexicon.ts`）装的是「古典白话小说里哪些字是官职后缀」这类
 * 对**一层文体**都成立的规则。两者混在一起的话，下一部书会带着本书的人名进分词词典。
 *
 * - **只收真实专名**，不要收「先生」「老爷」这类泛称（那是题材层 `STOP_WORDS` 的职责）；
 * - 收录标准：该写法在原著中**确实作为人物/地点的指称出现**。
 *   不确定的宁可不收 —— 错收会让分词把普通词粘成专名，比漏收更难排查；
 * - 新增作品时**另开一个文件**（`works/<作品>.ts`），不要往这里追加。
 */

import type { WorkPack } from "../types";

/** 词典条目：`[写法, 词性码]`。词频由 `DICT_FREQUENCY` 统一提供。 */
type DictEntry = readonly [surface: string, postag: number];

/** 统一词频：足够高，保证整词切分优先级压过内置词典。 */
const DICT_FREQUENCY = 100000;

/** 词性码（与 `segmentit.POSTAG` 对齐）。 */
const POSTAG_PERSON = 128;
const POSTAG_PLACE = 64;

/**
 * 《儒林外史》人物专名。
 *
 * 收录依据：吴敬梓《儒林外史》原著中的主要与次要人物本名、字、号、常用称谓。
 * 该书的叙事特点是「一人可有多名」（本名/字/号/官称并用），
 * 且大量人物以「姓+排行」或「姓+身份」称呼，故一并收录常见形态。
 */
const RU_LIN_WAI_SHI_PERSONS: readonly DictEntry[] = [
  // —— 主线人物 ——
  ["周进", POSTAG_PERSON],
  ["范进", POSTAG_PERSON],
  ["严监生", POSTAG_PERSON],
  ["严贡生", POSTAG_PERSON],
  ["严致中", POSTAG_PERSON],
  ["严致和", POSTAG_PERSON],
  ["杜少卿", POSTAG_PERSON],
  ["杜仪", POSTAG_PERSON],
  ["匡超人", POSTAG_PERSON],
  ["匡迥", POSTAG_PERSON],
  ["马纯上", POSTAG_PERSON],
  ["马二先生", POSTAG_PERSON],
  ["蘧公孙", POSTAG_PERSON],
  ["蘧来旬", POSTAG_PERSON],
  ["牛布衣", POSTAG_PERSON],
  ["牛浦郎", POSTAG_PERSON],
  ["鲍文卿", POSTAG_PERSON],
  ["鲍廷玺", POSTAG_PERSON],
  ["虞育德", POSTAG_PERSON],
  ["虞博士", POSTAG_PERSON],
  ["庄尚志", POSTAG_PERSON],
  ["庄征君", POSTAG_PERSON],
  ["迟衡山", POSTAG_PERSON],
  ["萧云仙", POSTAG_PERSON],
  ["郭孝子", POSTAG_PERSON],
  ["杨执中", POSTAG_PERSON],
  ["权勿用", POSTAG_PERSON],
  ["张铁臂", POSTAG_PERSON],
  ["娄三公子", POSTAG_PERSON],
  ["娄四公子", POSTAG_PERSON],
  ["鲁编修", POSTAG_PERSON],
  ["鲁小姐", POSTAG_PERSON],
  ["蘧駪夫", POSTAG_PERSON],
  ["景兰江", POSTAG_PERSON],
  ["赵雪斋", POSTAG_PERSON],
  ["支剑峰", POSTAG_PERSON],
  ["浦墨卿", POSTAG_PERSON],
  ["诸葛天申", POSTAG_PERSON],
  ["季苇萧", POSTAG_PERSON],
  ["季恬逸", POSTAG_PERSON],
  ["陈木南", POSTAG_PERSON],
  ["余大先生", POSTAG_PERSON],
  ["余二先生", POSTAG_PERSON],
  ["余有达", POSTAG_PERSON],
  ["余有重", POSTAG_PERSON],
  ["王玉辉", POSTAG_PERSON],
  ["沈琼枝", POSTAG_PERSON],
  ["沈大脚", POSTAG_PERSON],
  ["汤镇台", POSTAG_PERSON],
  ["汤奏", POSTAG_PERSON],
  ["汤六老爷", POSTAG_PERSON],
  ["虞华轩", POSTAG_PERSON],
  ["万中书", POSTAG_PERSON],
  ["秦中书", POSTAG_PERSON],
  ["高翰林", POSTAG_PERSON],
  ["施御史", POSTAG_PERSON],
  ["荀玫", POSTAG_PERSON],
  ["王惠", POSTAG_PERSON],
  ["梅玖", POSTAG_PERSON],
  ["魏好古", POSTAG_PERSON],
  ["周司业", POSTAG_PERSON],
  ["胡屠户", POSTAG_PERSON],
  ["胡三公子", POSTAG_PERSON],
  ["潘三", POSTAG_PERSON],
  ["潘自业", POSTAG_PERSON],
  ["赵大", POSTAG_PERSON],
  ["王冕", POSTAG_PERSON],
  ["王孝廉", POSTAG_PERSON],
  ["丁言志", POSTAG_PERSON],
  ["陈和甫", POSTAG_PERSON],
  ["邹吉甫", POSTAG_PERSON],
  ["卜诚", POSTAG_PERSON],
  ["卜信", POSTAG_PERSON],
  ["洪憨仙", POSTAG_PERSON],
  ["胡缜", POSTAG_PERSON],
  ["唐二棒椎", POSTAG_PERSON],
  ["唐三痰", POSTAG_PERSON],
  ["龙三", POSTAG_PERSON],
  ["尤胡子", POSTAG_PERSON],
  ["牛玉圃", POSTAG_PERSON],
  ["石老鼠", POSTAG_PERSON],
  ["徐九公子", POSTAG_PERSON],
  ["姚五爷", POSTAG_PERSON],
  ["萧昊轩", POSTAG_PERSON],
  ["平少保", POSTAG_PERSON],
  ["木耐", POSTAG_PERSON],
  ["朱文公", POSTAG_PERSON],
  ["虞梁", POSTAG_PERSON],
  ["康大人", POSTAG_PERSON],
  // ── 批次 33 / 37：**策展新增**（**23** 条人名）──────────────────────────────
  // 来源：`scripts/curate-work-pack.ts --spend`（儒林 top-300；批 33 付费 $0.0057）。
  // 采纳清单：`_wb_curation_rulin_run2_safe.json`（118 + 25 = **143 条 / 0 前缀冲突**）。
  // ⚠️ 这些走的是 `accepted` 桶（**已过幻觉护栏**：名字必须在候选表或回目里逐字出现），
  //    不是无法验伪的 `supplied` 桶。
  // ⚠️ 批 33 采纳 25 条，**批 37 开跑前撤下 1 条**（`王太`，理由见下方原位注释）→ 本区块 23 条 + 地名 1 条。
  ["少卿", POSTAG_PERSON],
  ["凤四老爹", POSTAG_PERSON],
  ["杜慎卿", POSTAG_PERSON],
  ["慎卿", POSTAG_PERSON],
  ["韦四太爷", POSTAG_PERSON],
  ["金东崖", POSTAG_PERSON],
  ["武书", POSTAG_PERSON],
  ["王胡子", POSTAG_PERSON],
  ["成老爹", POSTAG_PERSON],
  ["庄绍光", POSTAG_PERSON],
  // 🚨 批次 37 **撤下** `王太`（批 33 曾采纳）：它是 `王太太`(20) / `王太守`(25) / `王太爷`(8)
  //    的**严格前缀**，而这三者是**另外的人**（王太太＝鲍廷玺之妻；王太守/王太爷＝王惠）。
  //    词典里有 `王太` → 分词器把 `王太太` 切成 `王太|太` → 三者**全部从候选表消失**
  //    （实测 `_wb_batch37_input_delta.out`），且 `王太` 频次被抬到 63（混了三个所指）
  //    → 在 P5 里会凭频次抢走规范名 → **错并风险**（宁可少并，不可错并）。
  //    🚨 `findPrefixConflicts` **看不见**这一类：它只比**包内**条目，而 `王太太` 不在包里。
  //    撤下**无召回损失**：棋手「王太」本来就能从正文抽出（基线图谱里已是实体，3 次提及）。
  ["萧金铉", POSTAG_PERSON],
  ["聘娘", POSTAG_PERSON],
  ["鲍廷奎", POSTAG_PERSON],
  ["迟均", POSTAG_PERSON],
  ["陈正公", POSTAG_PERSON],
  ["郭铁笔", POSTAG_PERSON],
  ["倪老爹", POSTAG_PERSON],
  ["武正字", POSTAG_PERSON],
  ["蘧太守", POSTAG_PERSON],
  ["秦二侉子", POSTAG_PERSON],
  ["向知县", POSTAG_PERSON],
  ["赵氏", POSTAG_PERSON],
  ["秦老", POSTAG_PERSON]
];

/** 《儒林外史》地点专名。 */
const RU_LIN_WAI_SHI_PLACES: readonly DictEntry[] = [
  ["芜湖", POSTAG_PLACE],
  ["南京", POSTAG_PLACE],
  ["杭州", POSTAG_PLACE],
  ["西湖", POSTAG_PLACE],
  ["扬州", POSTAG_PLACE],
  ["苏州", POSTAG_PLACE],
  ["汶上", POSTAG_PLACE],
  ["兖州", POSTAG_PLACE],
  ["青枫城", POSTAG_PLACE],
  ["五河县", POSTAG_PLACE],
  ["安东县", POSTAG_PLACE],
  ["天长县", POSTAG_PLACE],
  ["高要县", POSTAG_PLACE],
  ["雨花台", POSTAG_PLACE],
  ["莫愁湖", POSTAG_PLACE],
  // ⚠️ 批 37 异文修正：词典原写 `玄武湖`，而**正文实际写法是 `元武湖`**
  //    （避康熙讳；正文 **7** 次，`玄武湖` 正文/回目 **0** 次 —— 实测见 `_wb_batch37_dead_probe.out`）。
  ["元武湖", POSTAG_PLACE],
  ["清凉山", POSTAG_PLACE],
  ["泰山", POSTAG_PLACE],
  ["瞻园", POSTAG_PLACE],
  ["莺脰湖", POSTAG_PLACE],
  ["鸡鸣寺", POSTAG_PLACE],
  ["报恩寺", POSTAG_PLACE],
  // ── 批次 33：策展新增（1 条地名）──
  ["浙江", POSTAG_PLACE]
];

/** 全部专名条目（本书汇总）。 */
export const RU_LIN_WAI_SHI_ENTRIES: readonly DictEntry[] = [
  ...RU_LIN_WAI_SHI_PERSONS,
  ...RU_LIN_WAI_SHI_PLACES
];

/**
 * **同一人的别名组**（批次 44）。
 *
 * 组内名字指同一实体 → P5 归并时**无条件 union**（绕过冲突别名护栏）。
 * 机制与证据见 `rulin-waishi.aliases.json` 的 `_note`（**那才是真源**）。
 *
 * ## 实测效果（`_wb_aliasgroup_sim.ts --only 儒林外史`，$0 确定性预演，儒林 1-3）
 * **6 组生效**、6 组 no-op；实体 FP **2 → 0**（`秦致` + `顾二哥` 双双消失）、关系 **TP 10→11 / FP 7→6 / FN 12→11**
 * → **关系 F1 51.28 → 56.41（+5.13，远超关系本底 0.12）**、实体 F1 88.11 → **89.36**（⚠️ **仍在实体本底 6.83 内**）。
 *
 * ## ⚠️ 这是生成产物，不要手改
 * 改 `rulin-waishi.aliases.json` 再跑 `build-work-pack.ts --aliases … --check`。
 */
export const RU_LIN_WAI_SHI_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["周进", "周学道"],
  ["范进", "范举人"],
  ["庄尚志", "庄征君", "庄绍光"],
  ["马纯上", "马二先生", "马静纯上"],
  ["武书", "武正字"],
  ["向鼎", "向知县", "向知府"],
  ["张静斋", "张乡绅"],
  ["潘自业", "潘三爷"],
  ["杜慎卿", "慎卿"],
  ["苗而秀", "苗镇台"],
  ["顾小舍人", "顾二哥"],
  ["秦老", "秦致"]
];

/** 《儒林外史》作品包。 */
export const RU_LIN_WAI_SHI_WORK_PACK: WorkPack = {
  id                 : "rulin-waishi",
  label              : "《儒林外史》",
  properNouns        : RU_LIN_WAI_SHI_ENTRIES,
  properNounFrequency: DICT_FREQUENCY,
  aliasGroups        : RU_LIN_WAI_SHI_ALIAS_GROUPS
};
