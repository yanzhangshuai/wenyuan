import { CLASSICAL_GENRE_PACK } from "./classical";
import type { GenrePack } from "./types";

/**
 * 题材包（genre pack）——**领域知识的唯一入口**。
 *
 * ## 一句话
 *
 * 控制流是冻结的，能换的只有领域知识。本目录就是那块知识的形状与默认取值。
 *
 * ## 三层（详见 `types.ts`）
 *
 * | 层 | 本目录中的位置 | 内容 |
 * | --- | --- | --- |
 * | **通用层** | 不在这里 | 单字拒／超长拒／无 CJK 拒（与语言无关） |
 * | **题材层** | `classical/` | 官职后缀、尊称词、排行字、关系目录、提示词 |
 * | **作品层** | `works/` | 一部书自己的专名词典 |
 *
 * ## 当前状态（诚实说明）
 *
 * 本目录最初只做**搬迁**：所有取值都逐字来自原来的硬编码位置，
 * 因此当时行为**逐字节不变**。搬迁本身**不能证明接口充分** ——
 * 「知识被搬进来了」只证明抽象省事，不证明接口够用。
 *
 * 真正让接口被证伪过的是**第二个消费者**：`works/hongloumeng.ts`。
 * 加入《红楼梦》作品包**没有改动任何控制流**（P0–P6 拓扑、阶段 I/O 契约、
 * 3 个 LLM 调用点全部不变），接口成立。
 *
 * 同时暴露了两件事，都写在对应文件里：
 * - 「本名 + X家的」这类成对写法在本包里只能二选一（见 `works/hongloumeng.ts`）。
 *   ⚠️ **2026-10-10 实测更正**：这是**守卫保守**所致，**不是** `properNounFrequency`
 *   表达不了优先级 —— 把长条目词频从 1 提到 1e8 也救不了前缀冲突
 *   （`杨执中` 照样被切成 `杨执 | 中道`）。故 **N13「给包格式加 per-entry 频次」已证伪、不做**；
 *   实测界定见 `proper-noun-dict.ts`，探针 `_wb_n13_mech.ts` / `_wb_n13_freq.ts` / `_wb_n13_param.ts`。
 * - 173 条词条是**人工录入**的。接口够用 ≠ 通用化达成：
 *   每本新书仍需一份手工词典，tier ③（离线生成器）仍是缺口。
 *
 * ## 选择逻辑
 *
 * `registry.ts` 提供 `resolveWorkPack(bookTitle)`；未注册作品退回**空词典**并留档，
 * 不再默认到某一本书上（`DEFAULT_WORK_PACK` 已删除，理由见文件末尾）。
 *
 * 另一个已在搬迁期修掉的隐蔽缺陷：`getSegmenter()` 曾是**进程内单例**
 * （`tokenizer.ts` 用 `??=` 缓存），换作品包必须**重建分词器**。
 * 现已按 `pack.id` 分桶，并用交错 A→B→A 指纹测试钉死（无状态泄漏）。
 */

export * from "./types";
export { CLASSICAL_GENRE_PACK } from "./classical";
export { HONG_LOU_MENG_WORK_PACK } from "./works/hongloumeng";
export { RU_LIN_WAI_SHI_WORK_PACK } from "./works/rulin-waishi";
export { findPrefixConflicts, renderSegmentitDict } from "./proper-noun-dict";
export {
  UNREGISTERED_WORK_PACK,
  assertWorkPackIsValid,
  listRegisteredWorkPacks,
  normalizeBookTitle,
  resolveWorkPack,
  type WorkPackResolution
} from "./registry";

/** 默认题材包（古典白话中文）。目前只有这一个题材包，故无需选择逻辑。 */
export const DEFAULT_GENRE_PACK: GenrePack = CLASSICAL_GENRE_PACK;

/**
 * ⚠️ 已删除 `DEFAULT_WORK_PACK`（原值 = 《儒林外史》）。
 *
 * 它存在的唯一理由是「零行为变更」（搬迁前 `tokenizer.ts` 注入的就是那一份）。
 * 但搬迁已经结束，这个常量就从「兼容垫片」变成了**陷阱**：
 * 任何一处漏传作品包，都会静默地给另一本书套上《儒林外史》的人名。
 *
 * 取而代之的是两条明确的路径：
 * - 真实解析：`resolveWorkPack(bookTitle)`（`registry.ts`），未注册 → 空词典 + 留档；
 * - 无标题场景：`UNREGISTERED_WORK_PACK`（零专名），而不是「恰好某本书」。
 */
