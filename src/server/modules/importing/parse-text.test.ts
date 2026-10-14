import { describe, expect, it } from "vitest";

import { annotateLines } from "./annotate";
import { normalizeEncoding } from "./canonicalize";
import {
  FRONT_MATTER_ORDINAL,
  hasOversizedChapter,
  isChapterHeading,
  paragraphsFromAnnotatedLines,
  parseChapters,
  splitParagraphs
} from "./parse-text";

describe("isChapterHeading", () => {
  it("识别中文古典回目", () => {
    expect(isChapterHeading("第一回 宴桃园豪杰三结义")).toBe(true);
    expect(isChapterHeading("第三十六回")).toBe(true);
  });

  it("识别中文现代章节", () => {
    expect(isChapterHeading("第1章 初见")).toBe(true);
    expect(isChapterHeading("第 12 章")).toBe(true);
    expect(isChapterHeading("卷一")).toBe(true);
  });

  it("识别英文章节", () => {
    expect(isChapterHeading("Chapter 1")).toBe(true);
    expect(isChapterHeading("CHAPTER XII")).toBe(true);
  });

  it("拒绝空行与过长正文行", () => {
    expect(isChapterHeading("")).toBe(false);
    // ⚠️ 这条用例的字符串**必须不含标点**，否则它会被下面「禁止标点」那条规则
    // 一并拦下 —— 那样它测的就不是长度规则了（「假绿」：断言成立，但原因不是它宣称的那个）。
    // 用「回 + 一长串无标点汉字」，保证长度是**唯一**的拒绝理由。
    const tooLong = `第二回${"长".repeat(45)}`;
    expect(tooLong.length).toBeGreaterThan(40);
    expect(isChapterHeading(tooLong)).toBe(false);
  });

  it("拒绝普通叙述句", () => {
    expect(isChapterHeading("范进中举之后")).toBe(false);
  });

  // 真实语料回归：《儒林外史》TXT 版标题带「正文」前缀与全角空格缩进。
  // 修复前 `^第...` 匹配不上 → 整本 33 万字被解析成 1 章（已被端到端验证捕获）。
  it("识别带语料噪声前缀的标题（全角缩进 + 正文 前缀）", () => {
    expect(isChapterHeading("\u3000\u3000正文 第一回　说楔子敷陈大义　借名流隐括全文")).toBe(true);
    expect(isChapterHeading("正文 第二回　王孝廉村学识同科")).toBe(true);
    expect(isChapterHeading("全文 第三章 初次相遇")).toBe(true);
    expect(isChapterHeading("VIP 第12章")).toBe(true);
  });

  it("不剥离正文中间的「正文」二字", () => {
    expect(isChapterHeading("这段正文 第一回里写的不是标题")).toBe(false);
  });
});

