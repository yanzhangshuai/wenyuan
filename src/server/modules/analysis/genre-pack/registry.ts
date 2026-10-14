/**
 * 作品包注册表：**作品标题 → 作品包**。
 *
 * ## 为什么必须有这一层
 *
 * 搬迁完成后，`WorkPack` 这个接口是存在的，但**没有任何代码按作品去选它** ——
 * `tokenizer.ts` 的参数默认值是 `DEFAULT_WORK_PACK`（《儒林外史》），
 * 于是「解析《红楼梦》」会**静默地**拿《儒林外史》的人名词典去分词。
 *
 * 这是本项目反复出现的一类缺陷：**默认值即隐性策略**。
 * 症状不是报错，而是「第二本书的分词莫名其妙不准」——
 * 与历史上「前言占用 ordinal 1」「进程内单例分词器」同一类。
 *
 * ## 兜底策略：未注册 → 空词典，**不是**某本书
 *
 * 未注册时用 `UNREGISTERED_WORK_PACK`（零专名词典），而不是退回 `DEFAULT_WORK_PACK`。
 * 理由是**错误可见性**：
 *
 * | 兜底 | 后果 | 可见性 |
 * | --- | --- | --- |
 * | 退回《儒林外史》词典 | 用错书的知识，且**不报错** | ❌ 不可见 |
 * | 空词典 | 只是没拿到增量（基线 75.7%） | ✅ 由审计 issue 记录 |
 *
 * 与项目既有的「宁可少并，不可错并」是同一条原则：错并不可见，少并可见可修。
 *
 * ## 匹配口径：归一化后**前缀**匹配，且**总是留档**
 *
 * 实测已证明「误配另一本书的词典」的**实际损害≈0**：
 * 同一份《红楼梦》语料，空词典与《儒林外史》词典的分词结果**逐字节相同**
 * （两本书的人名不重叠）。因为词典只做「把某些词抬为整词」，不删词、不改义。
 *
 * 既然如此，匹配就该**宽松**（允许「红楼梦前10回」命中「红楼梦」），
 * 而把风险控制放在**留档**上：每次解析都记录用了哪个包、是否命中。
 * 详见 `resolveWorkPack` 的返回值与 `run.ts` 的 `work_pack_resolved` issue。
 */

import { normalizeName } from "@/lib/text";

import { findPrefixConflicts } from "./proper-noun-dict";
import type { WorkPack } from "./types";
import { HONG_LOU_MENG_WORK_PACK } from "./works/hongloumeng";
import { RU_LIN_WAI_SHI_WORK_PACK } from "./works/rulin-waishi";

/**
 * 未注册作品的兜底包：**零专名词典**。
 *
 * 词频取 `100_000` 与真实包一致 —— 空表下该值不起作用，
 * 但保持同量级可避免「兜底包看起来像另一种东西」的误读。
 */
export const UNREGISTERED_WORK_PACK: WorkPack = {
  id                 : "__unregistered__",
  label              : "未注册作品（无专名词典）",
  properNouns        : [],
  properNounFrequency: 100_000,
  aliasGroups        : []
};

/** 注册项：一组别名 → 一个作品包。 */
interface WorkPackRegistration {
  /** 归一化后用于匹配的别名（**按长度降序**，保证最长匹配优先）。 */
  readonly aliases: readonly string[];
  readonly pack   : WorkPack;
}

/**
 * 归一化作品标题，只保留可比较的汉字与字母数字。
 *
 * 剔除：书名号、引号、括号、间隔号、空白、常见文件后缀。
 * 目的是让「《红楼梦》」「红楼梦.txt」「红楼梦_前10回」都能收敛到同一串。
 *
 * ⚠️ 刻意**不做**繁简转换：转换表是另一份需要维护的知识，
 * 且简繁混用本身会让分词结果不同 —— 与其静默转换，不如让匹配失败并留档。
 */
