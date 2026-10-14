import { describe, expect, it } from "vitest";

import { isUnsafeAlias, mergeEntities } from "./merge";

describe("isUnsafeAlias", () => {
  it("代词与自称不安全", () => {
    expect(isUnsafeAlias("在下")).toBe(true);
    expect(isUnsafeAlias("我")).toBe(true);
    expect(isUnsafeAlias("寡人")).toBe(true);
  });

  it("泛类称谓不安全", () => {
    expect(isUnsafeAlias("大哥")).toBe(true);
    expect(isUnsafeAlias("夫人")).toBe(true);
  });

  it("具体称呼安全（含泛称后缀的完整称呼）", () => {
    expect(isUnsafeAlias("范进")).toBe(false);
    expect(isUnsafeAlias("娄三公子")).toBe(false);
  });

  it("亲属/身份泛称不安全（本轮扩充：它们曾把无关人物桥接成一个大组件）", () => {
    // 实测「杜少卿」名下堆积了 17 个亲属称谓，进而吞掉胡屠户、卜老爹等人。
    for (const alias of [
      "丈人", "岳父", "亲家", "外公公", "表侄", "贤侄", "长兄", "老哥", "世兄",
      "太公", "公孙", "少爷", "新婿", "新郎官", "老爹", "娘子"
    ]) {
      expect(isUnsafeAlias(alias)).toBe(true);
    }
  });

  it("带前缀的完整称呼仍然安全（泛称表是精确匹配，不做后缀匹配）", () => {
    expect(isUnsafeAlias("胡老爹")).toBe(false);
    expect(isUnsafeAlias("蘧公孙")).toBe(false);
    expect(isUnsafeAlias("卜老爹")).toBe(false);
  });
});

describe("mergeEntities · observedChapters（缺陷 N1 的坐标传递）", () => {
  it("**不变量**：未提供观测章节时输出空数组（= 不施加章节限制）", () => {
    const outcome = mergeEntities({
      entities     : [{ canonical: "范进", type: "PERSON", aliases: [] }],
      nameFrequency: new Map()
    });
    // 空数组是「调用方没给章节信息」，不是「零个章节」——
    // 后者会让该实体的提及被全部过滤掉（比原缺陷更难发现的失败模式）。
    expect(outcome.entities[0]?.observedChapters).toEqual([]);
  });

  it("同一实体被多个候选桥接时，观测章节取**并集**并升序去重", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "王冕", type: "PERSON", aliases: ["王相公"], observedChapters: [3, 1] },
        { canonical: "王相公", type: "PERSON", aliases: [], observedChapters: [1, 5] }
      ],
      nameFrequency: new Map([["王冕", 10]])
    });

    expect(outcome.entities).toHaveLength(1);
    // 并集而非某一个候选的章节：只取其一会误删另一个写法带来的提及。
    expect(outcome.entities[0]?.observedChapters).toEqual([1, 3, 5]);
  });

  it("未被桥接的实体各自保留自己的观测章节", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "甲", type: "PERSON", aliases: [], observedChapters: [2] },
        { canonical: "乙", type: "PERSON", aliases: [], observedChapters: [7] }
      ],
      nameFrequency: new Map()
    });

    const byName = new Map(outcome.entities.map((entity) => [entity.canonical, entity]));
    expect(byName.get("甲")?.observedChapters).toEqual([2]);
    expect(byName.get("乙")?.observedChapters).toEqual([7]);
  });
});