describe("isChapterHeading —— 正文里的回指句不得被误判为标题", () => {
  /**
   * 这组用例来自**第二本书**（《红楼梦》）暴露的缺陷，不是想象出来的。
   *
   * 第五回开头有一句正文回指：
   *   「第四回中既将薛家母子在荣府内寄居等事略已表明，此回则暂不能写矣。」
   * 它 29 字、独占一行、以「第四回」开头 —— 同时满足「独占一行」与「≤40 字」
   * 两条判据，于是被当成回目，**第五回被劈成两章**，
   * 此后全书回号整体偏移一位（第六回变成 ordinal 7）。
   *
   * 这与「前言占用了 ordinal 1」属于同一类错误：章节轴错位，
   * 而 PRF 数字上完全看不出来。
   */

  const RECALL_SENTENCE = "第四回中既将薛家母子在荣府内寄居等事略已表明，此回则暂不能写矣。";

  it("**回归护栏**：含中文停顿标点的回指句不是标题", () => {
    expect(isChapterHeading(RECALL_SENTENCE)).toBe(false);
  });

  it("**隔离护栏**：把同一句的标点去掉后**会**被判成标题 —— 拦它的是标点，不是长度", () => {
    // 若只写上面那条，变异测试无法区分「标点规则生效」与「恰好被长度规则拦下」。
    // 本条把长度因素消掉（30 字 < 40），使「标点」成为唯一的判别依据。
    const withoutPunctuation = RECALL_SENTENCE.replace(/[，。]/g, "");
    expect(withoutPunctuation.length).toBeLessThanOrEqual(40);
    expect(isChapterHeading(withoutPunctuation)).toBe(true);
  });

  it("仍接受不含句末标点的正常标题（含中文冒号）", () => {
    expect(isChapterHeading("第一回　说楔子敷陈大义　借名流隐括全文")).toBe(true);
    expect(isChapterHeading("第一章：起")).toBe(true);
    expect(isChapterHeading("第3章　风起")).toBe(true);
  });

  it("仍接受含 ASCII 逗号的英文章节标题（规则只收中文标点）", () => {
    expect(isChapterHeading("Chapter 1, The Beginning")).toBe(true);
  });

  it("端到端：回指句不再把一章劈成两章", () => {
    // ⚠️ fixture 里**伪标题后面必须真的有正文**。
    // 初版把回指句写成「标题 + 空行 + 下一个标题」，于是那个伪章节的正文为空，
    // 被 `parseChapters` 的「跳过没有正文的空章节」过滤掉 —— 变异测试显示
    // 这条用例**杀不死「标点规则被关掉」**（假绿）。真实文本里回指句后面
    // 跟着第五回剩下的全部内容，所以必须补上正文才等价。
    const raw = [
      "第五回　开生面梦演红楼梦",
      "甲文。",
      "",
      RECALL_SENTENCE,
      "",
      "乙文。",
      "",
      "第六回　贾宝玉初试云雨情",
      "丙文。"
    ].join("\n");
    const chapters = parseChapters(raw);
    expect(chapters.map((item) => item.title)).toEqual([
      "第五回　开生面梦演红楼梦",
      "第六回　贾宝玉初试云雨情"
    ]);
    expect(chapters.map((item) => item.ordinal)).toEqual([1, 2]);
    // 回指句必须**留在第五回正文里**，而不是消失
    expect(chapters[0]?.paragraphs.map((item) => item.text)).toContain(RECALL_SENTENCE);
  });
});