export function normalizeBookTitle(raw: string): string {
  return raw
    .replace(/\.(txt|text|md)$/i, "")
    .replace(/[《》〈〉「」『』【】〔〕（）()[\]]/gu, "")
    .replace(/[\s\u3000_·・,，.。:：;；!！?？"'“”‘’—-]/gu, "");
}

/** 注册表。新增一本书 = 在这里加一行，别处不改。 */
const REGISTRATIONS: readonly WorkPackRegistration[] = [
  { aliases: ["儒林外史"], pack: RU_LIN_WAI_SHI_WORK_PACK },
  {
    aliases: ["红楼梦", "石头记", "金陵十二钗", "情僧录", "风月宝鉴"],
    pack   : HONG_LOU_MENG_WORK_PACK
  }
]
  .map((registration) => ({
    ...registration,
    aliases: [...registration.aliases]
      .map((alias) => normalizeBookTitle(alias))
      .sort((left, right) => right.length - left.length)
  }))
  .sort((left, right) => (right.aliases[0]?.length ?? 0) - (left.aliases[0]?.length ?? 0));

/**
 * 作品包校验：**前缀冲突会抛错**。
 *
 * `findPrefixConflicts` 此前只在单测里被调用，生产路径从不执行 ——
 * 于是「守卫存在但不承重」。这里让它在**注册期**真的跑一遍：
 * 任何一个作品包内部出现 `A ⊂ B`（如同时收 `杨执` 与 `杨执中`），
 * 启动即失败，而不是等到分词结果莫名其妙变差。
 *
 * 为什么必须抛错而不能只告警：同频 DAG 的最长匹配会**优先选短的那个候选**，
 * 于是长词被静默切碎 —— 又是一次「不报错的错误」。
 *
 * ⚠️ 刻意**导出**：不导出的话，注册期的调用就成了「不可测的守卫」——
 * 把调用改成空操作，测试照样全绿（变异测试实测确认过这一点）。
 */
export function assertWorkPackIsValid(pack: WorkPack): void {
  const conflicts = findPrefixConflicts(pack.properNouns);
  if (conflicts.length > 0) {
    const detail = conflicts.map((pair) => `${pair[0]} ⊂ ${pair[1]}`).join("；");
    throw new Error(`作品包 ${pack.id} 存在前缀冲突（同频最长匹配会静默切碎长词）：${detail}`);
  }

  // ── 别名组的两条硬不变量（批次 43）──
  //
  // 为什么必须抛错：`aliasGroups` 是**人工断言**「这些名字是同一个人」，
  // 而 P5 会**无条件 union**（绕过冲突护栏）。所以数据一错就是**错并**，
  // 而错并在图谱里**不可见**（批次 18 的灾难：`王夫人` 被并进 9 个王爷）。
  // → 能在**注册期**拦住的错误，绝不留给运行期。
  const seenInGroup = new Map<string, number>();
  pack.aliasGroups?.forEach((group, groupIndex) => {
    const keys = group.map((name) => normalizeName(name)).filter((key) => key.length > 0);
    const distinct = new Set(keys);
    if (distinct.size < 2) {
      throw new Error(
        `作品包 ${pack.id} 的第 ${String(groupIndex + 1)} 个别名组只有 ${String(distinct.size)} 个**不同**名字` +
          `（${group.join(" / ")}）—— 组内名字不足 2 个时该组是空操作，通常是笔误。`
      );
    }
    for (const key of distinct) {
      const previous = seenInGroup.get(key);
      if (previous !== undefined) {
        throw new Error(
          `作品包 ${pack.id} 的名字「${key}」同时出现在第 ${String(previous + 1)} 与第 ${String(groupIndex + 1)} 个别名组里` +
            " —— 一个人不能属于两个身份，这两条断言互相矛盾。"
        );
      }
      seenInGroup.set(key, groupIndex);
    }
  });
}

for (const registration of REGISTRATIONS) {
  assertWorkPackIsValid(registration.pack);
}

/** 解析结果：**总是**带回匹配状态，供调用方留档。 */
export interface WorkPackResolution {
  readonly pack        : WorkPack;
  /** 是否命中注册表。`false` 表示用了兜底空词典。 */
  readonly matched     : boolean;
  /** 命中的别名；未命中为 `null`。 */
  readonly matchedAlias: string | null;
}

/**
 * 按作品标题解析作品包。
 *
 * 匹配规则（确定性、可复现）：
 * 1. 归一化标题；
 * 2. 按别名长度降序，取第一个「标题以其为前缀」的注册项 ——
 *    长别名优先，避免「红楼梦」抢走本该由更长别名命中的标题；
 * 3. 全部未命中 → `UNREGISTERED_WORK_PACK`，`matched = false`。
 *
 * @param bookTitle 作品标题（来自 `books.title`）；空串视为未注册
 * @returns 作品包 + 匹配状态
 */
export function resolveWorkPack(bookTitle: string): WorkPackResolution {
  const normalized = normalizeBookTitle(bookTitle);
  if (normalized.length === 0) {
    return { pack: UNREGISTERED_WORK_PACK, matched: false, matchedAlias: null };
  }

  for (const registration of REGISTRATIONS) {
    for (const alias of registration.aliases) {
      if (normalized.startsWith(alias)) {
        return { pack: registration.pack, matched: true, matchedAlias: alias };
      }
    }
  }

  return { pack: UNREGISTERED_WORK_PACK, matched: false, matchedAlias: null };
}

/** 已注册的作品包 id 列表（供 UI / 文档展示）。 */
export function listRegisteredWorkPacks(): readonly { id: string; label: string }[] {
  return REGISTRATIONS.map((registration) => ({
    id   : registration.pack.id,
    label: registration.pack.label
  }));
}