describe("mergeEntities", () => {
  it("别名桥接同一实体，并按出现频次选择规范名", () => {
    const outcome = mergeEntities({
      entities     : [{ canonical: "范老爷", type: "PERSON", aliases: ["范进"] }],
      nameFrequency: new Map<string, number>([
        ["范进", 120],
        ["范老爷", 8]
      ])
    });

    expect(outcome.entities).toHaveLength(1);
    expect(outcome.entities[0]?.canonical).toBe("范进");
    expect(outcome.entities[0]?.aliases).toEqual(["范老爷"]);
  });

  it("归一化后相同的名字合并（内部空白）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "司马光", type: "PERSON", aliases: [] },
        { canonical: "司马 光", type: "PERSON", aliases: [] }
      ],
      nameFrequency: new Map()
    });
    expect(outcome.entities).toHaveLength(1);
    expect(outcome.entities[0]?.memberKeys).toEqual(["司马光"]);
  });

  it("不安全别名不参与桥接，避免误合并", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "甲", type: "PERSON", aliases: ["大哥"] },
        { canonical: "乙", type: "PERSON", aliases: ["大哥"] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(2);
    expect(outcome.rejectedAliases).toEqual(["大哥", "大哥"]);
  });

  it("输出「归一化键 → 实体下标」映射，供 mentions 外键重指向", () => {
    const outcome = mergeEntities({
      entities     : [{ canonical: "范进", type: "PERSON", aliases: ["范老爷"] }],
      nameFrequency: new Map()
    });

    expect(outcome.keyToEntityIndex.get("范进")).toBe(0);
    expect(outcome.keyToEntityIndex.get("范老爷")).toBe(0);
  });

  it("类型不一致时按多数投票，平票时 PERSON 优先", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "范进", type: "PERSON", aliases: ["范老爷"] },
        { canonical: "范老爷", type: "LOCATION", aliases: [] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(1);
    expect(outcome.entities[0]?.type).toBe("PERSON");
  });

  it("缺省 nameType 为 NAMED（旧调用点行为不变）", () => {
    const outcome = mergeEntities({
      entities     : [{ canonical: "范进", type: "PERSON", aliases: [] }],
      nameFrequency: new Map()
    });

    expect(outcome.entities[0]?.nameType).toBe("NAMED");
  });

  it("全部写法都只有称谓时，合并结果为 TITLE_ONLY", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "胡屠户", type: "PERSON", aliases: ["胡老爹"], nameType: "TITLE_ONLY" },
        { canonical: "胡老爹", type: "PERSON", aliases: [], nameType: "TITLE_ONLY" }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(1);
    expect(outcome.entities[0]?.nameType).toBe("TITLE_ONLY");
  });

  it("只要有一个写法是本名，结果就不是 TITLE_ONLY（合取语义）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "鲁编修", type: "PERSON", aliases: ["鲁先生"], nameType: "TITLE_ONLY" },
        { canonical: "鲁先生", type: "PERSON", aliases: ["鲁某"], nameType: "NAMED" }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(1);
    expect(outcome.entities[0]?.nameType).toBe("NAMED");
  });
});

