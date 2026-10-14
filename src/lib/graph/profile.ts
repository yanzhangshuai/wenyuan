import type { EntityDeed, EntityDeedChapter } from "@/types/profile";

/**
 * 事迹时间线的**纯逻辑**（分组、分档）。
 *
 * 为什么单独一个文件而不是留在 `read-profile.ts`：
 * 后者顶部有 `import "server-only"`（它是 IO 层，必须如此），
 * 而 `server-only` 一旦被测试导入就会抛
 * 「This module cannot be imported from a Client Component module」——
 * 于是**纯函数也无法被测试**。把纯逻辑挪出来，IO 与逻辑各归其位，
 * 两者都能被测（本项目已有先例：`lib/graph/grouping.ts`）。
 */

/**
 * 把有序事迹列表按回次聚合成时间线。
 *
 * 输入**必须已按回次升序**（SQL 侧 `ORDER BY` 保证）—— 本函数只做分组，
 * 不排序，避免在 Node 侧重复一次 O(n log n) 且掩盖上游排序缺陷。
 *
 * ⚠️ 本函数是承重件：分组一旦出错，时间线就会把不同回的事迹混在一起，
 * 而**渲染层看不出来**（仍是一串有序文本，只是标题挂错了回）。
 *
 * @param deeds 已按回次升序的事迹列表
 * @returns 按回次分组的时间线（组内保持传入顺序）
 */
export function groupDeedsByChapter(deeds: readonly EntityDeed[]): EntityDeedChapter[] {
  const groups: EntityDeedChapter[] = [];
  let current: EntityDeedChapter | null = null;

  for (const deed of deeds) {
    // 判据是「与上一组同回」，不是「回号连续」—— 回号有缺口是正常的
    // （人物可能在某几回完全不出现），缺口语义上必须断开而不是补齐。
    // ⚠️ 不用 `current?.chapterOrdinal !== deed.chapterOrdinal`：在 else 分支
    // TS 会把 `current` 收窄成 `never`（`null` 一侧已被上分支排除）→ TS2339；
    // 而 ESLint 又要求用可选链 —— 两条规则在此语境下互斥。
    // 拆成显式判空后两者都满足，且「回号 0（前置内容）是合法值」的陷阱被钉住。
    if (current !== null && current.chapterOrdinal === deed.chapterOrdinal) {
      current.deeds.push(deed);
      continue;
    }

    const group: EntityDeedChapter = {
      chapterOrdinal: deed.chapterOrdinal,
      chapterTitle  : deed.chapterTitle,
      deeds         : [deed]
    };
    groups.push(group);
    current = group;
  }

  return groups;
}

/**
 * 信息量分档。
 *
 * 为什么需要分档：实测《儒林外史》实体提及数**中位数仅 2**、《红楼梦》仅 1，
 * 即**过半实体只出现一两次**，写不出有意义的概述。
 * 用统一方式对待全部实体会产生大量噪声内容，因此把「值不值得花成本归纳」
 * 变成一个显式的、可测试的判断。
 */
export type EntityDensity = "sparse" | "moderate" | "rich";

/** 分档阈值（提及段落数）。 */
export const DENSITY_THRESHOLDS = {
  /** ≥ 此值视为「信息丰富」，值得 LLM 归纳。 */
  rich    : 30,
  /** ≥ 此值视为「有一定信息」，可展示时间线但概述需谨慎。 */
  moderate: 10
} as const;

/**
 * 按提及段落数分档。
 *
 * @param mentionCount 提及段落数
 * @returns 信息量分档
 */
export function classifyDensity(mentionCount: number): EntityDensity {
  if (mentionCount >= DENSITY_THRESHOLDS.rich) {
    return "rich";
  }
  if (mentionCount >= DENSITY_THRESHOLDS.moderate) {
    return "moderate";
  }
  return "sparse";
}
