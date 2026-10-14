import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RELATION_TYPE_CODES } from "@/lib/relations";

import { GoldSetSchema } from "./goldset-schema";

/**
 * 金标 schema 与**仓库内实际金标文件**的回归护栏。
 *
 * 存在理由：金标文件此前**没有任何测试覆盖**。它的错误只能在
 * 「导入真书 + 跑完整管线 + 连真数据库跑评测」之后才暴露 ——
 * 而那时看到的是一个 PRF 数字，**看不出错误来自金标还是来自系统**。
 * 本项目的四次「坏的是尺子」全部属于这一类。
 *
 * 因此这里做两件事：
 * 1. **让金标文件必须能被解析**（防 JSON typo / 防字段漂移）；
 * 2. **把已用原文核实的更正钉死**（防有人"顺手"把它们改回去）。
 *
 * ⚠️ 本文件只读文件，不连数据库、不调模型。
 */

/**
 * 仓库内样例金标的绝对路径。
 *
 * ⚠️ 这里**不能**写成 `new URL("./gold/…", import.meta.url)`。
 * 本仓库的测试跑在 **jsdom** 环境（`vitest.config.ts` 的 `environment: "jsdom"`），
 * 此时全局 `URL` 是 jsdom 的实现，它会**忽略传入的 base**、改按 `document.baseURI`
 * （`http://localhost:3000/`）解析相对路径 —— 于是得到
 * `http://localhost:3000/scripts/eval/gold/…`，`readFile` 抛出
 * `ERR_INVALID_URL_SCHEME: The URL must be of scheme file`。
 *
 * 实测确认过（本注释存在的理由：该报错信息完全指不到真实原因，
 * 而 `import.meta.url` 在模块作用域里其实是正确的 `file://` —— 坑在全局 `URL` 上）。
 * 因此改用 `fileURLToPath`（Node 自己的实现，不受 jsdom 影响）再拼相对位置。
 */
const GOLD_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "gold", "rulin-waishi-1-3.json");

/**
 * 第二份金标：**穷尽标注第一回**，仓库里第一份让**精确率**可读的金标。
 *
 * 它与上面那份的分工是刻意的（一份召回导向、一份精确率导向），
 * 因此需要**各自独立**的护栏 —— 尤其是「不得把系统多报的名字写进金标」这一条：
 * 那是唯一能让精确率凭空变好看的作弊路径。
 */
const GOLD_1_1_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "gold", "rulin-waishi-1-1.json");

/**
 * 第三份金标：**第二部小说的第一把尺子**（2026-10-11 新增）。
 *
 * 它存在的理由与前两份不同：前两份都是《儒林外史》，因此**所有召回侧结论
 * 都只在单一一本书上成立**。本份把结论搬到《红楼梦》上复核。
 *
 * ⚠️ 它与前两份的**唯一口径差异**是「文学元名词全部收」（N10 裁定），
 * 该差异连同三条实测理由写在文件的 `annotationNotes` 里 —— 护栏只钉
 * 「它没被悄悄改掉」，不重复论述。
 */
const GOLD_HLM_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "gold", "hongloumeng-1-3.json");

/** 读取并解析样例金标（《儒林外史》1–3 回）。 */
async function loadShippedGold() {
  const raw = await readFile(GOLD_PATH, "utf8");
  return GoldSetSchema.parse(JSON.parse(raw) as unknown);
}

/** 读取并解析「穷尽第一回」金标。 */
async function loadShippedGold11() {
  const raw = await readFile(GOLD_1_1_PATH, "utf8");
  return GoldSetSchema.parse(JSON.parse(raw) as unknown);
}

/** 读取并解析《红楼梦》1–3 回金标。 */
async function loadShippedGoldHlm() {
  const raw = await readFile(GOLD_HLM_PATH, "utf8");
  return GoldSetSchema.parse(JSON.parse(raw) as unknown);
}

