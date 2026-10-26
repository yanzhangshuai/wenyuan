// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatGroupsText, formatNounsText, parseGroupsText, parseNounsText } from "@/lib/pack-text";
import { mergeCandidates, scanAppellations } from "@/server/modules/analysis/pack-suggest/appellations";
import { extractSamples } from "@/server/modules/analysis/pack-suggest/samples";
import { sanitizeSuggestions, stripCodeFence, type SuggestCandidate } from "@/server/modules/analysis/pack-suggest/suggest";

/**
 * 「解析条件自动生成」的纯函数测试。
 *
 * 这一层的每个函数都在**防止一种具体的坏结果**：
 * - `scanAppellations` 漏召 → 别名组永远只有几组（实测踩过：3 组 vs 内置 32 组）；
 * - `sanitizeSuggestions` 太松 → 混进「李贵忙」这种名字+动词的假别名；
 * - `parseNounsText` 解析错 → 用户粘 200 行名字，保存后变成乱码词条。
 */

describe("extractSamples", () => {
  const text = "宝玉笑道：“好妹妹。”黛玉便哭了。宝玉忙劝。宝玉又道：“别哭。”";

  it("只取包含目标名的整句，不去截半句", () => {
    const samples = extractSamples(text, "宝玉", 2);
    expect(samples).toHaveLength(2);
    expect(samples.every((item) => item.includes("宝玉"))).toBe(true);
  });

  it("去重：重复段落不会让 3 条片段变成同一条", () => {
    const repeated = "宝玉来了。宝玉来了。宝玉来了。";
    const samples = extractSamples(repeated, "宝玉", 3);
    expect(samples).toHaveLength(1);
  });

  it("找不到时返回空数组（调用方据此判断「这名字没有原文依据」）", () => {
    expect(extractSamples(text, "薛蟠")).toEqual([]);
  });

  it("超长句子截断并加省略号", () => {
    const long = `${"宝".repeat(200)}玉。`;
    const samples = extractSamples(long, "宝玉", 1);
    expect(samples[0]?.endsWith("…")).toBe(true);
    expect(samples[0]?.length).toBeLessThanOrEqual(81);
  });
});

describe("scanAppellations", () => {
  it("捞出分词器切不出的称谓写法", () => {
    const text = "宝二爷来了。宝二爷坐下。宝二爷笑道。";
    const found = scanAppellations(text, 2);
    const names = found.map((item) => item.name);
    expect(names).toContain("宝二爷");
  });

  it("排除「代词 + 称谓」（他爷、你老爷）", () => {
    const text = "他爷说了。他爷又说了。你老爷也说了。你老爷再说。";
    const names = scanAppellations(text, 1).map((item) => item.name);
    expect(names).not.toContain("他爷");
    expect(names).not.toContain("你老爷");
  });

  it("低于频次门槛的不返回", () => {
    const text = "宝二爷来了。";
    expect(scanAppellations(text, 2)).toEqual([]);
  });
});

describe("mergeCandidates", () => {
  const chapters = [
    { ordinal: 1, text: "宝玉出场。" },
    { ordinal: 2, text: "宝二爷出场。" }
  ];

  it("分词候选优先：同名词频与首现回目以分词结果为准", () => {
    const merged = mergeCandidates(
      [{ surface: "宝玉", frequency: 99, firstChapter: 1 }],
      [{ name: "宝玉", frequency: 3 }],
      chapters
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.frequency).toBe(99);
  });

  it("称谓候选补上首现回目", () => {
    const merged = mergeCandidates([], [{ name: "宝二爷", frequency: 5 }], chapters);
    expect(merged[0]?.firstChapter).toBe(2);
  });

  it("按频次降序", () => {
    const merged = mergeCandidates(
      [
        { surface: "甲", frequency: 3, firstChapter: 1 },
        { surface: "乙", frequency: 10, firstChapter: 1 }
      ],
      [],
      chapters
    );
    expect(merged.map((item) => item.name)).toEqual(["乙", "甲"]);
  });
});

