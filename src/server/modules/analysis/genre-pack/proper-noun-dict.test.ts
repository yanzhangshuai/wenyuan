import { describe, expect, it } from "vitest";

import { findPrefixConflicts, renderSegmentitDict } from "./proper-noun-dict";
import { RU_LIN_WAI_SHI_ENTRIES, RU_LIN_WAI_SHI_WORK_PACK } from "./works/rulin-waishi";

import { DEFAULT_GENRE_PACK } from "./index";

const ENTRIES = RU_LIN_WAI_SHI_ENTRIES;

describe("作品层专名词典（《儒林外史》）", () => {
  it("条目非空且无重复", () => {
    const entries = ENTRIES.map(([surface]) => surface);
    expect(entries.length).toBeGreaterThan(50);
    expect(new Set(entries).size).toBe(entries.length);
  });

  it("词性码只用专名类，保证能通过词性准入", () => {
    // 若误写成泛称码（如 1048576），词典注入了也会被 isAllowedPostag 拒收。
    for (const [surface, postag] of ENTRIES) {
      expect([128, 64], `「${surface}」词性码应为人名(128)或地名(64)`).toContain(postag);
    }
  });

  it("不含单字专名（单字名歧义过大）", () => {
    for (const [surface] of ENTRIES) {
      expect(surface.length, `「${surface}」过短`).toBeGreaterThanOrEqual(2);
    }
  });

  it("**分层护栏**：作品包与题材包必须是两个东西", () => {
    // 这条断言存在的理由：曾经的层级错位 —— 把《儒林外史》的人名当成
    // 「古典中文」这个**题材**的专名。若两者被混成一层，
    // 下一部书（《三国演义》）会带着本书的人名进分词词典，
    // 而症状是「分词莫名其妙变差」，不会报错。
    expect(RU_LIN_WAI_SHI_WORK_PACK.id).not.toBe(DEFAULT_GENRE_PACK.id);
    // 作品包有专名，题材包**没有**专名字段 —— 类型上就分开了。
    expect(RU_LIN_WAI_SHI_WORK_PACK.properNouns.length).toBeGreaterThan(0);
    expect("properNouns" in DEFAULT_GENRE_PACK).toBe(false);
  });
});

describe("findPrefixConflicts", () => {
  it("当前词典无前缀冲突", () => {
    // 前缀冲突会让 segmentit 在同词频下优先取短词，
    // 静默破坏长词切分（实测「杨执中」被切成「杨执|中道」）。
    expect(findPrefixConflicts(ENTRIES)).toEqual([]);
  });

  it("**变异自测**：真的存在前缀冲突时不得返回空数组", () => {
    // 否则「无冲突」这条断言可能只是**恒真**（永远绿）—— 那就等于没测。
    const conflicted = [
      ["杨执", 128],
      ["杨执中", 128]
    ] as const;
    expect(findPrefixConflicts(conflicted)).toEqual([["杨执", "杨执中"]]);
  });
});

describe("renderSegmentitDict", () => {
  it("每行严格为「词|词性|词频」三段", () => {
    // loadDict 内部是 `if (blocks.length > 2)` —— 少于三段整行被**静默忽略**。
    // 这条断言是防「注入了却不生效、且不报错」的关键。
    const lines = renderSegmentitDict(RU_LIN_WAI_SHI_WORK_PACK).split("\n");
    expect(lines.length).toBe(ENTRIES.length);
    for (const line of lines) {
      expect(line.split("|")).toHaveLength(3);
    }
  });

  it("词频为同一高值，保证压过内置词典", () => {
    const lines = renderSegmentitDict(RU_LIN_WAI_SHI_WORK_PACK).split("\n");
    const frequencies = new Set(lines.map((line) => line.split("|")[2]));
    expect(frequencies.size).toBe(1);
    expect(Number([...frequencies][0])).toBeGreaterThanOrEqual(100000);
  });

  it("词性码与条目声明一致", () => {
    const lines = renderSegmentitDict(RU_LIN_WAI_SHI_WORK_PACK).split("\n");
    for (const [index, line] of lines.entries()) {
      const expected = ENTRIES[index];
      expect(expected).toBeDefined();
      const [surface, postag] = expected as readonly [string, number];
      expect(line).toBe(`${surface}|${String(postag)}|100000`);
    }
  });

  it("**护栏**：前缀冲突必须抛错，而不是返回一份坏词典", () => {
    expect(() =>
      renderSegmentitDict({
        id         : "broken",
        label      : "故意冲突的作品包",
        properNouns: [
          ["杨执", 128],
          ["杨执中", 128]
        ],
        properNounFrequency: 100000
      })
    ).toThrow(/前缀冲突/);
  });
});

describe("题材包 —— 词表不变量", () => {
  it("**护栏**：后缀表必须按长度降序（`matchSuffix` 靠这个实现最长匹配优先）", () => {
    // `matchSuffix` 是「第一个命中的就返回」，因此顺序即优先级。
    // 若表被乱序（例如有人手工加词没排序），「监察御史」会被「御史」抢先命中，
    // 前缀判断随之错位 —— 这类错误不会报错，只会静默降低准确率。
    const tables: [name: string, list: readonly string[]][] = [
      ["officeSuffixes", DEFAULT_GENRE_PACK.lexicon.officeSuffixes],
      ["occupationSuffixes", DEFAULT_GENRE_PACK.lexicon.occupationSuffixes],
      ["appellationWords", DEFAULT_GENRE_PACK.lexicon.appellationWords]
    ];

    for (const [name, list] of tables) {
      for (let index = 1; index < list.length; index += 1) {
        const previous = list[index - 1] ?? "";
        const current = list[index] ?? "";
        expect(
          previous.length >= current.length,
          `${name} 第 ${String(index)} 项「${current}」比前一项「${previous}」长 —— 表未按长度降序`
        ).toBe(true);
      }
    }
  });

  it("停用表是精确匹配的集合（不得退化成子串匹配）", () => {
    // 「只砍光杆泛称」是整张表的安全边界：`夫人` 在表内，但 `王夫人` 是具体角色。
    expect(DEFAULT_GENRE_PACK.lexicon.stopWords.has("夫人")).toBe(true);
    expect(DEFAULT_GENRE_PACK.lexicon.stopWords.has("王夫人")).toBe(false);
  });
});

describe("题材包 —— 提示词与关系目录必须自洽", () => {
  it("**护栏**：提取提示词里必须列出本包关系目录的每一个码", () => {
    // 提示词里的关系码由**本包自己的**目录生成。若有人换了目录却没让提示词跟上，
    // 模型会拿到一份不存在的关系码清单 —— 输出全被判 `unknown_relation_code`，
    // 而症状是「关系召回率莫名归零」，不是报错。
    for (const relation of DEFAULT_GENRE_PACK.relationTypes) {
      expect(
        DEFAULT_GENRE_PACK.prompts.extractionSystem.includes(relation.code),
        `提示词缺少关系码「${relation.code}」`
      ).toBe(true);
    }
  });

  it("提取提示词是纯常量（不得含分片变量，否则前缀缓存失效）", () => {
    // 前缀缓存是省 token 的主要来源，前提是这段文本逐字节稳定。
    expect(DEFAULT_GENRE_PACK.prompts.extractionSystem).not.toContain("${");
    expect(DEFAULT_GENRE_PACK.prompts.extractionSystem.length).toBeGreaterThan(200);
  });
});
