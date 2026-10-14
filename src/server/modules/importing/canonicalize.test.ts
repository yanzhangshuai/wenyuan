import { describe, expect, it } from "vitest";

import { STRUCTURAL_NOISE_PATTERNS, normalizeEncoding, stripStructuralNoise } from "./canonicalize";
import { parseChapters } from "./parse-text";

describe("normalizeEncoding", () => {
  it("剥离行首 BOM", () => {
    expect(normalizeEncoding("\uFEFF第一回　楔子")).toBe("第一回　楔子");
  });

  it("CRLF 与孤立 CR 都归一为 LF", () => {
    expect(normalizeEncoding("甲。\r\n乙。\r丙。")).toBe("甲。\n乙。\n丙。");
  });

  it("剥离零宽字符", () => {
    expect(normalizeEncoding("甲\u200b乙\u200d丙\ufeff丁")).toBe("甲乙丙丁");
  });

  it("⚠️ 不把 U+2028 / U+2029 当零宽删掉（它们是换行符，不是零宽字符）", () => {
    // 删掉会把两行粘成一行；`splitParagraphs` 的 [\s\u3000]+ 本来就会折叠它们。
    expect(normalizeEncoding("甲\u2028乙\u2029丙")).toBe("甲\u2028乙\u2029丙");
  });

  it("幂等", () => {
    const raw = "\uFEFF甲。\r\n乙。\u200b";
    expect(normalizeEncoding(normalizeEncoding(raw))).toBe(normalizeEncoding(raw));
  });

  it("不改动正常正文（含全角缩进与全角空格）", () => {
    const text = "　　“人生南北多歧路，将相神仙，也要凡人做。”\n　　虽然如此说，元朝末年。";
    expect(normalizeEncoding(text)).toBe(text);
  });
});

describe("stripStructuralNoise —— 白名单自身的不变量", () => {
  // 这三条是**故意的报警器**：白名单是安全边界，改动它必须是一次被看见的动作。
  it("⚠️ 白名单只有三条：加规则要先改文档 §3.7 并逐条抽样核对", () => {
    expect(STRUCTURAL_NOISE_PATTERNS).toHaveLength(3);
  });

  it("⚠️ 每条模式都必须整行锚定（^…$）—— 否则会退化成子串替换", () => {
    for (const [label, pattern] of STRUCTURAL_NOISE_PATTERNS) {
      expect(pattern.source.startsWith("^"), label).toBe(true);
      expect(pattern.source.endsWith("$"), label).toBe(true);
    }
  });

  it("⚠️ 模式不得带 g 标志：否则 test() 的 lastIndex 会让结果随调用次数漂移", () => {
    for (const [label, pattern] of STRUCTURAL_NOISE_PATTERNS) {
      expect(pattern.flags.includes("g"), label).toBe(false);
    }
  });
});

describe("stripStructuralNoise —— 三条白名单", () => {
  it("删掉字数标记行（半角与全角冒号、带缩进、带尾随空白都认）", () => {
    for (const line of ["本章字数:7415", "本章字数：6302", "　　本章字数:7415", "本章字数:7415 "]) {
      const result = stripStructuralNoise(line);
      expect(result.deletions, line).toHaveLength(1);
      expect(result.text).toBe("");
    }
  });

  it("删掉分隔线行（≥4 个同类符号）", () => {
    for (const line of ["------------------", "----", "====", "****", "~~~~", "————"]) {
      expect(stripStructuralNoise(line).deletions, line).toHaveLength(1);
    }
  });

  it("分隔线的字符类只收**半角** `~`：全角 `～` 不在白名单里（边界，故意不收）", () => {
    // 写这条是因为我自己一开始就写错了（把 `～～～～` 当成会被删）。
    // 白名单的字符类逐字写在文档 §3.7，放宽它必须先改文档 —— 这里把边界钉住。
    expect(stripStructuralNoise("～～～～").deletions).toHaveLength(0);
  });

  it("删掉「本章完」标记行（全角/半角括号、括号内空白都认）", () => {
    for (const line of ["(本章完)", "（本章完）", "（ 本章完 ）", "　　(本章完)"]) {
      expect(stripStructuralNoise(line).deletions, line).toHaveLength(1);
    }
  });

  it("整行匹配：正文里出现同样的字样不得被删", () => {
    for (const line of [
      "他说：「本章字数:7415」",
      "本章字数:7415字", // 行尾还有字
      "本章字数:abc", // 不是数字
      "---- 分隔 ----",
      "本章完", // 没有括号
      "（本章完了）"
    ]) {
      const result = stripStructuralNoise(line);
      expect(result.deletions, line).toHaveLength(0);
      expect(result.text, line).toBe(line);
    }
  });

  it("--- 只有 3 个连字符，不构成分隔线", () => {
    expect(stripStructuralNoise("---").deletions).toHaveLength(0);
  });
});