describe("GoldSetSchema —— 字段契约", () => {
  it("`annotationNotes` 缺省为空数组（既有金标文件无需改动即可继续解析）", () => {
    const parsed = GoldSetSchema.parse({
      bookTitle   : "某书",
      chapterRange: [1, 3]
    });

    expect(parsed.annotationNotes).toEqual([]);
    expect(parsed.entities).toEqual([]);
    expect(parsed.relations).toEqual([]);
  });

  it("**护栏**：`chapterRange` 下界为 0 被拒 —— 前置内容的序号是 0，不得写进区间", () => {
    // 若放行 0，就等于允许把「前言」当成第 1 回来标注，
    // 而整本书的章号会因此整体偏移一位（历史缺陷）。
    const result = GoldSetSchema.safeParse({
      bookTitle   : "某书",
      chapterRange: [0, 3]
    });

    expect(result.success).toBe(false);
  });

  it("区间上界小于下界时 schema 层不拦（由 describeChapterRange 报「区间内没有章节」）", () => {
    // 刻意记录这一分工：schema 只管单位与类型，**轴是否对得上**由
    // `describeChapterRange` 在报告里点名（它会把解析到的章节标题打出来）。
    const result = GoldSetSchema.safeParse({ bookTitle: "某书", chapterRange: [5, 2] });

    expect(result.success).toBe(true);
  });
});