describe("splitParagraphs", () => {
  it("以空行切分段落", () => {
    const paragraphs = splitParagraphs("第一段。\n\n第二段。\n\n第三段。");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toEqual({ ordinal: 1, text: "第一段。" });
  });

  it("把段内硬折行还原为一段", () => {
    const paragraphs = splitParagraphs("第一行\n第二行\n\n下一段。");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.text).toBe("第一行 第二行");
  });

  it("忽略空段落", () => {
    expect(splitParagraphs("\n\n\n")).toEqual([]);
  });

  // 真实语料回归：TXT 流通版《儒林外史》不用空行分隔段落，
  // 每段独占一行且行间只有单个 \n。修复前整章 7000 字被并成 1 段。
  it("识别「一行一段」语料（无空行分隔）", () => {
    const text = [
      "　　“人生南北多歧路，将相神仙，也要凡人做。”",
      "　　虽然如此说，元朝末年，也曾出了一个嵌□磊落的人。",
      "　　第二日，母亲同他到隔壁秦老家，秦老留著他母子两个吃了早饭。"
    ].join("\n");
    const paragraphs = splitParagraphs(text);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]?.text).toBe("“人生南北多歧路，将相神仙，也要凡人做。”");
  });

  it("仍把真正的硬折行折叠为一段", () => {
    // 硬折行特征：行长均匀且行尾无句末标点。
    const text = [
      "第一行文字长度基本一致到这里恰好二十个字",
      "第二行文字长度基本一致到这里恰好二十个字",
      "第三行文字长度基本一致到这里恰好二十个字",
      "第四行文字长度基本一致到这里恰好二十个字"
    ].join("\n");
    const paragraphs = splitParagraphs(text);
    expect(paragraphs).toHaveLength(1);
  });

  it("空行分块与一行一段可共存", () => {
    const text = ["甲段。", "乙段。", "", "丙段。"].join("\n");
    expect(splitParagraphs(text).map((item) => item.text)).toEqual(["甲段。", "乙段。", "丙段。"]);
  });

  // ==========================================================================
  // 第二条判据：行长重尾（`median < longest × 0.5`）
  //
  // 实测背景：新语料《红楼梦》（books/红楼梦.txt，120 回）把**说话人与引语分成两行**，
  // 于是 `说道：` 这类行不以句末标点收尾，`：` 占全部行的 19.6%；
  // 加上诗社章节的诗句行（以 `，`/`；` 收尾），120 章里有 **15 章**收尾率跌破 80%，
  // 被 `lines.join(" ")` **整章并成 1 段**（第 5 章 7626 字 → 1 段），
  // 而 `sliceChapter` 不硬切超长段落 → 该章变成一个 5000–9900 字的分片。
  // ==========================================================================

  describe("行长重尾判据（收尾率之外的第二条）", () => {
    it("⚠️ 回归护栏：说话人与引语分行时，整章不得被并成一段", () => {
      // 形态取自《红楼梦》真实语料：短行（说话人+冒号）与长行（引语）交替。
      const text = [
        "　　士隐因说道：",
        "　　“适闻仙师所谈因果，实人世罕闻者，但弟子愚拙，不能洞悉明白。若蒙大开痴顽，备细一闻，弟子洗耳谛听。”",
        "　　那僧笑道：",
        "　　“你放心，如今现有一段风流公案正该了结，这一干风流冤家尚未投胎入世，趁此机会就将此蠢物夹带于中，使他去经历经历。”",
        "　　士隐听了，便不再问，遂携了女儿英莲转身入内去了。"
      ].join("\n");
      const paragraphs = splitParagraphs(text);
      // 关键断言：**不是 1 段**。并成 1 段就意味着整章失去证据定位能力。
      expect(paragraphs.length).toBeGreaterThan(1);
      expect(paragraphs[0]?.text).toBe("士隐因说道：");
    });

    it("⚠️ 回归护栏：诗句行（长短悬殊）不得被并成一段", () => {
      const text = [
        "　　满纸荒唐言，",
        "　　一把辛酸泪。",
        "　　都云作者痴，",
        "　　谁解其中味？",
        "　　空空道人看了一回，晓得这石头有些来历，遂向石头说道：“石兄，你这一段故事，据你自己说来，有些趣味，故镌写此，意欲闻世传奇。”"
      ].join("\n");
      expect(splitParagraphs(text).length).toBeGreaterThan(1);
    });

    it("硬折行仍必须折叠：行长集中（median ≈ longest）", () => {
      // 折行宽度 20，每段 45 字 → 行长为 [20,20,5] 的重复，中位行与最长行都接近 20。
      const wrapped = (text: string): string[] => {
        const out: string[] = [];
        for (let at = 0; at < text.length; at += 20) {
          out.push(text.slice(at, at + 20));
        }
        return out;
      };
      const text = [
        ...wrapped("第一段的内容长度是四十五个汉字正好折成三行其中最后一行比较短一些"),
        ...wrapped("第二段的内容长度也是四十五个汉字同样折成三行最后一行也很短")
      ].join("\n");
      expect(splitParagraphs(text)).toHaveLength(1);
    });

    it("硬折行且末行很短时仍折叠（中位数不受单个短行影响）", () => {
      const text = [
        "这一行恰好达到折行宽度所以它比别的行都要长一些确实长",
        "这一行恰好达到折行宽度所以它比别的行都要长一些确实长",
        "这一行恰好达到折行宽度所以它比别的行都要长一些确实长",
        "短。"
      ].join("\n");
      // median = 27（第 3 行），longest = 27 → 比值 1.0 ≥ 0.5 → 判为硬折行 → 折叠
      expect(splitParagraphs(text)).toHaveLength(1);
    });

    it("隔离护栏：把行长差异压平后，同一段文本改判为硬折行", () => {
      // 与上面「说话人与引语分行」同构，但把每行都补到等长 ——
      // 若结果从「多段」变成「1 段」，说明起作用的是**行长重尾**而非别的因素。
      const shortLine = "　　士隐因说道：";
      const longLine = "　　“适闻仙师所谈因果，实人世罕闻者，但弟子愚拙，不能洞悉明白。”";
      const flat = [shortLine, longLine, shortLine, longLine, shortLine].map((line) =>
        line.padEnd(longLine.length, "啊")
      );
      expect(splitParagraphs(flat.join("\n"))).toHaveLength(1);
    });

    // 下面两条把**阈值 0.5 的语义**钉住。没有它们，把阈值改成 0.9 甚至 1.0
    // 都不会有任何测试失败（实测确认过）—— 而阈值一改，判据就从
    // 「中位行是否接近最长行」悄悄变成了别的东西。
    it("阈值边界（上侧）：中位行达到最长行一半 → 判为硬折行", () => {
      // 行长 [12,12,12,20] → 中位 12 / 最长 20 = 0.6 ≥ 0.5
      const twelve = "一二三四五六七八九十十一";
      const twenty = "一二三四五六七八九十十一二三四五六七八";
      const text = [twelve, twelve, twelve, twenty].join("\n");
      expect(splitParagraphs(text)).toHaveLength(1);
    });

    it("阈值边界（下侧）：中位行不足最长行一半 → 判为一行一段", () => {
      // 行长 [8,8,8,20] → 中位 8 / 最长 20 = 0.4 < 0.5
      const eight = "一二三四五六七八";
      const twenty = "一二三四五六七八一二三四五六七八一二三四";
      const text = [eight, eight, eight, twenty].join("\n");
      expect(splitParagraphs(text).length).toBeGreaterThan(1);
    });

    it("中位数取**上**中位：偶数行长时偏向折行宽度", () => {
      // 行长 [5,8,20,20]（= 三段分别 5/8/40 字、折行宽度 20 的硬折行产物）
      // 下中位 = 8 → 8/20 = 0.4 < 0.5 → 会被误拆；上中位 = 20 → 1.0 → 正确折叠。
      // 取上中位是有理由的：硬折行里**多数行都等于折行宽度**，上中位更接近它。
      const five = "一二三四五";
      const eight = "一二三四五六七八";
      const twenty = "一二三四五六七八一二三四五六七八一二三四";
      const text = [five, eight, twenty, twenty].join("\n");
      expect(splitParagraphs(text)).toHaveLength(1);
    });
  });

  // ==========================================================================
  // 第三条判据（兜底）：折叠结果超长（`lines.join(" ").length > 2000`）
  //
  // 实测背景（2026-10-10 §3.20）：判据 ① 与 ② **都是贴边界的**。
  // 《儒林外史》第四十五回有一个块两条都差一点未命中 ——
  // 收尾率 0.714（距 0.8 差 0.086）、median / longest = 0.508（距 0.5 只差 0.008）
  // → 走 `lines.join(" ")`，把**整回 5873 字折成 1 段**。
  // `sliceChapter` 不硬切超长段落 → 整回变成 1 个分片，而段落是证据定位的最小单位。
  // ==========================================================================

  describe("折叠结果长度上限（第三条兜底）", () => {
    // 真实形态取自《儒林外史》第四十五回那个块（§3.20 Q2）：21 行、收尾 15/21 = 0.714、
    // 行长 median 298 / longest 587（比值 0.508）。这里取等比例近似（median 300 / longest 587），
    // 使 ① 与 ② **同样双双未命中**（0.714 < 0.8；300 / 587 = 0.511 ≥ 0.5）。
    const REAL_SHAPE_LENGTHS = [
      21, 120, 200, 250, 280, 290, 295, 298, 300, 300, 300, 300, 320, 340, 360, 380, 400, 450, 500,
      550, 587
    ];

    /** 按给定行长造一个块；前 `terminatedCount` 行以 `。` 收尾，其余以 `，` 收尾。 */
    const buildBlock = (lengths: readonly number[], terminatedCount: number): string =>
      lengths
        .map(
          (len, index) => "字".repeat(Math.max(len - 1, 1)) + (index < terminatedCount ? "。" : "，")
        )
        .join("\n");

    it("⚠️ 回归护栏：判据 ① ② 双双擦边未命中时，整回不得被折成 1 段", () => {
      const text = buildBlock(REAL_SHAPE_LENGTHS, 15);
      const paragraphs = splitParagraphs(text);
      // 折成 1 段 = 5873 字一个段落 = 整回失去证据定位能力。
      expect(paragraphs.length).toBeGreaterThan(1);
      expect(paragraphs).toHaveLength(REAL_SHAPE_LENGTHS.length);
    });

    it("隔离护栏：同一形态等比缩小到不超上限后，仍折叠为 1 段", () => {
      // 与上一条**同构**：收尾率（15/21）与 median 比（75/146 = 0.514）都保持不变，
      // 唯一变化是折叠结果从 6861 字降到 1726 字（≤ 2000）。
      // 若结果从「21 段」变成「1 段」，说明起作用的是**长度上限**，不是别的因素。
      const scaled = REAL_SHAPE_LENGTHS.map((len) => Math.max(2, Math.round(len / 4)));
      expect(splitParagraphs(buildBlock(scaled, 15))).toHaveLength(1);
    });

    // 下面两条把**上限 2000 的语义**钉住。没有它们，把上限改成 1e9 也不会有任何测试失败。
    it("上限边界（上侧）：折叠结果 2019 字 > 2000 → 判为「拆」", () => {
      // 20 行 × 100 字 → 折叠 = 20×100 + 19 个空格 = 2019 字
      const lengths = Array.from({ length: 20 }, () => 100);
      const paragraphs = splitParagraphs(buildBlock(lengths, 15)); // 15/20 = 0.75 < 0.8
      expect(paragraphs).toHaveLength(20);
    });

    it("上限边界（下侧）：折叠结果 1918 字 ≤ 2000 → 仍折叠为 1 段", () => {
      // 19 行 × 100 字 → 折叠 = 19×100 + 18 个空格 = 1918 字
      const lengths = Array.from({ length: 19 }, () => 100);
      expect(splitParagraphs(buildBlock(lengths, 14))).toHaveLength(1); // 14/19 = 0.737 < 0.8
    });
  });
});