describe("stripStructuralNoise —— ⚠️ 反作弊：不得静默删掉正文", () => {
  /**
   * 这组用例来自**实测教训**，不是想象出来的。
   *
   * 探针里曾写过一条「推广 / 来源行」规则（含 `整理` / `免费` / `转自` 等关键词），
   * 它在儒林外史命中 6 段、红楼梦命中 13 段 —— 抽样一看**全是正文**：
   * 「须臾，**整理**停当，何美之捧出盘子来。」
   *
   * 通用降噪规则会静默删掉正文，且删掉之后**没有任何信号**。
   * 因此这里把「含这些字样的正文必须原样保留」钉成回归护栏：
   * 谁想放宽白名单，先让这组用例失败。
   */
  const PROSE = [
    "须臾，整理停当，何美之捧出盘子来。",
    "本电子书免费提供，请勿转自商业用途。",
    "他整理了一下衣冠，转自后堂出来。",
    "众人校对了一遍，又录入了一遍。",
    "下载之后再看也不迟。"
  ];

  it("含推广类关键词的正文段落必须原样保留", () => {
    for (const line of PROSE) {
      const result = stripStructuralNoise(line);
      expect(result.deletions, line).toHaveLength(0);
      expect(result.text, line).toBe(line);
    }
  });

  it("整篇正文（含上述段落）逐行核对后一行不少", () => {
    const text = ["第一回　楔子", ...PROSE].join("\n");
    const result = stripStructuralNoise(text);
    expect(result.deletions).toHaveLength(0);
    expect(result.text.split("\n")).toHaveLength(PROSE.length + 1);
  });
});

describe("stripStructuralNoise —— 删除区间清单", () => {
  const MIXED = [
    "第一回　说楔子敷陈大义",
    "本章字数:7415",
    "　　人生南北多歧路，将相神仙，也要凡人做。",
    "　　须臾，整理停当，何美之捧出盘子来。",
    "------------------",
    "　　第二回　王孝廉村学识同科",
    "本章字数：6302",
    "　　话说山东兖州府汶上县有个乡村。",
    "(本章完)"
  ].join("\n");

  it("逐条给出原文行号、标签与内容", () => {
    const result = stripStructuralNoise(MIXED);
    expect(result.deletions).toEqual([
      { lineNo: 2, label: "字数标记", text: "本章字数:7415" },
      { lineNo: 5, label: "分隔线", text: "------------------" },
      { lineNo: 7, label: "字数标记", text: "本章字数：6302" },
      { lineNo: 9, label: "本章完标记", text: "(本章完)" }
    ]);
  });

  it("正文一行不少、行序不变", () => {
    const result = stripStructuralNoise(MIXED);
    expect(result.text.split("\n")).toEqual([
      "第一回　说楔子敷陈大义",
      "　　人生南北多歧路，将相神仙，也要凡人做。",
      "　　须臾，整理停当，何美之捧出盘子来。",
      "　　第二回　王孝廉村学识同科",
      "　　话说山东兖州府汶上县有个乡村。"
    ]);
  });

  it("幂等：对已剥离的文本再跑一次没有删除项", () => {
    const once = stripStructuralNoise(MIXED);
    const twice = stripStructuralNoise(once.text);
    expect(twice.deletions).toHaveLength(0);
    expect(twice.text).toBe(once.text);
  });

  it("空文本与纯空行不报删除项", () => {
    expect(stripStructuralNoise("").deletions).toHaveLength(0);
    expect(stripStructuralNoise("\n\n\n").deletions).toHaveLength(0);
  });
});