describe("mergeEntities —— 冲突别名（切断错并级联的核心）", () => {
  it("同一别名被两个不同实体声称 → 丢弃该别名，**不合并**这两个实体", () => {
    // 注意：「老爹」已被硬性泛称表拦下（见 isUnsafeAlias 用例），
    // 这里刻意用一个**不在硬表里**的共享别名，才能测到冲突检测这条路径。
    const outcome = mergeEntities({
      entities: [
        { canonical: "卜老爹", type: "PERSON", aliases: ["卜老", "老爹"] },
        { canonical: "卜诚", type: "PERSON", aliases: ["卜老", "卜二"] }
      ],
      nameFrequency: new Map()
    });

    // 修复前：两人被「卜老」并成一个实体，且被吞一方在库里彻底消失。
    expect(outcome.entities).toHaveLength(2);
    expect(outcome.conflictingAliases).toEqual(["卜老"]);
    // 冲突别名被丢弃后**根本没有进入键映射**，因此不可能再桥接任何人。
    expect(outcome.keyToEntityIndex.get("卜老")).toBeUndefined();
  });

  it("别名只被一个实体声称 → 正常桥接（真实别名不受影响）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "马二先生", type: "PERSON", aliases: ["马纯上"] },
        { canonical: "马纯上", type: "PERSON", aliases: [] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(1);
    expect(outcome.conflictingAliases).toEqual([]);
  });

  it("同一规范名在多片重复声称同一别名，不算冲突", () => {
    // 全书 116 个分片，同一人物会在多片被反复输出 —— 必须按「不同实体」去重。
    const outcome = mergeEntities({
      entities: [
        { canonical: "范进", type: "PERSON", aliases: ["范老爷"] },
        { canonical: "范进", type: "PERSON", aliases: ["范老爷"] },
        { canonical: "范进", type: "PERSON", aliases: ["范老爷"] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.conflictingAliases).toEqual([]);
    expect(outcome.entities).toHaveLength(1);
  });

  it("冲突别名被丢弃后，实体各自独立（宁可少并，不可错并）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "杜少卿", type: "PERSON", aliases: ["杜仪", "杜十七"] },
        { canonical: "杜慎卿", type: "PERSON", aliases: ["慎卿", "杜十七"] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(2);
    expect(outcome.conflictingAliases).toEqual(["杜十七"]);
    // 各自的专属别名仍然把本人桥接住，但不会把另一个人并进来
    expect(outcome.keyToEntityIndex.get("杜仪")).toBe(outcome.keyToEntityIndex.get("杜少卿"));
    expect(outcome.keyToEntityIndex.get("慎卿")).toBe(outcome.keyToEntityIndex.get("杜慎卿"));
    expect(outcome.keyToEntityIndex.get("杜慎卿")).not.toBe(
      outcome.keyToEntityIndex.get("杜少卿")
    );
  });

  it("冲突别名的**声称者**也要留档（批次 26B：P5 可 $0 预演的前提）", () => {
    // 为什么名字不够：冲突判定用的是**丢弃之前**算出的 `aliasOwners`，
    // 而那个输入从不落库 → 「上游改动会怎样改变 P5 的丢弃集合」在库内无法回答。
    // 批次 25 正是因此吃了亏（放行的 20/21 条桥接别名被吃掉 8/1 条，却算不出是哪几条）。
    const outcome = mergeEntities({
      entities: [
        { canonical: "杜少卿", type: "PERSON", aliases: ["杜仪", "杜十七"] },
        { canonical: "杜慎卿", type: "PERSON", aliases: ["慎卿", "杜十七"] },
        { canonical: "庄绍光", type: "PERSON", aliases: ["庄征君"] }
      ],
      nameFrequency: new Map()
    });

    // ① 前提校验：必须真的造出冲突，否则下面的断言会退化成「空集等于空集」的假绿。
    expect(outcome.conflictingAliases).toEqual(["杜十七"]);
    // ② 契约：键是**展示形**（与 `conflictingAliases` 同一个字符串）、值是展示形规范名、已排序。
    expect(outcome.conflictingAliasOwners).toEqual({ 杜十七: ["杜少卿", "杜慎卿"] });
    // ③ 只有**冲突**别名才进留档 —— 专属别名（`杜仪`/`庄征君`）不得混进来。
    expect(Object.keys(outcome.conflictingAliasOwners)).toEqual(["杜十七"]);
  });

  it("声称者按**不同规范名**去重：同一规范名重复声称不算冲突，也不进留档", () => {
    // 全书 116 个分片，同一人物会在多片反复输出 —— 与上面那条「不算冲突」的用例同源，
    // 这里额外断言**留档字段也为空**（防止将来把预处理与留档两处改歪一处）。
    const outcome = mergeEntities({
      entities: [
        { canonical: "范进", type: "PERSON", aliases: ["范老爷"] },
        { canonical: "范进", type: "PERSON", aliases: ["范老爷"] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.conflictingAliases).toEqual([]);
    expect(outcome.conflictingAliasOwners).toEqual({});
  });
});

describe("mergeEntities —— N18 行政后缀白名单归并（`汶上` + `汶上县`）", () => {
  it("短名与「短名 + 行政后缀」的长名并成一个实体", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "汶上", type: "LOCATION", aliases: [], observedChapters: [2, 3] },
        { canonical: "汶上县", type: "LOCATION", aliases: [], observedChapters: [7] }
      ],
      nameFrequency: new Map<string, number>([
        ["汶上", 5],
        ["汶上县", 3]
      ])
    });

    const merged = outcome.entities[0];
    expect(outcome.entities).toHaveLength(1);
    expect(outcome.administrativeMerges).toBe(1);
    // 频次高者当规范名（`汶上`），但**两个键都必须留下** ——
    // 金标按成员键集合比对，所以「只收长形式」这条金标口径不会因此丢分。
    expect(merged?.canonical).toBe("汶上");
    expect([...(merged?.memberKeys ?? [])].sort()).toEqual(["汶上", "汶上县"]);
    // 提及回填靠这个映射：两个键指向同一实体，短名那份提及不再被劈开。
    expect(outcome.keyToEntityIndex.get("汶上")).toBe(outcome.keyToEntityIndex.get("汶上县"));
    // 观测章节取并集 —— 否则会误删长名那一份带来的提及。
    expect(merged?.observedChapters).toEqual([2, 3, 7]);
  });

  it("短名不是 LOCATION → 不并", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "天长", type: "PERSON", aliases: [] },
        { canonical: "天长县", type: "LOCATION", aliases: [] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(2);
    expect(outcome.administrativeMerges).toBe(0);
  });

  it("短名有 ≥2 个行政后缀兄弟 → 整组跳过（府/县是嵌套两级，判断不了主形式）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "长安", type: "LOCATION", aliases: [] },
        { canonical: "长安县", type: "LOCATION", aliases: [] },
        { canonical: "长安府", type: "LOCATION", aliases: [] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(3);
    expect(outcome.administrativeMerges).toBe(0);
  });

  it("非行政后缀不并：`会稽` 与 `会稽山` 是**不同实体**（山/河/塔/集 故意不收）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "会稽", type: "LOCATION", aliases: [] },
        { canonical: "会稽山", type: "LOCATION", aliases: [] },
        { canonical: "秦淮", type: "LOCATION", aliases: [] },
        { canonical: "秦淮河", type: "LOCATION", aliases: [] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(4);
    expect(outcome.administrativeMerges).toBe(0);
  });

  it("反作弊：长名只在**别名**层出现时**不**触发（规则只认规范名）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "汶上", type: "LOCATION", aliases: [], observedChapters: [2] },
        // `汶上县` 只是别人的别名 → 不是独立规范名 → 不构成「同地双份」。
        { canonical: "薛家集", type: "LOCATION", aliases: ["汶上县"], observedChapters: [2] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.administrativeMerges).toBe(0);
  });

  it("反作弊：长短名本来就在同一组（长名是短名的别名）→ 不重复计数", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "汶上", type: "LOCATION", aliases: ["汶上县"], observedChapters: [2] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(1);
    expect(outcome.administrativeMerges).toBe(0);
  });
});

