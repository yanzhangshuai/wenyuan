import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { scoreRelationCategory, type V3RelationRow } from "./chinovelke-metrics";
import { ChiNovelKeNovelSchema, type ChiNovelKeCategory } from "./chinovelke-schema";

/**
 * `scoreRelationCategory` 的单测 —— 覆盖**批次 45 的三处尺子修正**。
 *
 * 为什么必须有：这两个 eval 脚本**此前零测试覆盖**，也不在任何变异套件的锚点范围内
 * （实测 `grep -l chinovelke _wb_mutation_*.py` 为空）。而批次 45 的修正引入了三条
 * **容易被无声改坏**的语义：严格/宽松两界、金标重复条目、映射缺口。
 */

/** 构造一部最小书：只给 `relations` 维度，其余留空。 */
function novelWith(
  entries: readonly {
    readonly person_a        : string;
    readonly person_b        : string;
    readonly correct_category: ChiNovelKeCategory;
  }[]
) {
  return ChiNovelKeNovelSchema.parse({
    title      : "测试书",
    genre      : "realistic",
    chapters   : 1,
    annotations: {
      relations: {
        count  : entries.length,
        entries: entries.map((entry) => ({ ...entry, correct_type: "（测试）" }))
      }
    }
  });
}

describe("scoreRelationCategory —— 批次 45 的两界与口径登记", () => {
  it("同一对多条关系：严格取首条失手、宽松命中 → 差集单列在 tieBreakLosses", () => {
    const novel = novelWith([{ person_a: "甲", person_b: "乙", correct_category: "family" }]);
    const relations: readonly V3RelationRow[] = [
      // 调用方负责排序；此处「首条」= 友好（social）→ 与金标 family 不符。
      { source: "甲", target: "乙", category: 1 },
      { source: "甲", target: "乙", category: 0 }
    ];

    const result = scoreRelationCategory(relations, novel);

    expect(result.matched).toHaveLength(0);
    expect(result.mismatched).toHaveLength(1);
    expect(result.accuracyOnMatched).toBe(0);
    expect(result.accuracyLenient).toBe(100);
    expect(result.tieBreakLosses).toEqual(["甲—乙"]);
    expect(result.ambiguousPairs).toEqual(["甲—乙"]);
  });

  it("首条即命中：两界一致、无口径损失（但该对仍算「类别不唯一」）", () => {
    const novel = novelWith([{ person_a: "甲", person_b: "乙", correct_category: "family" }]);
    const relations: readonly V3RelationRow[] = [
      { source: "甲", target: "乙", category: 0 },
      { source: "甲", target: "乙", category: 1 }
    ];

    const result = scoreRelationCategory(relations, novel);

    expect(result.accuracyOnMatched).toBe(100);
    expect(result.accuracyLenient).toBe(100);
    expect(result.tieBreakLosses).toEqual([]);
    expect(result.ambiguousPairs).toEqual(["甲—乙"]);
  });

  it("intimate 是映射缺口：单列不可达条目，并从「可比子集」剔除", () => {
    const novel = novelWith([
      { person_a: "甲", person_b: "乙", correct_category: "family" },
      { person_a: "丙", person_b: "丁", correct_category: "intimate" }
    ]);
    const relations: readonly V3RelationRow[] = [
      { source: "甲", target: "乙", category: 0 },
      { source: "丙", target: "丁", category: 1 }
    ];

    const result = scoreRelationCategory(relations, novel);

    expect(result.unreachableCategories).toEqual(["intimate"]);
    expect(result.unreachableGold).toEqual(["丙—丁"]);
    // 主口径仍把它算作「错」（如实），可比子集则剔除。
    expect(result.accuracyOnMatched).toBe(50);
    expect(result.accuracyOnComparable).toBe(100);
  });

  it("名字解析器把变体映到同一 canonical → 重复条目被登记、唯一对数下降", () => {
    const novel = novelWith([
      { person_a: "宝玉", person_b: "黛玉", correct_category: "family" },
      { person_a: "宝玉", person_b: "林黛玉", correct_category: "family" }
    ]);
    const relations: readonly V3RelationRow[] = [{ source: "宝玉", target: "黛玉", category: 0 }];

    // 字面口径：两个名字不同 → 不成对，`林黛玉` 那条落进 missing（**不进准确率分母**）。
    const literal = scoreRelationCategory(relations, novel);
    expect(literal.uniqueGoldPairs).toBe(2);
    expect(literal.duplicateEntries).toEqual([]);
    expect(literal.missing).toEqual(["宝玉—林黛玉"]);

    // 别名归一口径：两条金标指向同一对 → 重复被登记。
    const aliasMap = new Map([["林黛玉", "黛玉"]]);
    const byAlias = scoreRelationCategory(relations, novel, {
      resolveName: (name) => aliasMap.get(name) ?? name
    });
    expect(byAlias.uniqueGoldPairs).toBe(1);
    expect(byAlias.duplicateEntries).toEqual(["宝玉—林黛玉"]);
    expect(byAlias.missing).toEqual([]);
    expect(byAlias.matched).toEqual(["宝玉—黛玉", "宝玉—林黛玉"]);
  });

  it("v3 没有该对 → 进 missing 桶，不进准确率分母", () => {
    const novel = novelWith([{ person_a: "甲", person_b: "乙", correct_category: "family" }]);

    const result = scoreRelationCategory([], novel);

    expect(result.missing).toEqual(["甲—乙"]);
    expect(result.matched).toHaveLength(0);
    expect(result.mismatched).toHaveLength(0);
    expect(result.accuracyOnMatched).toBe(0);
    expect(result.coverage).toBe(0);
  });

  it("无向比较：A—B 与 B—A 是同一对", () => {
    const novel = novelWith([{ person_a: "甲", person_b: "乙", correct_category: "family" }]);

    const result = scoreRelationCategory([{ source: "乙", target: "甲", category: 0 }], novel);

    expect(result.matched).toEqual(["甲—乙"]);
    expect(result.accuracyOnMatched).toBe(100);
  });
});

