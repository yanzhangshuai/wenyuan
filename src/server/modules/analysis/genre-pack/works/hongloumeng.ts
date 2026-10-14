/**
 * 《红楼梦》**作品层**专名词典。
 *
 * ⚠️ 本文件是「作品层」，不是「题材层」。
 * 这里的词只对**《红楼梦》这一部书**成立。题材层的规则
 * （官职后缀、尊称词、排行字、关系目录、提示词）在 `classical/`，
 * 与本书共用 —— 古典白话小说的称谓体系是一层文体的知识，不该按书复制。
 *
 * ## 这份词典是怎么来的（**批次 38 起：条目清单是生成产物**）
 *
 * ⚠️ **条目清单是「生成产物」，不再是手编源文件**。改它请改**输入**：
 * `works/hongloumeng.curation.json`（已采纳集合）· `hongloumeng.variants.json`（异文映射）
 * · `hongloumeng.withdrawals.json`（撤下表），然后重跑 `scripts/build-work-pack.ts`。
 * **手改会被 `--check` 抓到** —— 它断言「已提交的包 == 生成结果」。
 *
 * ## ⚠️ 诚实说明：红楼的**策展产物仍缺**
 *
 * 儒林走的是完整链（LLM 策展 → 三条审计 → 产物）；红楼**从未跑过** `curate-work-pack.ts`
 * → 本包目前被登记为「**已采纳集合**」（见 `curation.json` 的 `_note`），
 * 因此红楼只能做**固定点检查**。真要兑现「消掉每本新书手工写词典」，红楼需补一次策展跑。
 *
 * ## 批次 38 的审计结果（三条审计）
 *
 * 抓出 **13 条死条目**（原文 = 正文 + 回目，出现 **0** 次）→ **已删**。
 * ⚠️ **删除是行为中性的**：分词器的 DAG 里根本不存在能与它们匹配的子串
 * → 实测**候选表逐条相同**（`_wb_hlm_neutrality.out`，200 → 200）
 * → **图谱不变 → 不需要付费重跑**。
 *
 * 另有 **3 条真异文**（`刘姥姥`→`刘老老` **288** 次 · `蘅芜苑`→`蘅芜院` **19** 次
 * · `赤瑕宫`→`赤霞宫` **2** 次）→ ⚠️ **补它们会改图谱** →
 * 记在 `hongloumeng.variants.json` 的 `_note` 里，**等一次付费重跑**再启用。
 * ⚠️ 自动判读有**假阳性**（`媚人`→`夫人` 是泛称、`张友士`→`张道士` 是**另一个人**）
 * 与**假阴性**（`刘姥姥`→`刘老老` 差 **2** 个字，规则抓不到）→ 所以异文表**必须人工写定**。
 *
 * 收录依据：《红楼梦》前 10 回实际出场的人物／地点，外加后文的主要人物。
 * 宁缺毋滥 —— 错收会把普通词粘成专名，比漏收更难排查。
 *
 * ## ⚠️ 「周瑞」与「周瑞家的」为什么只收了一个（2026-10-10 更正）
 *
 * `proper-noun-dict.ts` 的 `findPrefixConflicts()` 会**抛错**拒绝互为前缀的条目
 * （词元数打平时 segmentit 的 DAG 最大匹配优先取**较短**候选，
 * 短条目会静默破坏长条目的切分）。
 *
 * 于是「本名 + X家的」这类成对写法**在本包里只能二选一**：
 * `周瑞` 与 `周瑞家的`、`林之孝` 与 `林之孝家的` 都会被守卫拒绝。
 *
 * ⚠️ **但这不是切分器的限制**（实测更正，`_wb_n13_mech.ts`）：
 * 把两词同时放进词典，切「周瑞家的进来」得到的是 **`周瑞家的 | 进来`（正确）**，
 * `林之孝家的`／`赖大家的`／`吴新登媳妇` 同样正确。
 * 它们被拒**只因为守卫「凡前缀即拒」是保守的**，不是因为会破坏切分。
 * （真正会破坏的是余部能吞后续字的那类，如 `杨执 ⊂ 杨执中`：切「杨执中道」→ `杨执 | 中道`。）
 *
 * 也**不是因为词频**：把长条目的词频从 1 提到 1e8 也救不了 `杨执中`，
 * 详见 `proper-noun-dict.ts` 的实测界定。本次仍一律收**本名** ——
 * 这是**领域选择**（本名还能靠题材层的词形规则补出称谓，反之不行），
 * 不是被逼的；将来若确实需要收 `周瑞家的`，改守卫的判据即可。
 *
 * ## 维护约定
 *
 * - **只收真实专名**，不要收「老太太」「姨娘」这类泛称（那是题材层 `STOP_WORDS` 的职责）；
 * - 新增作品**另开一个文件**（`works/<作品>.ts`），不要往这里追加；
 * - 加完务必跑一遍 `findPrefixConflicts()` —— 冲突会**抛错**，不是静默。
 */