describe("mergeEntities —— R3 书名号归并（`庄子` + `《庄子》`）", () => {
  it("同一部作品的带号 / 不带号写法并成一个实体", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "庄子", type: "CONCEPT", aliases: [], observedChapters: [21, 113] },
        { canonical: "《庄子》", type: "CONCEPT", aliases: [], observedChapters: [118] }
      ],
      nameFrequency: new Map<string, number>([
        ["庄子", 11],
        ["《庄子》", 3]
      ])
    });

    expect(outcome.entities).toHaveLength(1);
    expect(outcome.bookTitleMerges).toBe(1);
    const merged = outcome.entities[0];
    // 频次高者当规范名（`庄子`），两个键都必须留下（金标按成员键集合比对）。
    expect(merged?.canonical).toBe("庄子");
    expect([...(merged?.memberKeys ?? [])].sort()).toEqual(["《庄子》", "庄子"]);
    expect(outcome.keyToEntityIndex.get("庄子")).toBe(outcome.keyToEntityIndex.get("《庄子》"));
    // 观测章节取并集 —— 否则会误删带号那一份带来的提及。
    expect(merged?.observedChapters).toEqual([21, 113, 118]);
  });

  it("🔑 类型护栏：**书与人同名不并**（`庄子` 既是书也是人）", () => {
    // 这条护栏是本规则能收的前提：去掉它就会把人与书并成一个。
    const outcome = mergeEntities({
      entities: [
        { canonical: "庄子", type: "PERSON", aliases: [] },
        { canonical: "《庄子》", type: "CONCEPT", aliases: [] }
      ],
      nameFrequency: new Map<string, number>([
        ["庄子", 11],
        ["《庄子》", 3]
      ])
    });

    expect(outcome.entities).toHaveLength(2);
    expect(outcome.bookTitleMerges).toBe(0);
  });

  it("非 CONCEPT 不并（类型护栏限定作用面）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "四书", type: "LOCATION", aliases: [] },
        { canonical: "《四书》", type: "LOCATION", aliases: [] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(2);
    expect(outcome.bookTitleMerges).toBe(0);
  });

  it("去号后不同名 → 不并（不得把无关作品并起来）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "牡丹亭", type: "CONCEPT", aliases: [] },
        { canonical: "《西厢记》", type: "CONCEPT", aliases: [] }
      ],
      nameFrequency: new Map()
    });

    expect(outcome.entities).toHaveLength(2);
    expect(outcome.bookTitleMerges).toBe(0);
  });

  it("反作弊：书名号只出现在**别名**层 → 不触发（规则只认规范名）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "庄子", type: "CONCEPT", aliases: [], observedChapters: [21] },
        { canonical: "南华经", type: "CONCEPT", aliases: ["《庄子》"], observedChapters: [22] }
      ],
      nameFrequency: new Map()
    });

    // `《庄子》` 只是「南华经」的别名 → 去号后比的是**规范名**「南华经」≠「庄子」 → 不并。
    expect(outcome.bookTitleMerges).toBe(0);
    expect(outcome.entities).toHaveLength(2);
  });
});