describe("仓库内金标文件（gold/rulin-waishi-1-3.json）", () => {
  it("能被解析（防 JSON typo —— 此前只有连真库跑评测时才会发现）", async () => {
    const gold = await loadShippedGold();

    expect(gold.bookTitle).toBe("儒林外史");
    expect(gold.chapterRange).toEqual([1, 3]);
    expect(gold.entities.length).toBeGreaterThan(0);
    expect(gold.relations.length).toBeGreaterThan(0);
  });

  it("每条标注说明都带依据（不得被清空成占位符）", async () => {
    const gold = await loadShippedGold();

    // 至少覆盖：王母命名约定、周进→范进 的 startChapter 边界、诸暨村、科举、
    // 危素→王冕、同僚→师生 六件事。
    expect(gold.annotationNotes.length).toBeGreaterThanOrEqual(6);
    for (const note of gold.annotationNotes) {
      // 长度下限只为拦住「TODO」「待补」这类占位；真正的依据格式由人保证。
      expect(note.length).toBeGreaterThan(20);
    }
  });

  it("**护栏**：`真实缺口` 条目不得被悄悄删掉 —— 删掉就等于凭空涨召回", async () => {
    const gold = await loadShippedGold();
    const entityNames = gold.entities.map((entity) => entity.canonical);
    const relationKeys = gold.relations.map(
      (relation) => `${relation.typeCode}:${relation.sourceCanonical}→${relation.targetCanonical}`
    );

    // 这三条是**真实缺口**（原文支持、系统当前做不到），按约定**保留在金标里照算 FN**。
    // 删掉它们会让召回率立刻变好看，而系统一行代码都没改 ——
    // 正是本项目「改口径让数字变好看」的老毛病。
    // 真要删，必须连这条护栏一起改，并写清「为什么它不再是缺口」。
    //
    // 2026-10-10：金标从 9 实体扩到 78 实体（穷尽标注 1–3 回）时，
    // 第 3 条（【本区间新增的真实缺口…】）是**新加的**，因此 2 → 3。
    // 这不是放宽：原来两条的实体/关系断言原样保留在下面。
    const gapNotes = gold.annotationNotes.filter((note) => note.includes("真实缺口"));
    expect(gapNotes.length).toBe(3);

    // 关键：缺口必须**仍在金标条目里**，而不是只留一条注释。
    // 只留注释的话，召回率已经涨上去了，注释再多也拦不住。
    expect(entityNames).toContain("王母");
    expect(relationKeys).toContain("师生:周进→范进");
  });

  it("**回归护栏**：已核实的错误条目不得被改回来", async () => {
    const gold = await loadShippedGold();
    const entityNames = gold.entities.map((entity) => entity.canonical);

    // 原文 0 次命中：`诸暨村` 是「诸暨县」+「乡村」的拼接错误（第一回 段 3）。
    expect(entityNames).not.toContain("诸暨村");
    // 第 1–3 回 0 段命中：全书 5 段都在第 0/5/6/17/40 回。
    expect(entityNames).not.toContain("科举");
  });

  it("**回归护栏**：危素与时知县的关系必须是 `师生`（原文「乃危老先生门生」）", async () => {
    const gold = await loadShippedGold();

    const key = (r: { typeCode: string; sourceCanonical: string; targetCanonical: string }) =>
      `${r.typeCode}:${r.sourceCanonical}→${r.targetCanonical}`;
    const keys = gold.relations.map(key);

    // 第一回 段 8「县尊是壬午举人，乃危老先生门生」；
    // 段 9 时知县自称「门生」、称危素「老师」；段 12「危老师」。
    expect(keys).toContain("师生:危素→时知县");
    // 原先误标为同僚 —— 不得改回。
    expect(keys).not.toContain("同僚:危素→时知县");
    // 危素与王冕在原文中从未见面，不存在师生关系 —— 不得加回。
    expect(keys).not.toContain("师生:危素→王冕");
  });

  it("**护栏**：扩到 1–3 回后，实体/关系数写成硬相等 —— 这是**故意的报警器**", async () => {
    const gold = await loadShippedGold();

    // 78 实体 / 22 关系是**穷尽标注 1–3 回的结果**，不是要凑的目标值。
    // 2026-10-10 从 9 实体扩到 78 的那一轮，把这份金标从「召回率导向」
    // 变成了「精确率也读得出」（见下一条）—— 改动这把尺子必须是一次被看见的动作。
    expect(gold.entities.length).toBe(78);
    expect(gold.relations.length).toBe(22);
  });

  it("**护栏**：金标规模必须撑得住精确率 —— `isPrecisionReadable` 要求 gold×2 ≥ 切片实体数", async () => {
    const gold = await loadShippedGold();

    // 切片实体数取自 2026-10-10 的实测（`_wb_eval_breakdown.ts` 在真库上的输出）。
    // 该数字随管线变化：变小时本护栏更松；变大时须同步复核金标是否漏标，
    // 否则精确率会**静默地**退回不可读状态（报告里的 ⚠️ 才是唯一信号）。
    const SLICE_ENTITIES = 85;
    expect(gold.entities.length * 2).toBeGreaterThanOrEqual(SLICE_ENTITIES);
  });

  it("**护栏**：范围包含 —— `rulin-waishi-1-1.json` 的每个成员名都必须能在本文件里找到", async () => {
    const gold = await loadShippedGold();
    const gold11 = await loadShippedGold11();
    const collect = (entities: readonly { canonical: string; aliases: readonly string[] }[]) => {
      const keys = new Set<string>();
      for (const entity of entities) {
        keys.add(entity.canonical);
        for (const alias of entity.aliases) {
          keys.add(alias);
        }
      }
      return keys;
    };
    const wide = collect(gold.entities);

    // 两份金标是**范围包含**关系（1-1 ⊂ 1-3），不是两份互相打架的尺子。
    // 若有人把 1-3 里第一回的某条删掉或改名，两份金标就会对同一段原文给出不同判定，
    // 而 PRF 报告**看不出**是哪一份错了 —— 只能靠这条断言。
    // 比较的是**成员名集合**（规范名 + 别名），因此 `时仁`（1-1 的规范名）
    // 与 `时知县`（1-3 的规范名）这种写法差异不会误报。
    for (const key of collect(gold11.entities)) {
      expect(wide.has(key), `1-3 缺少 1-1 的成员名：${key}`).toBe(true);
    }
  });

  it("**护栏**：不得把系统**多报**的名字写成 canonical —— 这是唯一能让精确率凭空变好看的路径", async () => {
    const gold = await loadShippedGold();
    const canonicals = gold.entities.map((entity) => entity.canonical);

    // 逐条给出「为什么它不该是金标」，否则下一个人会「顺手补上」。
    // ⚠️ 本断言只看 **canonical**：`顾二哥`/`周先生`/`王公` 作为**别名**是合法的
    //    （它们确实是原文里的称谓形式），但把它们升格成独立实体，
    //    就等于承认「系统把一个人切成两半」是对的。
    const forbidden = [
      // 同人切分残留：某个别名被单独建成了实体
      "顾二哥", "周先生", "秦老爷", "王大", "王公",
      // 子串：长形式已收（见下一条）
      "会稽", "布政司", "王家", "薛家", "高要",
      // 泛称 / 家族宅第
      "老太太", "省城", "张府",
      // 指人的类别 / 资格 / 名次
      "监生", "乡试", "举人", "亚元",
      // 第 1–3 回原文 0 次出现（提及搬运缺陷，见 annotationNotes）
      "严大位", "赵麟书", "儒学",
      // 通名（植物）
      "荷花"
    ];
    for (const wrong of forbidden) {
      expect(canonicals, `${wrong} 不得作为 canonical 写进金标`).not.toContain(wrong);
    }
  });

  it("**护栏**：`王公` 只能出现在 aliases 里（第二回 段 15 是王举人的称谓）", async () => {
    const gold = await loadShippedGold();
    const byName = new Map(gold.entities.map((entity) => [entity.canonical, entity]));

    // 1-1（只覆盖第一回，`王公` 0 次）不收它；本份覆盖 1–3 回，`王公` 出现在
    // 第二回 段 15「一个戴纱帽红袍金带的人…说道：『王公请起！』」→ 是 `王举人` 的称谓形式。
    // 两份金标因此**不矛盾**，是范围差异；但 `王公` 绝不能成为独立实体。
    expect(byName.get("王举人")?.aliases ?? []).toContain("王公");
    expect(byName.has("王公")).toBe(false);
  });

  it("**护栏**：子串只保留长形式（`findPrefixConflicts` 只查前缀，抓不到这类关系）", async () => {
    const gold = await loadShippedGold();
    const canonicals = gold.entities.map((entity) => entity.canonical);

    for (const [long, short] of [
      ["会稽山", "会稽"],
      ["浙江布政司", "布政司"],
      ["薛家集", "薛家"],
      ["王家集", "王家"],
      ["高要县", "高要"]
    ]) {
      expect(canonicals).toContain(long);
      expect(canonicals).not.toContain(short);
    }
  });

  it("**护栏**：新增的真实缺口不得被悄悄删掉", async () => {
    const gold = await loadShippedGold();
    const canonicals = gold.entities.map((entity) => entity.canonical);

    // 这些是「原文明确有专名、系统全书范围内都没产出」的条目，按约定**保留照算 FN**。
    // 删掉它们会让召回率立刻变好看，而系统一行代码都没改。
    //   `王母`/`范母` —— 原文只称「母亲」，按「姓氏 + 亲属称谓」约定命名；
    //   `荀老翁`      —— 第二回 段 19「偏要在荀老翁跟前恭喜」（荀玫的父亲）；
    //   `白老师`      —— 第二回 段 15「就在我白老师手里曾考过一个案道的」；
    //   `梁灏`        —— 第二回 段 5「是梁灏八十岁中状元的故事」；
    //   `胡氏`        —— 第三回 段 17「娘子胡氏道」；
    //   `成化`        —— 第二回 段 3「那时成化末年」（年号）；
    //   `文曲星`      —— 第三回 段 13「都是天上的文曲星」（星官）。
    for (const gap of ["王母", "范母", "荀老翁", "白老师", "梁灏", "胡氏", "成化", "文曲星"]) {
      expect(canonicals, `真实缺口 ${gap} 不得删除`).toContain(gap);
    }
  });

  it("**护栏**：关系码必须落在闭集内，且两端都在实体表里", async () => {
    const gold = await loadShippedGold();
    const canonicals = new Set(gold.entities.map((entity) => entity.canonical));

    for (const relation of gold.relations) {
      // `义父子`（第一回 段 9）与 `君臣`（第一回 段 22）在原文里成立，
      // 但目录没有对应码 —— 就近取 `父子` / `主仆`，理由写在 annotationNotes 里。不得自造码。
      expect(RELATION_TYPE_CODES.has(relation.typeCode)).toBe(true);
      // 端点解析不到的实体，关系指标会退回归一化名 → 召回静默偏低。
      expect(
        canonicals.has(relation.sourceCanonical),
        `关系源端点 ${relation.sourceCanonical} 不在实体表里`
      ).toBe(true);
      expect(
        canonicals.has(relation.targetCanonical),
        `关系目标端点 ${relation.targetCanonical} 不在实体表里`
      ).toBe(true);
    }
  });
});