import type { WorkPack } from "../types";

/** 词典条目：`[写法, 词性码]`。词频由 `DICT_FREQUENCY` 统一提供。 */
type DictEntry = readonly [surface: string, postag: number];

/** 统一词频：足够高，保证整词切分优先级压过内置词典。 */
const DICT_FREQUENCY = 100000;

/** 词性码（与 `segmentit.POSTAG` 对齐）。 */
const POSTAG_PERSON = 128;
const POSTAG_PLACE = 64;

/** 《红楼梦》人物专名。 */
const HONG_LOU_MENG_PERSONS: readonly DictEntry[] = [
  // —— 宝黛钗与贾府核心 ——
  ["贾宝玉", POSTAG_PERSON],
  ["宝玉", POSTAG_PERSON],
  ["林黛玉", POSTAG_PERSON],
  ["黛玉", POSTAG_PERSON],
  ["薛宝钗", POSTAG_PERSON],
  ["宝钗", POSTAG_PERSON],
  ["王熙凤", POSTAG_PERSON],
  ["凤姐", POSTAG_PERSON],
  ["贾母", POSTAG_PERSON],
  ["史太君", POSTAG_PERSON],
  ["贾政", POSTAG_PERSON],
  ["王夫人", POSTAG_PERSON],
  ["邢夫人", POSTAG_PERSON],
  ["贾赦", POSTAG_PERSON],
  ["贾琏", POSTAG_PERSON],
  ["贾珍", POSTAG_PERSON],
  ["尤氏", POSTAG_PERSON],
  ["贾蓉", POSTAG_PERSON],
  ["秦可卿", POSTAG_PERSON],
  ["可卿", POSTAG_PERSON],

  // —— 贾府四春与旁支 ——
  ["贾元春", POSTAG_PERSON],
  ["元春", POSTAG_PERSON],
  ["贾迎春", POSTAG_PERSON],
  ["迎春", POSTAG_PERSON],
  ["探春", POSTAG_PERSON],
  ["惜春", POSTAG_PERSON],
  ["李纨", POSTAG_PERSON],
  ["贾环", POSTAG_PERSON],
  ["贾兰", POSTAG_PERSON],
  ["贾琮", POSTAG_PERSON],
  ["贾芸", POSTAG_PERSON],
  ["贾芹", POSTAG_PERSON],
  ["贾萍", POSTAG_PERSON],
  ["贾蔷", POSTAG_PERSON],
  ["贾菱", POSTAG_PERSON],
  ["贾芝", POSTAG_PERSON],
  ["贾藻", POSTAG_PERSON],
  ["贾芬", POSTAG_PERSON],
  ["贾芳", POSTAG_PERSON],
  ["贾蓝", POSTAG_PERSON],
  ["贾菌", POSTAG_PERSON],
  ["贾瑞", POSTAG_PERSON],
  ["贾璜", POSTAG_PERSON],
  ["璜大奶奶", POSTAG_PERSON],
  ["贾敷", POSTAG_PERSON],
  ["贾敬", POSTAG_PERSON],
  ["贾代儒", POSTAG_PERSON],
  ["贾代善", POSTAG_PERSON],
  ["贾代化", POSTAG_PERSON],

  // —— 女眷与姨娘 ——
  ["赵姨娘", POSTAG_PERSON],
  ["周姨娘", POSTAG_PERSON],
  ["薛姨妈", POSTAG_PERSON],
  ["胡氏", POSTAG_PERSON],
  ["金寡妇", POSTAG_PERSON],
  ["封氏", POSTAG_PERSON],
  ["李嬷嬷", POSTAG_PERSON],
  ["赵嬷嬷", POSTAG_PERSON],
  ["赖嬷嬷", POSTAG_PERSON],

  // —— 薛家、史家、王家、甄家 ——
  ["薛蟠", POSTAG_PERSON],
  ["薛蝌", POSTAG_PERSON],
  ["薛宝琴", POSTAG_PERSON],
  ["史湘云", POSTAG_PERSON],
  ["王子腾", POSTAG_PERSON],
  ["王仁", POSTAG_PERSON],
  ["王成", POSTAG_PERSON],
  ["甄士隐", POSTAG_PERSON],
  ["士隐", POSTAG_PERSON],
  ["英莲", POSTAG_PERSON],
  ["香菱", POSTAG_PERSON],
  ["甄宝玉", POSTAG_PERSON],
  ["娇杏", POSTAG_PERSON],
  ["霍启", POSTAG_PERSON],
  ["贾雨村", POSTAG_PERSON],
  ["雨村", POSTAG_PERSON],
  ["贾化", POSTAG_PERSON],
  ["时飞", POSTAG_PERSON],
  ["冷子兴", POSTAG_PERSON],

  // —— 丫鬟与仆役 ——
  ["袭人", POSTAG_PERSON],
  ["晴雯", POSTAG_PERSON],
  ["紫鹃", POSTAG_PERSON],
  ["鹦哥", POSTAG_PERSON],
  ["雪雁", POSTAG_PERSON],
  ["春纤", POSTAG_PERSON],
  ["鸳鸯", POSTAG_PERSON],
  ["平儿", POSTAG_PERSON],
  ["金钏儿", POSTAG_PERSON],
  ["玉钏儿", POSTAG_PERSON],
  ["麝月", POSTAG_PERSON],
  ["秋纹", POSTAG_PERSON],
  ["碧痕", POSTAG_PERSON],
  ["茜雪", POSTAG_PERSON],
  ["茗烟", POSTAG_PERSON],
  ["焙茗", POSTAG_PERSON],
  ["李贵", POSTAG_PERSON],
  ["扫红", POSTAG_PERSON],
  ["锄药", POSTAG_PERSON],
  ["伴鹤", POSTAG_PERSON],
  ["赖大", POSTAG_PERSON],
  ["赖升", POSTAG_PERSON],
  ["林之孝", POSTAG_PERSON],
  ["周瑞", POSTAG_PERSON],
  ["来旺", POSTAG_PERSON],
  ["旺儿", POSTAG_PERSON],
  ["焦大", POSTAG_PERSON],
  ["倪二", POSTAG_PERSON],

  // —— 亲戚、门客、其他 ——
  ["秦钟", POSTAG_PERSON],
  ["智能儿", POSTAG_PERSON],
  ["妙玉", POSTAG_PERSON],
  ["狗儿", POSTAG_PERSON],
  ["板儿", POSTAG_PERSON],
  ["冯紫英", POSTAG_PERSON],
  ["冯渊", POSTAG_PERSON],
  ["卫若兰", POSTAG_PERSON],
  ["詹光", POSTAG_PERSON],
  ["单聘仁", POSTAG_PERSON],
  ["卜固修", POSTAG_PERSON],
  ["程日兴", POSTAG_PERSON],
  ["胡斯来", POSTAG_PERSON],
  ["张如圭", POSTAG_PERSON],
  ["张太医", POSTAG_PERSON],
  ["金荣", POSTAG_PERSON],
  ["香怜", POSTAG_PERSON],
  ["玉爱", POSTAG_PERSON],
  // ── 批次 40：**异文修正**（三条真异文之一；判读依据 `_wb_hlm_dead_probe.out`，
  //    映射表见 `hongloumeng.variants.json`）—— 正文写 `刘老老` **288** 次、`刘姥姥` **0** 次。
  ["刘老老", POSTAG_PERSON]
];