// ==========================================================================
// §3③ 搬迁：把「事实」与「判断」拆到两个模块
//
//   annotateLines(text)              → 只产事实（长度 / 是否收尾 / 是否块首）
//   paragraphsFromAnnotatedLines(…)  → 只做判断（块内聚合 + 三条判据）
//   splitParagraphs(text)            → 两者的组合（保持旧签名不变）
//
// 等价性证据是**全量 dump 逐字节比对**（`_wb_annotate_equiv.ts`，两本书 4269 段
// 搬迁前后 `cmp` 0 差异），不是这里的用例 —— 下面这些是**防回归的护栏**，
// 尤其是那条「事实承重」用例：它证明判断确实读的是事实，
// 而不是换了个壳子又偷偷把原文解析了一遍。
// ==========================================================================

describe("§3③ 搬迁：事实与判断分离", () => {
  describe("annotateLines —— 只产事实", () => {
    it("空文本 → 空数组", () => {
      expect(annotateLines("")).toEqual([]);
      expect(annotateLines("\n\n\n")).toEqual([]);
      expect(annotateLines("　　\n\t\n")).toEqual([]);
    });

    it("行内空白（含全角空格）折叠为单个半角空格，并 trim 两端", () => {
      const [line] = annotateLines("\u3000\u3000甲\u3000乙 丙\t丁\u3000");
      expect(line?.text).toBe("甲 乙 丙 丁");
    });

    it("normalizedLength 量的是**归一化后**的长度，不是原始行长", () => {
      const raw = "\u3000\u3000“人生南北多歧路。”";
      const [line] = annotateLines(raw);
      expect(raw.length).toBe(12); // 含 2 个全角空格
      expect(line?.text).toBe("“人生南北多歧路。”");
      expect(line?.normalizedLength).toBe(10);
      expect(line?.normalizedLength).toBe(line?.text.length);
    });

    it("isTerminated 只认句末标点（`，`/`；`/`：` 不算）", () => {
      const text = ["甲。", "乙，", "丙；", "丁：", "戊？", "己！", "庚”", "辛』"].join("\n");
      expect(annotateLines(text).map((line) => line.isTerminated)).toEqual([
        true,
        false,
        false,
        false,
        true,
        true,
        true,
        true
      ]);
    });

    it("空行是块边界：空行之后的第一行才是块首", () => {
      const text = ["甲。", "乙。", "", "丙。", "丁。", "", "戊。"].join("\n");
      expect(annotateLines(text).map((line) => line.isBlockStart)).toEqual([
        true,
        false,
        true,
        false,
        true
      ]);
    });

    it("blockIndex 只在块首递增（且仅供审计 —— 判定不依赖它）", () => {
      const text = ["甲。", "乙。", "", "丙。", "丁。"].join("\n");
      expect(annotateLines(text).map((line) => line.blockIndex)).toEqual([0, 0, 1, 1]);
    });

    it("⚠️ 连续空行不产生空事实，也不会多开一个块", () => {
      const text = ["甲。", "", "", "", "乙。"].join("\n");
      const lines = annotateLines(text);
      expect(lines).toHaveLength(2);
      expect(lines.map((line) => line.blockIndex)).toEqual([0, 1]);
    });

    it("空白行（含全角空格）同样算块边界", () => {
      // ⚠️ 顺序实现（逐行扫）与「先按空行切再按 \\n 切」两种写法在这里**不同**：
      // 后者会把「只含空格的行」当成非空行。本模块取前者，因此这条要钉住。
      const text = ["甲。", "\u3000\u3000", "乙。"].join("\n");
      expect(annotateLines(text).map((line) => line.isBlockStart)).toEqual([true, true]);
    });

    it("契约：每行**只有**那三个事实 + 文本（没有「判据命中」这类判断字段）", () => {
      // 这是 §3.17 定下的接口：块内聚合是**判断**，必须留在解析器里。
      // 若哪天给行事实加上 `decision` / `hitCriterion` 之类，说明职责又混回去了。
      const [line] = annotateLines("甲。");
      expect(Object.keys(line ?? {}).sort()).toEqual([
        "blockIndex",
        "isBlockStart",
        "isTerminated",
        "normalizedLength",
        "text"
      ]);
    });
  });

  describe("paragraphsFromAnnotatedLines —— 判断由事实承重", () => {
    it("组合恒等：splitParagraphs(text) 与两步组合逐字一致", () => {
      const samples = [
        "第一段。\n\n第二段。\n\n第三段。",
        "第一行\n第二行\n\n下一段。",
        ["　　“人生南北多歧路，将相神仙，也要凡人做。”", "　　虽然如此说，元朝末年，也曾出了一个嵌□磊落的人。"].join(
          "\n"
        ),
        "",
        "\n\n\n"
      ];
      for (const sample of samples) {
        expect(splitParagraphs(sample)).toEqual(paragraphsFromAnnotatedLines(annotateLines(sample)));
      }
    });

    it("⚠️ 事实承重（正向）：只改事实、原文一字未动，判定从「拆」翻成「折」", () => {
      // 原文是「一行一段」形态（3 行、全部以 `。` 收尾、行长相等）。
      // 把事实改成「硬折行」形态（收尾全为假、行长齐平）—— 判断必须跟着事实走。
      const text = ["甲段。", "乙段。", "丙段。"].join("\n");
      const annotated = annotateLines(text);
      expect(paragraphsFromAnnotatedLines(annotated)).toHaveLength(3);

      const asHardWrapped = annotated.map((line) => ({
        ...line,
        isTerminated    : false,
        normalizedLength: 100
      }));
      // 收尾率 0/3、median 100 = longest 100（无重尾）、折叠 11 字 ≤ 2000 → 折成 1 段
      expect(paragraphsFromAnnotatedLines(asHardWrapped)).toHaveLength(1);
      // 而**输出文本一字未改**（还是原文）—— 证明被改的只是判断，不是内容
      expect(paragraphsFromAnnotatedLines(asHardWrapped)[0]?.text).toBe("甲段。 乙段。 丙段。");
    });

    it("⚠️ 事实承重（反向）：把「硬折行」的事实改成「一行一段」，输出从 1 段变 N 段", () => {
      const text = [
        "第一行文字长度基本一致到这里恰好二十个字",
        "第二行文字长度基本一致到这里恰好二十个字",
        "第三行文字长度基本一致到这里恰好二十个字",
        "第四行文字长度基本一致到这里恰好二十个字"
      ].join("\n");
      const annotated = annotateLines(text);
      expect(paragraphsFromAnnotatedLines(annotated)).toHaveLength(1);

      const asOnePerLine = annotated.map((line) => ({ ...line, isTerminated: true }));
      expect(paragraphsFromAnnotatedLines(asOnePerLine)).toHaveLength(4);
      expect(asOnePerLine.map((line) => line.text)).toEqual(annotated.map((line) => line.text));
    });

    it("⚠️ 块边界由 isBlockStart 决定：没有空行 = 同一块", () => {
      const annotated = annotateLines(["甲行", "乙行"].join("\n"));
      expect(annotated.map((line) => line.isBlockStart)).toEqual([true, false]);
      // 同块：收尾 0/2、行长相等（无重尾）、折叠 5 字 → 1 段
      expect(paragraphsFromAnnotatedLines(annotated)).toHaveLength(1);
    });

    it("⚠️ 反向：只把第二行标成块首，同一份原文立刻变成 2 段", () => {
      const annotated = annotateLines(["甲行", "乙行"].join("\n")).map((line, index) =>
        index === 1 ? { ...line, isBlockStart: true } : line
      );
      expect(paragraphsFromAnnotatedLines(annotated)).toHaveLength(2);
    });

    it("输出文本取自 line.text（不是原文），改 text 即改输出", () => {
      const annotated = annotateLines(["甲。", "", "乙。"].join("\n"));
      const renamed = annotated.map((line) => ({ ...line, text: `【改】${line.text}` }));
      expect(paragraphsFromAnnotatedLines(renamed).map((item) => item.text)).toEqual([
        "【改】甲。",
        "【改】乙。"
      ]);
    });

    it("ordinal 从 1 起、连续、无空洞", () => {
      const paragraphs = paragraphsFromAnnotatedLines(annotateLines("甲。\n\n乙。\n\n丙。"));
      expect(paragraphs.map((item) => item.ordinal)).toEqual([1, 2, 3]);
    });

    it("空事实 → 空段落列表", () => {
      expect(paragraphsFromAnnotatedLines([])).toEqual([]);
    });
  });
});