/**
 * `chinovelke-eval.ts` 的**接线契约**（DB-free 静态检查）。
 *
 * 为什么需要：`chinovelke-eval.ts` 要连数据库，单测跑不了它的查询；但**两处接线**
 * 一旦被无声改掉，分数就会**静默失真**（而且不报错）：
 *   ① 去掉 `.orderBy(...)` → 「同一对取哪条」重新变成 DB 行序 → **不可复现**；
 *   ② 少跑一个名字口径 → 「名字变体」重新被藏进 `missing` 桶 → **口径意外宽松**。
 * 单测的 `scoreRelationCategory` 用例**看不到**这两处，因此在此显式钉住源码契约。
 */
describe("chinovelke-eval 接线契约（静态）", () => {
  // ⚠️ 不能用 `import.meta.url` —— vitest 的环境里它不是 `file:` scheme（实测报
  //    `TypeError: The URL must be of scheme file`）。vitest 的 cwd 是仓库根，故用相对路径。
  const source = readFileSync(resolve(process.cwd(), "scripts/eval/chinovelke-eval.ts"), "utf8");

  it("关系装载必须显式排序（三列全序）", () => {
    const orderByLine = source.split("\n").find((line) => line.includes(".orderBy(")) ?? "";

    expect(orderByLine).toContain("relationships.startChapter");
    expect(orderByLine).toContain("relationships.relationTypeCode");
    expect(orderByLine).toContain("relationships.id");
  });

  it("两个名字口径都必须跑（字面 + 别名归一）", () => {
    expect(source).toContain("scoreRelationCategory(graph.relations, novel)");
    expect(source).toContain("resolveName: resolveByAlias");
    // 别名解析器必须真的由 v3 的别名组建出来，而不是恒等函数。
    expect(source).toContain("aliasResolver.set(normalizeName(alias), canonical)");
  });
});
