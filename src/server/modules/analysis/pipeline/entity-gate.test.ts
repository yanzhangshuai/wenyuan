import { describe, expect, it } from "vitest";

import type { ExtractedEntity, ExtractedRelation } from "../schemas";

import { isViableCandidate } from "./dictionary";
import { gateExtraction, judgeEntityName, MAX_ENTITY_NAME_LENGTH } from "./entity-gate";
import { buildGroundingIndex } from "./grounding";

/** 构造实体（默认 NAMED）。 */
function entity(canonical: string, type: ExtractedEntity["type"] = "PERSON"): ExtractedEntity {
  return { canonical, type, nameType: "NAMED", aliases: [] };
}

/** 构造关系。 */
function relation(source: string, target: string): ExtractedRelation {
  return { typeCode: "朋友", sourceCanonical: source, targetCanonical: target, quote: "quote" };
}

describe("judgeEntityName —— 基础规则（与 P0 候选扫描共用口径）", () => {
  it("拒绝单字名", () => {
    // 实测噪声：`县`(225 次提及，全图第 3 位)、`监`(61 次，第 16 位)
    expect(judgeEntityName("县", "LOCATION")).toEqual({
      accepted: false,
      reason  : "single_char"
    });
    expect(judgeEntityName("监", "ORGANIZATION")).toEqual({
      accepted: false,
      reason  : "single_char"
    });
  });

  it("拒绝停用表内的泛称", () => {
    // 实测噪声：`衙门`(87 次提及，全图第 11 位)
    expect(judgeEntityName("衙门", "LOCATION")).toEqual({
      accepted: false,
      reason  : "stop_word"
    });
    expect(judgeEntityName("众人", "PERSON").accepted).toBe(false);
  });

  it("拒绝处所泛称与亲属泛称（实测：京里以 167 次提及占据第 3 名）", () => {
    // 处所泛称：「单字处所 + 里/上」构成，天然高频，频次阈值过滤不掉
    expect(judgeEntityName("京里", "LOCATION")).toEqual({
      accepted: false,
      reason  : "stop_word"
    });
    expect(judgeEntityName("城里", "LOCATION").accepted).toBe(false);
    expect(judgeEntityName("路上", "LOCATION").accepted).toBe(false);
    // 亲属/身份泛称：曾作为别名把无关人物桥接成一个大组件
    expect(judgeEntityName("娘子", "PERSON").accepted).toBe(false);
    expect(judgeEntityName("丈人", "PERSON").accepted).toBe(false);
  });

  it("拒绝残留泛称；且精确匹配**不得误伤**同后缀的真实人名", () => {
    // 实测（runId 78e2646b，闸门与别名级联修复上线后的审计）：
    //   `大爷`(51 段)、`夫人`(25 段)、`河房`(40 段) 以规范名身份进入 Top 20；
    //   `胡子`/`老太` 作为别名，把「王胡子」「鲍老太」的提及数撑到 3.6x / 6.7x。
    for (const name of ["大爷", "二爷", "三爷", "四爷", "五爷"]) {
      expect(judgeEntityName(name, "PERSON")).toEqual({ accepted: false, reason: "stop_word" });
    }
    expect(judgeEntityName("夫人", "PERSON")).toEqual({ accepted: false, reason: "stop_word" });
    expect(judgeEntityName("胡子", "PERSON")).toEqual({ accepted: false, reason: "stop_word" });
    expect(judgeEntityName("老太", "PERSON")).toEqual({ accepted: false, reason: "stop_word" });
    expect(judgeEntityName("河房", "LOCATION")).toEqual({ accepted: false, reason: "stop_word" });

    // 回归护栏：停用表是**精确相等**匹配，只砍光杆泛称。
    // 「王胡子」「鲍老太」是具体的人（「胡子」只是外号的一部分），必须照常入谱。
    // 若有人把停用表改成子串匹配，这里会立刻变红。
    expect(judgeEntityName("王胡子", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
    expect(judgeEntityName("鲍老太", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
  });

  it("拒绝**全量别名审计**发现的泛称（依据别名自身的字面段数排序）", () => {
    // 方法：遍历全部 500 条别名，按「该别名自身的字面段数」降序排列。
    // 判据：段数远大于其 owner 规范名的段数 → 主要被用来叫**别人** → 无区分度。
    // 实测：`表兄`(20 段 ← 三公子)、`家兄`(14 ← 严大位)、`门下`(25 ← 鲍廷玺)、
    //       `新娘`(15 段而其 owner 仅 1 段)、`僧官`(14 ← 慧敏)、`保正`(11 ← 潘保正)。
    for (const name of [
      "表兄", "家兄", "表弟", "姑老爷", "舍弟", "孙儿",
      "门下", "新娘", "僧官", "保正"
    ]) {
      expect(judgeEntityName(name, "PERSON")).toEqual({ accepted: false, reason: "stop_word" });
    }
    // 护栏：带姓氏的具体称呼不受影响（仍是精确匹配）
    expect(judgeEntityName("潘保正", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
  });

  it("拒绝超过长度上限的病态长串", () => {
    const tooLong = "一".repeat(MAX_ENTITY_NAME_LENGTH + 1);
    expect(judgeEntityName(tooLong, "CONCEPT")).toEqual({
      accepted: false,
      reason  : "too_long"
    });
  });

  it("拒绝不含 CJK 的碎片", () => {
    expect(judgeEntityName("abc", "CONCEPT").accepted).toBe(false);
    expect(judgeEntityName("123", "CONCEPT").accepted).toBe(false);
  });

  it("放行真实专名（回归护栏：降噪不得误伤）", () => {
    for (const name of ["杜少卿", "匡超人", "范进", "严监生", "马纯上", "牛布衣"]) {
      expect(judgeEntityName(name, "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
    }
  });

  it("放行真实地名与机构（尤其不得把「国子监」误当单字「监」）", () => {
    for (const name of ["南京", "杭州", "国子监", "应天府", "山东"]) {
      expect(judgeEntityName(name, "LOCATION").accepted).toBe(true);
    }
    expect(judgeEntityName("国子监", "ORGANIZATION")).toEqual({
      accepted: true,
      nameType: "NAMED"
    });
  });
});

describe("judgeEntityName —— 8c：泛称 / 资格词 / 类别词（**闸门专用**表）", () => {
  it("拒绝光杆资格词与考试名（跨运行稳定的金标实体 FP）", () => {
    // 证据：`监生` 在批次 11 / 15 / 16c 的金标 1-3 实体 FP 里**跨运行稳定出现**；
    //       `进士` / `孝廉` 见 §3.19 变体 V1 的 FP 名单（`_wb_n19_sim.out`）。
    // 这些词天然高频，**频次阈值永远过滤不掉**，只能靠词形规则；
    // 而提示词里那句「严禁抽取泛称（大哥、妇人、众人、那人）」覆盖不到「资格词」这一族。
    for (const name of [
      "监生", "举人", "秀才", "进士", "孝廉",
      "贡生", "廪生", "童生", "生员",
      "乡试", "会试", "殿试"
    ]) {
      expect(judgeEntityName(name, "PERSON")).toEqual({
        accepted: false,
        reason  : "generic_appellation"
      });
    }
  });

  it("拒绝光杆处所/亲属泛称与误入的普通名词", () => {
    // 证据：批次 16c 金标 1-3 实体 FP（逐条见 `_wb_eval_breakdown.ts`）
    expect(judgeEntityName("省城", "LOCATION")).toEqual({
      accepted: false,
      reason  : "generic_appellation"
    });
    expect(judgeEntityName("老太太", "PERSON").accepted).toBe(false);
    expect(judgeEntityName("张府", "ORGANIZATION").accepted).toBe(false);
    expect(judgeEntityName("荷花", "CONCEPT").accepted).toBe(false);
  });

  it("回归护栏：精确匹配**不得误伤**带前缀的具体称呼", () => {
    // 这是整张表的安全边界。`监生` 在表内，但 `严监生` 是贯穿数回的主要角色。
    // 若有人把闸门专用表改成子串匹配，这里会立刻变红。
    expect(judgeEntityName("严监生", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
    expect(judgeEntityName("王监生", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
    expect(judgeEntityName("鲍老太太", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
    expect(judgeEntityName("张府尹", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
  });

  it("批次 9a：拒绝光杆科举**名次**（`亚元`）—— 与资格词 / 考试名同族", () => {
    // 证据：**批次 8c 实测**的金标 1-3 实体 FP，runId `7a1eeb8d-cccc-4a10-8a1a-a67b0ebe570e`
    // —— 它是那一轮**唯一**的 FP（`_wb_eval_breakdown.ts` 逐条摊开可见）。
    // 金标 note 17④ 早已把 `亚元` 与 `监生` / `举人` / `乡试` 并列为
    // 「指人的类别 / 资格 / **名次**」→ 本批是**补漏**，不是新判断。
    // $0 预演（`_wb_gate_sim.ts`）预测：1-3 FP 1→0、F1 87.94→88.57（**+0.63**），**零召回损失**。
    // 判定与类型无关（闸门在这一步只看归一化名字）→ 四种类型都拒。
    for (const type of ["PERSON", "CONCEPT", "LOCATION", "ORGANIZATION"] as const) {
      expect(judgeEntityName("亚元", type)).toEqual({
        accepted: false,
        reason  : "generic_appellation"
      });
    }
    // 安全边界（精确匹配）：只砍**光杆**，带前后缀的一律放行。
    expect(judgeEntityName("亚元公", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
    expect(judgeEntityName("周亚元", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
    expect(judgeEntityName("亚元老爷", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
  });

  it("⚠️ 契约：**闸门专用表不进 P0 候选扫描** —— 这是「可 $0 预演」的前提", () => {
    // 若这些词同时进了 P0（即被加进 `STOP_WORDS`），就会改动注入 P1 的候选词典
    // → 改了提示词 → 改了 P1 的 LLM 输出 → 整个改动**无法在现有图谱上精确重放**，
    // 只能付费重跑一次、在 ±7.14 点噪声里赌。
    // 因此必须证明：闸门拒绝它们，而 P0 仍视其为**可用候选**。
    // ⚠️ 本测试变红 = 8c 从「可 $0 预演」退化成「只能付费赌」，不是小事。
    for (const name of ["监生", "省城", "老太太", "举人", "进士", "亚元"]) {
      expect(judgeEntityName(name, "PERSON").accepted).toBe(false);
      expect(isViableCandidate(name, 6)).toBe(true);
    }
  });
});

describe("judgeEntityName —— 批次 26：列举式规范名（模型抄了一串并列名词）", () => {
  it("拒绝**硬分隔符**规范名（`，；／,;/` 在中文专名里不可能出现）", () => {
    // 判据是「**列举**」而不是「分隔」：逗号族与斜杠族一律判列举，
    // 不论切成几段。证据见下一条。
    for (const name of [
      "五经，四书，八股文",
      "五经，四书",
      "五经;四书;八股文",
      "五经/四书/八股文"
    ]) {
      expect(judgeEntityName(name, "CONCEPT")).toEqual({
        accepted: false,
        reason  : "enumeration_name"
      });
    }
  });

  it("拒绝**顿号切成 ≥3 段**的规范名（实测：第一回原文整串被抄成一个实体名）", () => {
    // 证据：批次 26 的 FN 归因探针（`_wb_fn_scope_probe.ts`，V0 自检逐条复现真实评测）
    // 显示儒林 1-1 的实体 FP 只有 1 条，其规范名是 `五经、四书、八股文` ——
    // 即第一回原文「三年一科，用五经、四书、八股文」的**整串**。
    // 该实体的成员键（只有那一整串）与任何金标名**集合不相交** → 一个也认领不到，
    // 却白占一个精确率分母（1 FP + 3 FN）。修它：儒林 1-1 F1 79.45 → 80.56。
    // $0 预演：`_wb_enum_sim.ts` / `_wb_enum_sim.out`（自检 ✅ 逐条复现真实评测）。
    expect(judgeEntityName("五经、四书、八股文", "CONCEPT")).toEqual({
      accepted: false,
      reason  : "enumeration_name"
    });
  });

  it("⚠️ 回归护栏：**不得误杀**顿号 2 段的真专名（`、` 是合法并列连词）", () => {
    // 第一版规则写成「含 `、` 即拒」，$0 预演**当场**暴露出它会误杀真专名 ——
    // 以下两条都已**回原文数过命中**（`_wb_enum_overreject_attest.py`）：
    //   · 《红楼梦》`荣、宁两府` 全书 2 次（第 2 回 1 次）、`宁、荣二府` 4 次、
    //     `荣、宁二府` 3 次 —— 指「荣国府 + 宁国府」，是**真专名**；
    //   · 《儒林外史》`王、李七子` 第 30 回 1 次 —— 指王世贞/李攀龙「后七子」。
    // 故顿号只在**切成 ≥3 段**时才判列举（段数可枚举，语义不可枚举）。
    expect(judgeEntityName("荣、宁两府", "ORGANIZATION").accepted).toBe(true);
    expect(judgeEntityName("宁、荣二府", "ORGANIZATION").accepted).toBe(true);
    expect(judgeEntityName("王、李七子", "CONCEPT").accepted).toBe(true);
  });

  it("⚠️ 回归护栏：**不得误杀**含间隔号的外来音译名（`·` 是合法分隔，不是列举）", () => {
    // 判据是「**列举**」而不是「分隔」。间隔号（`·` / `・`）是外来音译名的
    // 标准写法，把它当列举分隔符会误杀真专名 —— 这正是本项目最贵的一类错误。
    expect(judgeEntityName("弗拉基米尔·普京", "PERSON").accepted).toBe(true);
    expect(judgeEntityName("玛格丽特・杜拉斯", "PERSON").accepted).toBe(true);
  });

  it("⚠️ 契约：列举规则同样**不进 P0 候选扫描**（与 8c 同一条理由）", () => {
    // 若进了 `rejectCandidateReason`，就会改动注入 P1 的候选词典 → 改了提示词
    // → 无法在现有图谱上 $0 预演（见上面 8c 那条契约测试）。
    // ⚠️ 这里必须用**长度 ≤ P0 上限（6）**的例子，否则 `too_long` 会先把它拒掉，
    // 契约就变成了「被别的规则拒的」，测不出这条规则是否真的只住在闸门里。
    expect(judgeEntityName("五经，四书", "CONCEPT").accepted).toBe(false);
    expect(isViableCandidate("五经，四书", 6)).toBe(true);
  });
});

describe("judgeEntityName —— 姓氏称谓", () => {
  it("拒绝「姓氏 + 氏」（实测噪声：杜氏被标为 ORGANIZATION）", () => {
    expect(judgeEntityName("杜氏", "ORGANIZATION")).toEqual({
      accepted: false,
      reason  : "generic_appellation"
    });
    expect(judgeEntityName("王氏", "PERSON").accepted).toBe(false);
  });

  it("不误伤以「氏」结尾的真实专名（如氏族/姓氏类概念）", () => {
    // 长度 > 3 不落入该规则
    expect(judgeEntityName("百家姓氏", "CONCEPT").accepted).toBe(true);
  });
});

describe("judgeEntityName —— 官职（关键：不得误杀「鲁编修」）", () => {
  it("拒绝「辖区/官署 + 官职」（实测噪声：河南道监察御史被标为 ORGANIZATION）", () => {
    expect(judgeEntityName("河南道监察御史", "ORGANIZATION")).toEqual({
      accepted: false,
      reason  : "official_title"
    });
    // 「国子监」是官署，+「祭酒」后指的是职位而非人物
    expect(judgeEntityName("国子监祭酒", "ORGANIZATION")).toEqual({
      accepted: false,
      reason  : "official_title"
    });
  });

  it("拒绝光杆官名", () => {
    expect(judgeEntityName("监察御史", "ORGANIZATION").accepted).toBe(false);
    expect(judgeEntityName("布政使", "PERSON").accepted).toBe(false);
  });

  it("拒绝「像姓氏但被判为机构」的官名", () => {
    expect(judgeEntityName("周编修", "ORGANIZATION")).toEqual({
      accepted: false,
      reason  : "official_title"
    });
  });

  it("**保留**「姓氏 + 官职」的人物，降为 TITLE_ONLY", () => {
    // 鲁编修是《儒林外史》贯穿数回的主要角色。
    // 若按官职后缀一刀切，会丢掉真实人物 —— 这是降噪最容易翻车之处。
    expect(judgeEntityName("鲁编修", "PERSON")).toEqual({
      accepted: true,
      nameType: "TITLE_ONLY"
    });
    expect(judgeEntityName("周学道", "PERSON")).toEqual({
      accepted: true,
      nameType: "TITLE_ONLY"
    });
  });
});

describe("judgeEntityName —— 身份/职业称谓", () => {
  it("带前缀者保留并降为 TITLE_ONLY（如胡屠户）", () => {
    expect(judgeEntityName("胡屠户", "PERSON")).toEqual({
      accepted: true,
      nameType: "TITLE_ONLY"
    });
    expect(judgeEntityName("王老先生", "PERSON")).toEqual({
      accepted: true,
      nameType: "TITLE_ONLY"
    });
  });

  it("光杆身份称谓拒绝（无指代对象）", () => {
    expect(judgeEntityName("屠户", "PERSON")).toEqual({
      accepted: false,
      reason  : "generic_appellation"
    });
    expect(judgeEntityName("稳婆", "PERSON").accepted).toBe(false);
  });

  it("普通人物仍为 NAMED", () => {
    expect(judgeEntityName("匡超人", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
  });
});

describe("judgeEntityName —— 尊称（关键：单字排行前缀不构成区分度）", () => {
  it("光杆尊称 → 拒", () => {
    // 实测：`老师` 以 60 段挂在「虞博士」名下、`太爷` 以 53 段挂在「向知府」名下，
    // 二者本身都不是名字，且会把提及数撑到 2.2x / 8.6x。
    expect(judgeEntityName("老师", "PERSON")).toEqual({
      accepted: false,
      reason  : "generic_appellation"
    });
    expect(judgeEntityName("太爷", "PERSON").accepted).toBe(false);
    expect(judgeEntityName("老师父", "PERSON").accepted).toBe(false);
    expect(judgeEntityName("老官", "PERSON").accepted).toBe(false);
  });

  it("**单字排行前缀 + 尊称** → 拒（「二先生」可以是马二先生，也可以是余二先生）", () => {
    // 实测：`二先生` 全书 64 段，而 owner「余二先生」的规范名只有 5 段 → 12.8x。
    // 这是本轮最严重的污染源，靠枚举补不完（二先生/大先生/四先生/三老爷…）。
    for (const name of ["二先生", "大先生", "四先生", "二老爷", "大老官", "小先生"]) {
      expect(judgeEntityName(name, "PERSON")).toEqual({
        accepted: false,
        reason  : "generic_appellation"
      });
    }
  });

  it("前缀是姓氏或多字 → 放行（回归护栏：不得误伤具体的人）", () => {
    // 「虞老师」「荀老爹」是姓氏 + 尊称 → 指向具体的人；
    // 「杜少老爷」前缀两字 → 同理。这三条是本规则的**边界**。
    for (const name of ["虞老师", "荀老爹", "慎卿先生", "少卿先生", "杜少老爷", "匡先生"]) {
      expect(judgeEntityName(name, "PERSON").accepted).toBe(true);
    }
    // 规范名本身带两字前缀，更不能被误杀
    expect(judgeEntityName("马二先生", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
    expect(judgeEntityName("余二先生", "PERSON")).toEqual({ accepted: true, nameType: "NAMED" });
  });
});

describe("gateExtraction", () => {
  it("剔除被拒实体，并**同步剔除引用它的关系**", () => {
    const result = gateExtraction({
      entities : [entity("匡超人"), entity("县", "LOCATION"), entity("衙门", "LOCATION")],
      relations: [
        relation("匡超人", "县"),
        relation("衙门", "匡超人"),
        relation("匡超人", "匡超人")
      ]
    });

    expect(result.extraction.entities.map((item) => item.canonical)).toEqual(["匡超人"]);
    expect(result.rejections).toHaveLength(2);
    expect(result.rejections.map((item) => item.reason)).toEqual(["single_char", "stop_word"]);
    // 前两条关系因端点被拒而剔除；自环关系保留
    expect(result.droppedRelations).toBe(2);
    expect(result.extraction.relations).toHaveLength(1);
  });

  it("端点未出现在本片实体表时**不得**丢弃关系（分片固有现象，丢了就是召回损失）", () => {
    const result = gateExtraction({
      entities : [entity("匡超人")],
      relations: [relation("匡超人", "马纯上")]
    });

    expect(result.droppedRelations).toBe(0);
    expect(result.extraction.relations).toHaveLength(1);
  });

  it("把 TITLE_ONLY 判定写回实体", () => {
    const result = gateExtraction({
      entities : [entity("胡屠户"), entity("匡超人")],
      relations: []
    });

    expect(result.extraction.entities.map((item) => item.nameType)).toEqual([
      "TITLE_ONLY",
      "NAMED"
    ]);
    expect(result.rejections).toHaveLength(0);
  });

  it("无拒绝项时不重建关系数组（保持原引用）", () => {
    const relations = [relation("匡超人", "马纯上")];
    const result = gateExtraction({ entities: [entity("匡超人")], relations });

    expect(result.extraction.relations).toBe(relations);
  });

  it("全片被拒时返回空实体与空关系", () => {
    const result = gateExtraction({
      entities : [entity("县", "LOCATION"), entity("监", "ORGANIZATION")],
      relations: [relation("县", "监")]
    });

    expect(result.extraction.entities).toHaveLength(0);
    expect(result.extraction.relations).toHaveLength(0);
    expect(result.droppedRelations).toBe(1);
  });
});

describe("gateExtraction —— 别名净化（切断错并级联的第一道防线）", () => {
  /** 构造带别名的实体。 */
  function entityWithAliases(canonical: string, aliases: string[]): ExtractedEntity {
    return { canonical, type: "PERSON", nameType: "NAMED", aliases };
  }

  it("别名在全书里根本没有字面证据 → 丢弃（模型凭空编的）", () => {
    const result = gateExtraction(
      { entities: [entityWithAliases("杜少卿", ["杜仪", "胡屠户"])], relations: [] },
      buildGroundingIndex(["杜少卿笑道：杜仪便是晚生。"])
    );

    expect(result.extraction.entities[0]?.aliases).toEqual(["杜仪"]);
    expect(result.droppedAliases).toEqual([
      { alias: "胡屠户", owner: "杜少卿", reason: "not_in_book" }
    ]);
  });

  it("🔑 别名不在**本片**、但在**全书** → 保留（批次 25 的口径修正）", () => {
    // 本批的核心行为。闸门曾用「本片」口径，比 P2 grounding（只要求全书出现）更严，
    // 而闸门的丢弃是**终局**的 → 「在本片之外、但在全书之内」的真别名被永久删掉
    // （实测 68 条里 62 条为真）。现在闸门与 grounding 共用**同一个**索引。
    const book = buildGroundingIndex([
      "杜少卿笑道：杜仪便是晚生。",
      "话说胡屠户提着七八斤肉走进来。"
    ]);
    // 本片只含第一段 → 「胡屠户」不在本片，但在全书里。
    const result = gateExtraction(
      { entities: [entityWithAliases("杜少卿", ["杜仪", "胡屠户"])], relations: [] },
      book
    );

    expect(result.extraction.entities[0]?.aliases).toEqual(["杜仪", "胡屠户"]);
    expect(result.droppedAliases).toEqual([]);
  });

  it("别名是亲属/身份泛称 → 丢弃（「老爹」「丈人」可指任何人）", () => {
    const result = gateExtraction(
      { entities: [entityWithAliases("杜少卿", ["丈人", "老爹", "少爷"])], relations: [] },
      buildGroundingIndex(["丈人老爹少爷都来了。"])
    );

    // 词形闸门先于字面证据校验生效，故原因是 stop_word 而非 not_in_book
    expect(result.extraction.entities[0]?.aliases).toEqual([]);
    expect(result.droppedAliases.map((item) => item.reason)).toEqual([
      "stop_word",
      "stop_word",
      "stop_word"
    ]);
  });

  it("外号式泛称别名 → 丢弃（`胡子` 曾把「王胡子」提及数撑到 3.6x）", () => {
    // 实测：`胡子`(54 段) 挂在「王胡子」名下、`老太`(40 段) 挂在「鲍老太」名下。
    // 提及数是**对实体全部成员键做子串匹配**，故这类别名会直接污染排名 ——
    // 「王胡子」字面只有 15 段，图谱提及却报 54。
    const result = gateExtraction(
      { entities: [entityWithAliases("王胡子", ["胡子", "王老爹"])], relations: [] },
      buildGroundingIndex(["王胡子胡子王老爹都在。"])
    );

    // 「胡子」是光杆泛称 → 词形闸门拦下；「王老爹」是**带前缀**的具体称呼 → 保留
    expect(result.extraction.entities[0]?.aliases).toEqual(["王老爹"]);
    expect(result.droppedAliases).toEqual([
      { alias: "胡子", owner: "王胡子", reason: "stop_word" }
    ]);
  });

  it("别名合法且全书有字面证据 → 保留", () => {
    const result = gateExtraction(
      { entities: [entityWithAliases("马二先生", ["马纯上"])], relations: [] },
      buildGroundingIndex(["马二先生原名马纯上。"])
    );

    expect(result.extraction.entities[0]?.aliases).toEqual(["马纯上"]);
    expect(result.droppedAliases).toEqual([]);
  });

  it("不传 grounding 索引时只做词形过滤（向后兼容）", () => {
    const result = gateExtraction({
      entities : [entityWithAliases("杜少卿", ["杜仪", "老爹"])],
      relations: []
    });

    expect(result.extraction.entities[0]?.aliases).toEqual(["杜仪"]);
    expect(result.droppedAliases.map((item) => item.reason)).toEqual(["stop_word"]);
  });

  it("别名被剔除不影响实体本身", () => {
    const result = gateExtraction(
      { entities: [entityWithAliases("杜少卿", ["胡屠户"])], relations: [] },
      buildGroundingIndex(["杜少卿来了。"])
    );

    expect(result.extraction.entities.map((item) => item.canonical)).toEqual(["杜少卿"]);
    expect(result.rejections).toEqual([]);
  });
});