describe("normalizeEncoding + stripStructuralNoise 组合", () => {
  it("CRLF 文本先归一化再删行，结果与 LF 输入一致", () => {
    const lf = "第一回　楔子\n本章字数:7415\n正文。";
    const crlf = lf.replace(/\n/g, "\r\n");
    const fromLf = stripStructuralNoise(normalizeEncoding(lf));
    const fromCrlf = stripStructuralNoise(normalizeEncoding(crlf));
    expect(fromCrlf.text).toBe(fromLf.text);
    expect(fromCrlf.deletions).toEqual(fromLf.deletions);
  });
});

describe("接线契约：normalizeEncoding → stripStructuralNoise → parseChapters", () => {
  // 这三步的顺序就是 `scripts/import-book.ts` 的顺序，且**不可交换**：
  // 先归编码（CRLF 归一后 `trim()` 才可靠），再删整行。
  // 本组用例钉住的是「删行只移动**序号**，不改变叙事段落的内容」——
  // 这是金标（回号 + 段号 + 原文引用）能继续核对的前提。

  it("删行后叙事段落**逐字保留**，只是序号平移（儒林外史每回头部的字数标记）", () => {
    const text = [
      "第一回　测试",
      "",
      "本章字数:7415",
      "",
      "甲段。",
      "",
      "乙段。",
      "",
      "------------------"
    ].join("\n");

    const before = parseChapters(normalizeEncoding(text))[0]?.paragraphs ?? [];
    const after = parseChapters(stripStructuralNoise(normalizeEncoding(text)).text)[0]?.paragraphs ?? [];

    // 删行前：两条噪声各自成段（在**头部**与**尾部**）。
    expect(before.map((item) => item.text)).toEqual([
      "本章字数:7415",
      "甲段。",
      "乙段。",
      "------------------"
    ]);
    // 删行后：只剩叙事段，序号从 2/3 变成 1/2 —— 即**每回叙事段号 −1**。
    expect(after.map((item) => item.text)).toEqual(["甲段。", "乙段。"]);
    expect(after.map((item) => item.ordinal)).toEqual([1, 2]);
  });

  it("**反作弊**：噪声行与正文粘在同一个折行块里时，只删噪声、不删正文", () => {
    // 实测《儒林外史》第四十五回就是这种形态：整回没有空行，
    // `------------------` 被折行判定**粘进了正文那一段**里（段落数 2 → 1）。
    // 删掉它只会让该段变短，**不会**丢正文 —— 本用例钉住这一点。
    // 构造：行长接近、且多数行不以句末标点收尾 → 命中「硬折行」判据，整块 join 成一段。
    const body = [
      "甲句甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉，",
      "乙句甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉，",
      "丙句甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉。"
    ];
    const text = ["第一回　测试", "", ...body, "------------------"].join("\n");

    const before = parseChapters(normalizeEncoding(text))[0]?.paragraphs ?? [];
    const after = parseChapters(stripStructuralNoise(normalizeEncoding(text)).text)[0]?.paragraphs ?? [];
    const beforeText = before[0]?.text ?? "";
    const afterText = after[0]?.text ?? "";

    // 前提：这一块确实被折行判定合成了一段（否则本用例走的是另一条分支，什么都没测到）。
    expect(before).toHaveLength(1);
    expect(beforeText).toContain("------------------");

    expect(after).toHaveLength(1);
    expect(afterText).toBe(beforeText.replace(" ------------------", ""));
    // 正文逐行仍在。
    for (const line of body) {
      expect(afterText).toContain(line);
    }
  });
});
