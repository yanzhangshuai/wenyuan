import { describe, expect, it } from "vitest";

import {
  UNREGISTERED_WORK_PACK,
  assertWorkPackIsValid,
  findPrefixConflicts,
  listRegisteredWorkPacks,
  normalizeWorkTitle,
  resolveWorkPack
} from "./index";

describe("normalizeWorkTitle", () => {
  it("剔除书名号与空白", () => {
    expect(normalizeWorkTitle("《红楼梦》")).toBe("红楼梦");
    expect(normalizeWorkTitle("  儒林外史  ")).toBe("儒林外史");
    expect(normalizeWorkTitle("儒林外史\u3000")).toBe("儒林外史");
  });

  it("剔除文件后缀", () => {
    expect(normalizeWorkTitle("红楼梦.txt")).toBe("红楼梦");
    expect(normalizeWorkTitle("红楼梦.TXT")).toBe("红楼梦");
  });

  it("剔除下划线与括号后仍保留汉字", () => {
    expect(normalizeWorkTitle("红楼梦_前10回")).toBe("红楼梦前10回");
    expect(normalizeWorkTitle("红楼梦（前10回）")).toBe("红楼梦前10回");
  });

  it("⚠️ 不做繁简转换 —— 繁简混用应保持原样，让匹配失败并留档", () => {
    // 转换表是另一份需要维护的知识；静默转换会把「匹配失败」变成「看起来成功」。
    expect(normalizeWorkTitle("紅樓夢")).toBe("紅樓夢");
  });
});

describe("resolveWorkPack", () => {
  it("精确命中《儒林外史》", () => {
    const resolution = resolveWorkPack("儒林外史");
    expect(resolution.matched).toBe(true);
    expect(resolution.pack.id).toBe("rulin-waishi");
    expect(resolution.matchedAlias).toBe("儒林外史");
  });

  it("精确命中《红楼梦》", () => {
    const resolution = resolveWorkPack("红楼梦");
    expect(resolution.matched).toBe(true);
    expect(resolution.pack.id).toBe("hong-lou-meng");
  });

  it("命中别名《石头记》", () => {
    const resolution = resolveWorkPack("石头记");
    expect(resolution.matched).toBe(true);
    expect(resolution.pack.id).toBe("hong-lou-meng");
    expect(resolution.matchedAlias).toBe("石头记");
  });

  it("归一化后再匹配（书名号 / 后缀 / 下划线段落）", () => {
    for (const title of ["《红楼梦》", "红楼梦.txt", "红楼梦_前10回", "红楼梦（前10回）"]) {
      expect(resolveWorkPack(title).pack.id, title).toBe("hong-lou-meng");
    }
  });

  it("前缀匹配是**刻意宽松**的：续书／衍生标题也命中（实测误配损害≈0）", () => {
    // 同一份《红楼梦》语料，空词典与《儒林外史》词典的分词结果逐字节相同，
    // 因为词典只把某些词「抬为整词」，不删词、不改义。
    // 因此匹配可以宽松，风险控制放在留档（见 run.ts 的 work_pack_resolved）。
    expect(resolveWorkPack("红楼梦影").pack.id).toBe("hong-lou-meng");
  });

  it("未注册作品 → 空词典兜底，且 matched=false", () => {
    const resolution = resolveWorkPack("三国演义");
    expect(resolution.matched).toBe(false);
    expect(resolution.matchedAlias).toBeNull();
    expect(resolution.pack.id).toBe(UNREGISTERED_WORK_PACK.id);
    expect(resolution.pack.properNouns).toHaveLength(0);
  });

  it("⚠️ 回归护栏：未注册时**绝不可**退回某本书的词典", () => {
    // 这是本文件存在的理由。曾经的写法是 `DEFAULT_WORK_PACK = 《儒林外史》`，
    // 于是解析《三国演义》会静默套上《儒林外史》的人名 —— 不报错，只是变差。
    // 若有人把兜底改回 `RU_LIN_WAI_SHI_WORK_PACK`，本断言必须失败。
    const resolution = resolveWorkPack("三国演义");
    expect(resolution.pack.id).not.toBe("rulin-waishi");
    expect(resolution.pack.id).not.toBe("hong-lou-meng");
    expect(resolution.pack.properNouns).toHaveLength(0);
  });

  it("空串与纯符号 → 未注册（不误命中）", () => {
    for (const title of ["", "   ", "《》", "（）"]) {
      const resolution = resolveWorkPack(title);
      expect(resolution.matched, JSON.stringify(title)).toBe(false);
      expect(resolution.pack.id).toBe(UNREGISTERED_WORK_PACK.id);
    }
  });

  it("不做子串匹配：中间包含书名不算命中", () => {
    // 「前缀」与「子串」的差别是安全边界：
    // `中国古典小说红楼梦研究` 前缀不匹配 → 未注册，而不是误命中。
    // 宽松只到「标题以别名开头」，不扩散到「标题含别名」。
    expect(resolveWorkPack("中国古典小说红楼梦研究").matched).toBe(false);
  });
});