describe("mergeEntities —— 声明式别名组（批次 43：补「同一人被逐片抽成多个」的缺口）", () => {
  /**
   * 这是本特性的**核心断言**：两个实体各自声称同一个桥接别名 → 冲突护栏会丢弃该别名
   * → 共享键消失 → **union 永不发生** → 永久碎片。声明组必须**绕过**这条护栏。
   */
  it("🚨 声明组**绕过冲突护栏**：桥接别名被两边声称（护栏丢弃它）时仍能合并", () => {
    const input = [
      { canonical: "贾政", type: "PERSON" as const, aliases: ["二老爷"] },
      { canonical: "政老爷", type: "PERSON" as const, aliases: ["二老爷"] }
    ];

    // 对照组：不声明 → 护栏丢掉 `二老爷`，两个实体**保持分裂**。
    const withoutDeclared = mergeEntities({ entities: input, nameFrequency: new Map() });
    expect(withoutDeclared.entities).toHaveLength(2);
    expect(withoutDeclared.conflictingAliases).toEqual(["二老爷"]);

    // 实验组：声明 `贾政` 与 `政老爷` 是同一人 → 合并。
    const withDeclared = mergeEntities({
      entities           : input,
      nameFrequency      : new Map(),
      declaredAliasGroups: [["贾政", "政老爷"]]
    });
    expect(withDeclared.entities).toHaveLength(1);
    // ⚠️ 关键：护栏**仍然**丢掉了 `二老爷`（它确实无区分度）—— 合并是**声明**带来的，
    // 不是「护栏被削弱」。两者必须同时成立，否则就不是「绕过」而是「改判据」。
    expect(withDeclared.conflictingAliases).toEqual(["二老爷"]);
    expect(withDeclared.declaredAliasMerges).toBe(1);
  });

  it("缺省零行为变更：不给 `declaredAliasGroups` 与给 `[]` 结果逐字段相同", () => {
    const input = [
      { canonical: "甲", type: "PERSON" as const, aliases: [] },
      { canonical: "乙", type: "PERSON" as const, aliases: [] }
    ];
    const omitted = mergeEntities({ entities: input, nameFrequency: new Map() });
    const empty = mergeEntities({ entities: input, nameFrequency: new Map(), declaredAliasGroups: [] });
    expect(omitted.entities).toEqual(empty.entities);
    expect(omitted.declaredAliasMerges).toBe(0);
    expect(empty.declaredAliasMerges).toBe(0);
  });

  it("命中 <2 个组 → 空操作（该人已经是一个实体，或名字不在本次图谱里）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "贾政", type: "PERSON" as const, aliases: [] },
        { canonical: "贾赦", type: "PERSON" as const, aliases: [] }
      ],
      nameFrequency      : new Map(),
      // 组里三个名字，只有 `贾政` 在图里 → 命中 1 个组 → 不并。
      declaredAliasGroups: [["贾政", "政老爷", "政公"]]
    });
    expect(outcome.entities).toHaveLength(2);
    expect(outcome.declaredAliasMerges).toBe(0);
  });

  it("声明里可以是**别名**而不只是规范名（否则会漏掉「本组已含该实体」的情形）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "贾政", type: "PERSON" as const, aliases: ["政老"] },
        { canonical: "政老爷", type: "PERSON" as const, aliases: [] }
      ],
      nameFrequency      : new Map(),
      // `政老` 当前只是 `贾政` 的**别名** —— 仍必须能定位到 `贾政` 所在的那一组。
      declaredAliasGroups: [["政老", "政老爷"]]
    });
    expect(outcome.entities).toHaveLength(1);
    expect(outcome.declaredAliasMerges).toBe(1);
  });

  it("计数口径 = **生效的组数**（不是成对归并次数）：一组并三个实体只记 1", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "贾雨村", type: "PERSON" as const, aliases: [] },
        { canonical: "贾化", type: "PERSON" as const, aliases: [] },
        { canonical: "雨村", type: "PERSON" as const, aliases: [] }
      ],
      nameFrequency      : new Map(),
      declaredAliasGroups: [["贾雨村", "贾化", "雨村"]]
    });
    expect(outcome.entities).toHaveLength(1);
    // 三个实体两两并 = 2 次并，但只有 **1 组**生效。
    expect(outcome.declaredAliasMerges).toBe(1);
  });

  it("规范名仍按频次选（声明组不改变 `pickCanonicalKey`）", () => {
    const outcome = mergeEntities({
      entities: [
        { canonical: "政老爷", type: "PERSON" as const, aliases: [] },
        { canonical: "贾政", type: "PERSON" as const, aliases: [] }
      ],
      nameFrequency: new Map([
        ["贾政", 328],
        ["政老爷", 4]
      ]),
      declaredAliasGroups: [["贾政", "政老爷"]]
    });
    expect(outcome.entities).toHaveLength(1);
    expect(outcome.entities[0]?.canonical).toBe("贾政");
    expect(outcome.entities[0]?.aliases).toEqual(["政老爷"]);
  });
});