describe("sanitizeSuggestions（别名校验用全书正文）", () => {
  const candidates: SuggestCandidate[] = [
    { name: "宝玉", frequency: 300, firstChapter: 1, samples: ["宝玉笑道：“好妹妹。”", "宝二爷来了。"] },
    { name: "李贵", frequency: 20, firstChapter: 2, samples: ["李贵忙道：“是。”"] }
  ];
  /** 全文：包含片段里的写法，另外含「怡红公子」（片段里没有，但全书有）。 */
  const fullText = "宝玉笑道：“好妹妹。”宝二爷来了。李贵忙道：“是。”怡红公子题诗。";

  it("证据里出现的别名保留", () => {
    const result = sanitizeSuggestions(candidates, {
      persons: [{ name: "宝玉", aliases: ["宝二爷"], reason: "同段出现" }],
      rejects: []
    }, fullText);
    expect(result.persons[0]?.aliases).toEqual(["宝二爷"]);
    expect(result.droppedAliases).toHaveLength(0);
  });

  it("以动词结尾的别名被砍（李贵忙 这类截断）", () => {
    const result = sanitizeSuggestions(candidates, {
      persons: [{ name: "李贵", aliases: ["李贵忙"], reason: "" }],
      rejects: []
    }, fullText);
    expect(result.persons[0]?.aliases).toEqual([]);
    expect(result.droppedAliases[0]?.reason).toContain("动词");
  });

  it("片段里没有、但全书正文里有的别名**保留**（曾经误杀过 3/4）", () => {
    // 2026-10-26 实测：用片段当判据时证据覆盖率只有 25.6%，
    // 「怡红公子」这类真别名因为没落在那两条 80 字片段里被整批砍掉。
    const result = sanitizeSuggestions(candidates, {
      persons: [{ name: "宝玉", aliases: ["怡红公子"], reason: "" }],
      rejects: []
    }, fullText);
    expect(result.persons[0]?.aliases).toEqual(["怡红公子"]);
    expect(result.droppedAliases).toHaveLength(0);
  });

  it("全书正文里都没有的别名被砍（防模型编造）", () => {
    const result = sanitizeSuggestions(candidates, {
      persons: [{ name: "宝玉", aliases: ["绛洞花主"], reason: "" }],
      rejects: []
    }, fullText);
    expect(result.persons[0]?.aliases).toEqual([]);
    expect(result.droppedAliases[0]?.reason).toContain("全书正文");
  });

  it("不在候选里的名字被丢弃（模型不能凭空造人）", () => {
    const result = sanitizeSuggestions(candidates, {
      persons: [{ name: "孙悟空", aliases: [], reason: "" }],
      rejects: []
    }, fullText);
    expect(result.persons).toHaveLength(0);
  });

  it("别名不能等于自己", () => {
    const result = sanitizeSuggestions(candidates, {
      persons: [{ name: "宝玉", aliases: ["宝玉"], reason: "" }],
      rejects: []
    }, fullText);
    expect(result.persons[0]?.aliases).toEqual([]);
  });

  it("rejects 只保留候选里的名字", () => {
    const result = sanitizeSuggestions(candidates, {
      persons: [],
      rejects: [
        { name: "李贵", reason: "言语提示" },
        { name: "不存在", reason: "x" }
      ]
    }, fullText);
    expect(result.rejects.map((item) => item.name)).toEqual(["李贵"]);
  });
});

describe("stripCodeFence", () => {
  it("剥掉 ```json 围栏", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("没有围栏时原样返回（去首尾空白）", () => {
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe("解析条件文本格式", () => {
  it("专名：每行一个，可写 `名字,64` 指定地名", () => {
    expect(parseNounsText("贾宝玉\n荣国府,64\n\n  林黛玉  ")).toEqual([
      { name: "贾宝玉", postag: 128 },
      { name: "荣国府", postag: 64 },
      { name: "林黛玉", postag: 128 }
    ]);
  });

  it("专名：空行与纯空白行被忽略", () => {
    expect(parseNounsText("\n\n  \n")).toEqual([]);
  });

  it("别名组：`=` 与 `＝` 都认，单元素行丢弃", () => {
    expect(parseGroupsText("宝玉 = 宝二爷 ＝ 怡红公子\n孤零零\n甲=乙")).toEqual([
      ["宝玉", "宝二爷", "怡红公子"],
      ["甲", "乙"]
    ]);
  });

  it("回填格式与解析互为逆运算（避免保存一次就漂移）", () => {
    const nouns = [
      { name: "贾宝玉", postag: 128 },
      { name: "荣国府", postag: 64 }
    ];
    expect(parseNounsText(formatNounsText(nouns))).toEqual(nouns);

    const groups = [["宝玉", "宝二爷"]];
    expect(parseGroupsText(formatGroupsText(groups))).toEqual(groups);
  });
});