describe("注册表自检", () => {
  it("所有已注册作品包都无前缀冲突", () => {
    // 该断言在模块加载时已由 `assertWorkPackIsValid` 执行（冲突即抛错），
    // 这里显式再验一次，使「守卫存在但不承重」不会悄悄回来。
    for (const { id } of listRegisteredWorkPacks()) {
      const pack = id === "rulin-waishi"
        ? resolveWorkPack("儒林外史").pack
        : resolveWorkPack("红楼梦").pack;
      expect(findPrefixConflicts(pack.properNouns), id).toEqual([]);
    }
  });

  it("⚠️ 校验函数本身必须承重：有冲突的包要抛错", () => {
    // 覆盖「注册期守卫」这条路径 —— 只断言「已注册的包无冲突」是不够的：
    // 那样把注册期的调用改成空操作，测试仍然全绿（变异测试实测确认过）。
    const conflicted = {
      id                 : "__test_conflicted__",
      label              : "测试用冲突包",
      properNouns        : [["杨执", 128], ["杨执中", 128]] as const,
      properNounFrequency: 100_000
    };
    expect(() => {
      assertWorkPackIsValid(conflicted);
    }).toThrow(/前缀冲突/u);
  });

  it("合法的包不抛错", () => {
    expect(() => {
      assertWorkPackIsValid(UNREGISTERED_WORK_PACK);
    }).not.toThrow();
  });

  describe("别名组的两条硬不变量（批次 43）", () => {
    /** 造一个只改 `aliasGroups` 的合法包。 */
    const packWith = (aliasGroups: readonly (readonly string[])[]) => ({
      id                 : "__test_alias__",
      label              : "测试用别名组包",
      properNouns        : [["贾政", 128], ["政老爷", 128]] as const,
      properNounFrequency: 100_000,
      aliasGroups
    });

    it("⚠️ 校验必须承重：组内不足 2 个**不同**名字要抛错（空操作通常是笔误）", () => {
      expect(() => {
        assertWorkPackIsValid(packWith([["贾政"]]));
      }).toThrow(/只有 1 个\*\*不同\*\*名字/u);
      // 归一化后相同也算「不足 2 个」——`贾政` 与 `贾 政` 是同一个人。
      expect(() => {
        assertWorkPackIsValid(packWith([["贾政", "贾 政"]]));
      }).toThrow(/只有 1 个\*\*不同\*\*名字/u);
    });

    it("⚠️ 校验必须承重：同一名字出现在两个组要抛错（一个人不能属于两个身份）", () => {
      expect(() => {
        assertWorkPackIsValid(packWith([["贾政", "政老爷"], ["贾政", "存周"]]));
      }).toThrow(/同时出现在第 1 与第 2 个别名组/u);
    });

    it("合法的别名组不抛错（含空数组与缺省）", () => {
      expect(() => {
        assertWorkPackIsValid(packWith([["贾政", "政老爷"]]));
      }).not.toThrow();
      expect(() => {
        assertWorkPackIsValid(packWith([]));
      }).not.toThrow();
    });

    it("⚠️ 回归护栏：**已注册的**红楼包声明的别名组本身合法（模块加载时已断言）", () => {
      const pack = resolveWorkPack("红楼梦").pack;
      expect(() => {
        assertWorkPackIsValid(pack);
      }).not.toThrow();
      // 且确实声明了组 —— 否则「跑一次 analyze 就触发」这条防线是空的。
      expect((pack.aliasGroups ?? []).length).toBeGreaterThan(0);
    });
  });

  it("列出全部已注册作品包", () => {
    expect(listRegisteredWorkPacks().map((item) => item.id).sort()).toEqual([
      "hong-lou-meng",
      "rulin-waishi"
    ]);
  });
});