describe("仓库内金标文件（gold/rulin-waishi-1-1.json，穷尽标注第一回）", () => {
  it("能被解析，且区间恰为第一回", async () => {
    const gold = await loadShippedGold11();

    expect(gold.bookTitle).toBe("儒林外史");
    expect(gold.chapterRange).toEqual([1, 1]);
    // 43 个实体 / 9 条关系是**穷尽标注的结果**，不是要凑的目标值。
    // 刻意写成硬相等：改动这把尺子必须是一次被看见、被 review 的动作 ——
    // 本项目已经五次栽在「数字变好看了，但坏的是尺子」上。
    expect(gold.entities.length).toBe(43);
    expect(gold.relations.length).toBe(9);
  });

  it("**护栏**：金标规模必须撑得住精确率 —— `isPrecisionReadable` 要求 gold×2 ≥ 切片实体数", async () => {
    const gold = await loadShippedGold11();

    // 切片实体数取自 2026-10-10 的实测（`_wb_gold_first.ts` 的 C 节输出）。
    // 该数字随管线变化：变小时本护栏更松；变大时须同步复核金标是否漏标，
    // 否则精确率会**静默地**退回不可读状态（报告里的 ⚠️ 才是唯一信号）。
    const SLICE_ENTITIES = 45;
    expect(gold.entities.length * 2).toBeGreaterThanOrEqual(SLICE_ENTITIES);
  });

  it("每条标注说明都带依据（不得被清空成占位符）", async () => {
    const gold = await loadShippedGold11();

    expect(gold.annotationNotes.length).toBeGreaterThanOrEqual(10);
    for (const note of gold.annotationNotes) {
      expect(note.length).toBeGreaterThan(20);
    }
  });

  it("**护栏**：真实缺口不得被悄悄删掉 —— 删掉就等于凭空涨召回", async () => {
    const gold = await loadShippedGold11();
    const names = gold.entities.map((entity) => entity.canonical);

    // 这四个都是「原文明确有专名、系统全书范围内都没产出」的真实缺口：
    //   `王母`   —— 原文只称「母亲」（第一回 段 3/18），按称谓约定命名；
    //   `段干木` / `泄柳` —— 第一回 段 9「不见那段干木、泄柳的故事么」；
    //   `余阙`   —— 第一回 段 22「发往和州守余阙墓」。
    expect(names).toContain("王母");
    expect(names).toContain("段干木");
    expect(names).toContain("泄柳");
    expect(names).toContain("余阙");
  });

  it("**护栏**：不得把系统**多报**的名字写进金标 —— 这是唯一能让精确率凭空变好看的路径", async () => {
    const gold = await loadShippedGold11();
    const names = gold.entities.map((entity) => entity.canonical);

    // 逐条给出「为什么它不该是金标」，否则下一个人会「顺手补上」：
    //   `王公`   —— 规范名全书 10 次、**第一回 0 次**；别名 `老父台` 是危素对时知县的
    //               敬称（第一回 段 9），系统靠这个**泛称别名**把它的提及拖进了第一回。
    //   `严大位` —— 全书 3 次、**第一回 0 次**（第二回的严贡生）；靠别名 `老大`
    //               命中第一回 段 12 的 `王老大`。
    //   `会稽` / `布政司` / `王家` —— 子串（分别在 `会稽山` / `浙江布政司` / `王家集` 之内）。
    //   `荷花`   —— 通名（植物），系统还错标成 PERSON。
    //   `举人`   —— 人的类别，不是具名的具体事物。
    //   `王大` / `秦老爷` —— 分别与 `王老大`(王冕) / `秦老` 指同一人，属切分残留。
    for (const wrong of ["王公", "严大位", "会稽", "布政司", "王家", "荷花", "举人", "王大", "秦老爷"]) {
      expect(names).not.toContain(wrong);
    }
  });

  it("**护栏**：子串只保留长形式（`findPrefixConflicts` 只查前缀，抓不到这类关系）", async () => {
    const gold = await loadShippedGold11();
    const names = gold.entities.map((entity) => entity.canonical);

    expect(names).toContain("会稽山");
    expect(names).toContain("浙江布政司");
    expect(names).not.toContain("会稽");
    expect(names).not.toContain("布政司");
  });

  it("**护栏**：关系码必须落在闭集内（不得自造 `义父子` / `君臣`）", async () => {
    const gold = await loadShippedGold11();
    const codes = gold.relations.map((relation) => relation.typeCode);

    for (const code of codes) {
      expect(RELATION_TYPE_CODES.has(code)).toBe(true);
    }
    // `乾爷`（段 9）与 `君臣`（段 22）在原文里成立，但目录没有对应码 ——
    // 就近取 `父子` / `主仆`，理由写在 annotationNotes 里。不得自造码。
    expect(codes).toContain("父子");
  });

  it("**护栏**：关系两端必须都在实体表里（否则端点解析退回归一化名，召回静默偏低）", async () => {
    const gold = await loadShippedGold11();
    const names = new Set(gold.entities.map((entity) => entity.canonical));

    for (const relation of gold.relations) {
      expect(names.has(relation.sourceCanonical)).toBe(true);
      expect(names.has(relation.targetCanonical)).toBe(true);
    }
  });
});