/** 《红楼梦》地点专名。 */
const HONG_LOU_MENG_PLACES: readonly DictEntry[] = [
  // —— 神话框架 ——
  ["大荒山", POSTAG_PLACE],
  ["无稽崖", POSTAG_PLACE],
  ["青埂峰", POSTAG_PLACE],
  ["太虚幻境", POSTAG_PLACE],
  ["灵河岸", POSTAG_PLACE],
  ["三生石", POSTAG_PLACE],
  ["北邙山", POSTAG_PLACE],

  // —— 姑苏与贾雨村线 ——
  ["姑苏", POSTAG_PLACE],
  ["阊门", POSTAG_PLACE],
  ["十里街", POSTAG_PLACE],
  ["仁清巷", POSTAG_PLACE],
  ["葫芦庙", POSTAG_PLACE],
  ["智通寺", POSTAG_PLACE],
  ["应天府", POSTAG_PLACE],
  ["蟠香寺", POSTAG_PLACE],

  // —— 都中与两府 ——
  ["金陵", POSTAG_PLACE],
  ["南京", POSTAG_PLACE],
  ["扬州", POSTAG_PLACE],
  ["荣国府", POSTAG_PLACE],
  ["宁国府", POSTAG_PLACE],
  ["大观园", POSTAG_PLACE],
  ["会芳园", POSTAG_PLACE],
  ["天香楼", POSTAG_PLACE],
  ["梨香院", POSTAG_PLACE],
  ["绛芸轩", POSTAG_PLACE],

  // —— 园中诸馆 ——
  ["怡红院", POSTAG_PLACE],
  ["潇湘馆", POSTAG_PLACE],
  ["稻香村", POSTAG_PLACE],
  ["秋爽斋", POSTAG_PLACE],
  ["暖香坞", POSTAG_PLACE],
  ["紫菱洲", POSTAG_PLACE],
  ["藕香榭", POSTAG_PLACE],

  // —— 寺观 ——
  ["铁槛寺", POSTAG_PLACE],
  ["水月庵", POSTAG_PLACE],
  ["馒头庵", POSTAG_PLACE],
  ["清虚观", POSTAG_PLACE],
  ["栊翠庵", POSTAG_PLACE],
  // ── 批次 40：**异文修正**（另两条）—— 正文写 `蘅芜院` **19** 次 / `赤霞宫` **2** 次。
  ["蘅芜院", POSTAG_PLACE],
  ["赤霞宫", POSTAG_PLACE]
];