describe("parseChapters", () => {
  it("按章节标题切分多章", () => {
    const raw = "第一回 起\n甲文。\n\n乙文。\n\n第二回 承\n丙文。";
    const chapters = parseChapters(raw);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe("第一回 起");
    expect(chapters[0]?.ordinal).toBe(1);
    expect(chapters[0]?.paragraphs).toHaveLength(2);
    expect(chapters[1]?.title).toBe("第二回 承");
  });

  it("无章节标题时整本作为单章", () => {
    const chapters = parseChapters("甲文。\n\n乙文。");
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("前言");
  });

  it("保留标题之前的引言内容", () => {
    const chapters = parseChapters("引言一段。\n\n第一回 起\n正文。");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe("前言");
    expect(chapters[0]?.text).toBe("引言一段。");
  });

  it("归一化 CRLF 换行", () => {
    const chapters = parseChapters("第一回\r\n甲文。\r\n\r\n乙文。");
    expect(chapters[0]?.paragraphs).toHaveLength(2);
  });

  it("编码归一是幂等的前置步骤：先归一再解析，结果逐字节相同", () => {
    // 这条钉住「把编码归一化提到读文件之后」是**零影响**的改动。
    // 若哪天有人让 normalizeEncoding 顺手改标点或空白，这里会立刻失败。
    for (const raw of [
      "第一回　楔子\r\n甲文。\r\n\r\n乙文。",
      "\uFEFF第一回　楔子\r\n甲文。\u200b",
      "第一回　楔子\n甲文。\n\n乙文。"
    ]) {
      expect(parseChapters(normalizeEncoding(raw)), JSON.stringify(raw)).toEqual(parseChapters(raw));
    }
  });

  it("跳过没有正文的空章节标题", () => {
    const chapters = parseChapters("第一回 空\n\n第二回 有内容\n甲文。");
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("第二回 有内容");
  });

  it("段落序号从 1 连续递增", () => {
    const chapters = parseChapters("第一回 起\n甲。\n\n乙。\n\n丙。");
    expect(chapters[0]?.paragraphs.map((item) => item.ordinal)).toEqual([1, 2, 3]);
  });

  it("标题存入时剥离语料噪声前缀", () => {
    const chapters = parseChapters("\u3000\u3000正文 第一回　楔子\n甲文。");
    expect(chapters[0]?.title).toBe("第一回　楔子");
  });

  it("带前缀的标题能切出多章（整本不塌成单章）", () => {
    const raw = [
      "\u3000\u3000正文 前言",
      "本书说明。",
      "",
      "\u3000\u3000正文 第一回　楔子",
      "甲文。",
      "",
      "\u3000\u3000正文 第二回　承题",
      "乙文。"
    ].join("\n");
    const chapters = parseChapters(raw);
    expect(chapters).toHaveLength(3);
    expect(chapters.map((item) => item.title)).toEqual([
      "前言",
      "第一回　楔子",
      "第二回　承题"
    ]);
  });
});