describe("仓库内金标文件（gold/hongloumeng-1-3.json，第二部小说的第一把尺子）", () => {
  it("能被解析，且区间恰为第 1–3 章（⚠️ 红楼语料用「第N章」，不是「第N回」）", async () => {
    const gold = await loadShippedGoldHlm();

    expect(gold.bookTitle).toBe("红楼梦");
    expect(gold.chapterRange).toEqual([1, 3]);
    expect(gold.entities.length).toBeGreaterThan(0);
    expect(gold.relations.length).toBeGreaterThan(0);
  });

  it("**护栏**：实体/关系数写成硬相等 —— 这是**故意的报警器**（改动这把尺子必须是一次被看见的动作）", async () => {
    const gold = await loadShippedGoldHlm();

    // 134 实体 / 58 关系是**穷尽标注 1–3 章的结果**，不是要凑的目标值。
    // 2026-10-11 当天这份文件被改过两轮（第一轮补 4 处标注缺口，第二轮回退
    // 4 条「祖孙误用母子码」的关系），最终值即此 —— 两轮都留了记录（见 §3.26）。
    expect(gold.entities.length).toBe(134);
    expect(gold.relations.length).toBe(58);
  });

  it("**护栏**：金标规模必须撑得住精确率 —— `isPrecisionReadable` 要求 gold×2 ≥ 切片实体数", async () => {
    const gold = await loadShippedGoldHlm();

    // 切片实体数取自 2026-10-11 的实测（`_wb_eval_breakdown.ts` 在真库上的输出：125）。
    // 该数字随管线变化：变小时本护栏更松；变大时须同步复核金标是否漏标。
    const SLICE_ENTITIES = 125;
    expect(gold.entities.length * 2).toBeGreaterThanOrEqual(SLICE_ENTITIES);
  });

  it("每条标注说明都带依据（不得被清空成占位符）", async () => {
    const gold = await loadShippedGoldHlm();

    // 至少覆盖：N10 元名词裁定、不收族、家族宅第边界、[2.16] 引文口径、
    // 异文、同人异名、真实缺口、关系约定、书名号、FP 归因总表。
    expect(gold.annotationNotes.length).toBeGreaterThanOrEqual(12);
    for (const note of gold.annotationNotes) {
      expect(note.length).toBeGreaterThan(20);
    }
  });

  it("**护栏**：N10 裁定的「文学元名词全部收」不得被悄悄推翻 —— 推翻就是凭空涨精确率", async () => {
    const gold = await loadShippedGoldHlm();
    const members = new Set<string>();
    for (const entity of gold.entities) {
      members.add(entity.canonical);
      for (const alias of entity.aliases) {
        members.add(alias);
      }
    }

    // 这 20 个词里系统**已经产出 19 个**（只差 `吴玉峰`）—— 若金标不收，
    // 它们会立刻变成约 19 个系统性 FP，精确率凭空好看。三条实测理由见 note 2。
    for (const name of [
      "曹雪芹", "悼红轩", "孔梅溪", "石头记", "情僧录", "风月宝鉴", "金陵十二钗",
      "太虚幻境", "大荒山", "青埂峰", "无稽崖", "赤霞宫", "西方灵河岸",
      "警幻", "绛珠草", "空空道人", "情僧", "茫茫大士", "渺渺真人", "北邙山"
    ]) {
      expect(members, `N10 元名词 ${name} 不得从金标里删掉`).toContain(name);
    }
  });

  it("**护栏**：真实缺口不得被悄悄删掉 —— 删掉就等于凭空涨召回", async () => {
    const gold = await loadShippedGoldHlm();
    const canonicals = gold.entities.map((entity) => entity.canonical);

    // 22 条「原文支持、系统当前做不到」的条目，按约定**保留照算 FN**。
    // 这份名单必须与 `_wb_eval_hlm` 的 FN 输出**逐字一致**（注释与实测对账）。
    for (const gap of [
      // 引文层（第 2 回段 16 的列举式引文里以完整名字出现的）
      "尧", "舜", "禹", "汤", "蚩尤", "桀", "纣",
      // 具名人物
      "女娲氏", "严老爷", "史侯", "贾复", "宁国公",
      // 具名处所
      "东鲁", "三生石", "离恨天", "灌愁水", "石头城", "南京",
      // 具名机构
      "兰台寺", "体仁院",
      // 具名概念
      "秘情果", "人参养荣丸"
    ]) {
      expect(canonicals, `真实缺口 ${gap} 不得删除`).toContain(gap);
    }
  });

  it("**护栏**：不得把系统**多报**的名字写成 canonical —— 这是唯一能让精确率凭空变好看的路径", async () => {
    const gold = await loadShippedGoldHlm();
    const canonicals = gold.entities.map((entity) => entity.canonical);

    // 逐条给出「为什么它不该是金标」，否则下一个人会「顺手补上」：
    //   同人异名切分残留（该名字在原文里成立，但它是**别名**、不是独立实体）：
    //     `甄爷` / `甄家娘子` / `雨村` / `政公` / `政老爷` / `政老前辈` /
    //     `赦老爷` / `熙凤` / `史老夫人`
    //   家族 / 群体 / 宅第（与儒林 `张府` 同一条线，见 note 4）：
    //     `甄家` / `贾府` / `王谢二族`
    //   书名号形式（儒林约定 CONCEPT 不带 `《》`，见 note 13）：
    //     `《古今人物通考》` / `《四书》`
    for (const wrong of [
      "甄爷", "甄家娘子", "雨村", "政公", "政老爷", "政老前辈", "赦老爷", "熙凤", "史老夫人",
      "甄家", "贾府", "王谢二族",
      "《古今人物通考》", "《四书》"
    ]) {
      expect(canonicals, `${wrong} 不得作为 canonical 写进金标`).not.toContain(wrong);
    }
  });

  it("**护栏**：CONCEPT 一律不带书名号（儒林已立的约定：`四书`/`五经`/`楚辞图`）", async () => {
    const gold = await loadShippedGoldHlm();

    // 原文写作《四书》《古今人物通考》，但金标按约定写裸名。
    // 系统**同时**产出带号与不带号两份 → 带号那份计 FP（归一化缺失，不是口径问题）。
    for (const entity of gold.entities) {
      expect(entity.canonical, `canonical 不得含书名号：${entity.canonical}`).not.toMatch(/[《》]/);
      for (const alias of entity.aliases) {
        expect(alias, `alias 不得含书名号：${alias}`).not.toMatch(/[《》]/);
      }
    }
  });

  it("**护栏**：`蚩尤` 是唯一「原文以拆分形态给出」的例外 —— 例外必须一直被登记", async () => {
    const gold = await loadShippedGoldHlm();
    const canonicals = gold.entities.map((entity) => entity.canonical);

    // 原文第 2 回段 16 写作「蚩、尤」（顿号拆开），完整名字形态 **0 次出现**。
    // 它与 `文`/`武` 那类真缩写不同（`尤` 单独不是名字），且是系统真实抽不到的
    // 召回缺口 → 保留在金标里照算 FN，但必须在 note 里登记为**例外**，
    // 否则下一个人会照「金标不得含 0 次出现的名字」把它删掉。
    expect(canonicals).toContain("蚩尤");
    const registered = gold.annotationNotes.some((note) => note.includes("蚩、尤"));
    expect(registered, "`蚩尤` 的拆分形态例外必须写在 annotationNotes 里").toBe(true);
  });

  it("**护栏**：祖孙关系不得按「就近取母子码」收进来（`母子` 语义不成立）", async () => {
    const gold = await loadShippedGoldHlm();
    const keys = gold.relations.map(
      (relation) => `${relation.typeCode}:${relation.sourceCanonical}→${relation.targetCanonical}`
    );

    // `贾母` 是 `宝玉`/`迎春`/`探春`/`惜春` 的**祖母**，原文第 2 回明写
    // 「史老夫人极爱孙女，都跟在**祖母**这边」；但目录没有「祖孙」码，
    // 而 `母子` 语义不成立 → **不收**。系统用 `母子` 顶替 → 计 FP（可行动的码集缺口）。
    expect(keys).not.toContain("母子:贾母→宝玉");
    expect(keys).not.toContain("母子:贾母→迎春");
    expect(keys).not.toContain("母子:贾母→探春");
    expect(keys).not.toContain("母子:贾母→惜春");
    // 反向：同辈的「姊妹」按就近取码收 `兄弟`（原文第 3 回「迎春姊妹三个」）。
    expect(keys).toContain("兄弟:迎春→探春");
  });

  it("**护栏**：关系码必须落在闭集内，且两端都在实体表里", async () => {
    const gold = await loadShippedGoldHlm();
    const canonicals = new Set(gold.entities.map((entity) => entity.canonical));

    for (const relation of gold.relations) {
      expect(RELATION_TYPE_CODES.has(relation.typeCode)).toBe(true);
      expect(
        canonicals.has(relation.sourceCanonical),
        `关系源端点 ${relation.sourceCanonical} 不在实体表里`
      ).toBe(true);
      expect(
        canonicals.has(relation.targetCanonical),
        `关系目标端点 ${relation.targetCanonical} 不在实体表里`
      ).toBe(true);
    }
  });
});