/** 全部专名条目（本书汇总）。 */
export const HONG_LOU_MENG_ENTRIES: readonly DictEntry[] = [
  ...HONG_LOU_MENG_PERSONS,
  ...HONG_LOU_MENG_PLACES
];

/**
 * **同一人/同一物的别名组**（批次 43）。
 *
 * 组内名字指同一实体 → P5 归并时**无条件 union**（绕过冲突别名护栏）。
 *
 * ## 为什么需要它
 * P1 是**逐片**抽取的（局部视角）：同一人在第 2 回被抽成 `贾政`、第 3 回被抽成 `政老爷`，
 * 两片互不知情 → 各自声称同一桥接别名 → 触发冲突护栏（被 ≥2 个规范名声称即丢弃）
 * → 共享键消失 → union 永不发生 → **永久碎片**。
 * 实测代价（红楼 1-3）：实体 FP 14 条里 **8** 条、关系 FP 17 条里 **12** 条来自这一族。
 *
 * ## ⚠️ 这是生成产物，不要手改
 * 真源 = `hongloumeng.aliases.json`（含**每一组的证据**与**刻意排除项**）。
 * 改完跑：`build-work-pack.ts --aliases ... --check`。手改会被 `--check` 抓住。
 *
 * ## 实测效果（`_wb_aliasgroup_sim.ts`，$0 确定性预演，红楼 1-3）
 * 关系 F1 **51.49 → 66.67（+15.18）**、实体 F1 **86.15 → 88.89（+2.74）**，
 * 且**不变量成立**（新增 FP/FN 全为 0）。
 */
export const HONG_LOU_MENG_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["贾雨村", "贾化", "雨村"],
  ["甄士隐", "士隐", "甄爷", "甄土隐"],
  ["封氏", "甄家娘子"],
  ["冷子兴", "子兴"],
  ["林如海", "林公"],
  ["贾母", "史老夫人"],
  ["贾政", "政老爷", "政老前辈", "政公"],
  ["贾赦", "赦老爷"],
  ["元春", "元妃"],
  ["巧姐", "大姐儿", "巧姐儿"],
  ["贾琏", "琏儿"],
  ["贾环", "环儿"],
  ["贾兰", "兰哥儿"],
  ["李纨", "李宫裁"],
  ["薛蟠", "蟠儿", "薛大哥哥"],
  ["林黛玉", "黛玉", "林姑娘"],
  ["史湘云", "湘云", "云丫头"],
  ["薛宝琴", "宝琴"],
  ["邢岫烟", "岫烟"],
  ["尤二姐", "二姐儿", "二姐"],
  ["尤三姐", "三姐儿"],
  ["柳湘莲", "柳二爷"],
  ["邢德全", "邢大舅"],
  ["英莲", "香菱", "秋菱"],
  ["张道士", "张法官"],
  ["李嬷嬷", "李老太太"],
  ["北静王", "北静王世荣", "北静郡王"],
  ["来旺", "来旺儿"],
  ["夏金桂", "金桂"],
  ["警幻", "警幻仙姑"],
  ["荣国府", "荣府", "西府"],
  ["宁国府", "宁府", "东府"]
];

/** 《红楼梦》作品包。 */
export const HONG_LOU_MENG_WORK_PACK: WorkPack = {
  id                 : "hong-lou-meng",
  label              : "《红楼梦》",
  properNouns        : HONG_LOU_MENG_ENTRIES,
  properNounFrequency: DICT_FREQUENCY,
  aliasGroups        : HONG_LOU_MENG_ALIAS_GROUPS
};