describe("parseChapters —— 回号语义（关键：前置内容不得占用回号）", () => {
  /**
   * 这组用例守的是一个**整本书偏移一位**的缺陷：
   * 若前置内容占了 `ordinal = 1`，则第一回是 2、第三回是 4，
   * 于是 UI 把第三回的边显示成「第 4 章起」，
   * 金标区间 `[1,3]`（意为第 1–3 回）也会实际取到「前言 + 第一回 + 第二回」。
   */

  it("前置内容不占用回号：前言为 0，第一回为 1", () => {
    const chapters = parseChapters("出版方导读一段。\n\n第一回 起\n正文。");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.isFrontMatter).toBe(true);
    expect(chapters[0]?.ordinal).toBe(FRONT_MATTER_ORDINAL);
    expect(chapters[1]?.isFrontMatter).toBe(false);
    expect(chapters[1]?.ordinal).toBe(1);
  });

  it("真实章节回号从 1 起连续递增（回号 = 第几回）", () => {
    const raw = "导读。\n\n第一回 起\n甲文。\n\n第二回 承\n乙文。\n\n第三回 转\n丙文。";
    const chapters = parseChapters(raw);
    expect(chapters.map((item) => item.ordinal)).toEqual([0, 1, 2, 3]);
    expect(chapters.map((item) => item.isFrontMatter)).toEqual([true, false, false, false]);
  });

  it("**护栏**：全书无标题标记时，整本正文拿到序号 1 而非 0", () => {
    // 若这里返回 0，管线会把**整本书**当成前置内容跳过 —— 静默产出一张空图。
    const chapters = parseChapters("甲文。\n\n乙文。");
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.isFrontMatter).toBe(false);
    expect(chapters[0]?.ordinal).toBe(1);
  });

  it("标题前只有空行时不产生前置内容，第一回仍是 1", () => {
    const chapters = parseChapters("\n\n\n第一回 起\n正文。");
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.isFrontMatter).toBe(false);
    expect(chapters[0]?.ordinal).toBe(1);
  });

  it("首个标题即第一章时，第一章的回号就是 1", () => {
    const chapters = parseChapters("第一回 起\n甲文。\n\n第二回 承\n乙文。");
    expect(chapters.map((item) => item.ordinal)).toEqual([1, 2]);
    expect(chapters.every((item) => !item.isFrontMatter)).toBe(true);
  });
});

describe("hasOversizedChapter", () => {
  it("超过阈值时返回 true", () => {
    const chapters = parseChapters(`前言\n${"甲".repeat(70_000)}`);
    expect(hasOversizedChapter(chapters)).toBe(true);
  });

  it("正常长度返回 false", () => {
    const chapters = parseChapters("第一回 起\n甲文。");
    expect(hasOversizedChapter(chapters)).toBe(false);
  });
});
