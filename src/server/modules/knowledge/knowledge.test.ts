import { describe, expect, it } from "vitest";

import {
  SearchUnavailableError,
  createFixtureProvider,
  fixtureFileName,
  normalizeHits
} from "./search-provider";
import { hashSnapshot } from "./snapshot";
import { formatKnowledgeSummary } from "./summary";
import { knowledgeKey, selectKnowledgeTargets, type KnowledgeTargetEntity } from "./targets";
import type { SearchHit } from "./types";
import { parseKnowledgeVerdict } from "./verdict";

/**
 * 三期判定层的纯函数单测（设计文档 §3.5 / §5.4）。
 *
 * 三条铁律的**可测部分**在这里：触发集（成本控制）、判决保守性（宁可 unresolvable）、
 * 快照哈希与检索结果归一化（可复核链）。
 */

const hit: SearchHit = { title: "朱元璋 - 维基百科", url: "https://example.org/zhu", snippet: "明太祖朱元璋" };

describe("selectKnowledgeTargets（触发集：成本与收益的分配）", () => {
  const entity = (overrides: Partial<KnowledgeTargetEntity>): KnowledgeTargetEntity => ({
    id           : "e1",
    canonical    : "某",
    type         : "PERSON",
    mentionCount : 5,
    aliasCount   : 1,
    honorificForm: false,
    ...overrides
  });

  it("称谓型零别名 → 补本名（canonical_name）", () => {
    const targets = selectKnowledgeTargets({
      bookId      : "b",
      bookTitle   : "儒林外史",
      entities    : [entity({ canonical: "太祖", honorificForm: true, aliasCount: 0, mentionCount: 6 })],
      existingKeys: new Set()
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.field).toBe("canonical_name");
    expect(targets[0]?.query).toBe("儒林外史 太祖");
  });

  it("rich 档（≥30 提及）→ 补维度（biography）", () => {
    const targets = selectKnowledgeTargets({
      bookId      : "b",
      bookTitle   : "红楼梦",
      entities    : [entity({ canonical: "宝玉", mentionCount: 1138 })],
      existingKeys: new Set()
    });
    expect(targets[0]?.field).toBe("biography");
  });

  it("sparse 档（<30 且非称谓型）→ 不搜（搜了白跑）", () => {
    const targets = selectKnowledgeTargets({
      bookId      : "b",
      bookTitle   : "红楼梦",
      entities    : [entity({ canonical: "某小厮", mentionCount: 3 })],
      existingKeys: new Set()
    });
    expect(targets).toHaveLength(0);
  });

  it("已缓存（含 unresolvable）→ 跳过，不重复付费", () => {
    const targets = selectKnowledgeTargets({
      bookId      : "b",
      bookTitle   : "儒林外史",
      entities    : [entity({ canonical: "太祖", honorificForm: true, aliasCount: 0 })],
      existingKeys: new Set([knowledgeKey("太祖", "canonical_name")])
    });
    expect(targets).toHaveLength(0);
  });

  it("非 PERSON 不搜；称谓型不再叠加 rich 档", () => {
    const targets = selectKnowledgeTargets({
      bookId   : "b",
      bookTitle: "儒林外史",
      entities : [
        entity({ id: "e1", canonical: "某地", type: "LOCATION", mentionCount: 100 }),
        entity({ id: "e2", canonical: "周老爷", honorificForm: true, aliasCount: 0, mentionCount: 50 })
      ],
      existingKeys: new Set()
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.field).toBe("canonical_name");
  });
});

describe("parseKnowledgeVerdict（保守判决：只能往下压）", () => {
  it("无命中 → unresolvable，且不依赖模型输出", () => {
    const verdict = parseKnowledgeVerdict('{"resolution":"resolved","value":"朱元璋"}', []);
    expect(verdict.resolution).toBe("unresolvable");
    expect(verdict.confidence).toBe("none");
  });

  it("JSON 非法 → unresolvable", () => {
    expect(parseKnowledgeVerdict("不是 JSON", [hit]).resolution).toBe("unresolvable");
  });

  it("闭集外的取值 → 降级", () => {
    const verdict = parseKnowledgeVerdict(
      JSON.stringify({ resolution: "maybe", confidence: "very-high", value: "x", used_urls: [hit.url] }),
      [hit]
    );
    expect(verdict.resolution).toBe("unresolvable");
    expect(verdict.confidence).toBe("none");
  });

  it("resolved 但无值 → unresolvable（不许编）", () => {
    const noValue = parseKnowledgeVerdict(
      JSON.stringify({ resolution: "resolved", confidence: "high", value: "", used_urls: [hit.url] }),
      [hit]
    );
    expect(noValue.resolution).toBe("unresolvable");
  });

  it("resolved 但未指明来源 → **保留值**、降 low、来源回落本次命中（批 84 实测修正）", () => {
    // 🚨 这里**不能**降成 unresolvable：那会把「查得到」缓存成「查不到」，
    // 后续运行直接跳过、永远修不回来（试点实测踩到过）。
    const noSource = parseKnowledgeVerdict(
      JSON.stringify({ resolution: "resolved", confidence: "high", value: "朱元璋", used_urls: [] }),
      [hit]
    );
    expect(noSource.resolution).toBe("resolved");
    expect(noSource.confidence).toBe("low");
    expect(noSource.value).toBe("朱元璋");
    expect(noSource.sourceUrls).toEqual([hit.url]);
  });

  it("来源必须来自本次命中（编造的 URL 被丢弃）", () => {
    const verdict = parseKnowledgeVerdict(
      JSON.stringify({
        resolution: "resolved",
        confidence: "high",
        value     : "朱元璋",
        used_urls : ["https://made-up.example/x", hit.url]
      }),
      [hit]
    );
    expect(verdict.sourceUrls).toEqual([hit.url]);
  });

  it("disputed 保留（历史人物 vs 文学形象的冲突要能被表达）", () => {
    const verdict = parseKnowledgeVerdict(
      JSON.stringify({ resolution: "disputed", confidence: "medium", value: "史载与书中不符", used_urls: [hit.url] }),
      [hit]
    );
    expect(verdict.resolution).toBe("disputed");
  });
});

describe("检索结果归一化与快照哈希（可复核链）", () => {
  it("兼容 hits / organic / results 三种形状，认不出返回空", () => {
    expect(normalizeHits({ hits: [{ title: "t", url: "u", snippet: "s" }] })).toHaveLength(1);
    expect(normalizeHits({ organic: [{ title: "t", link: "u", snippet: "s" }] })).toHaveLength(1);
    expect(normalizeHits({ results: [{ title: "t", url: "u", content: "c" }] })).toHaveLength(1);
    expect(normalizeHits({ unknown: [] })).toHaveLength(0);
    expect(normalizeHits(null)).toHaveLength(0);
  });

  it("快照哈希对顺序不敏感、对内容敏感", () => {
    const a: SearchHit = { title: "a", url: "u1", snippet: "s1" };
    const b: SearchHit = { title: "b", url: "u2", snippet: "s2" };
    expect(hashSnapshot([a, b])).toBe(hashSnapshot([b, a]));
    expect(hashSnapshot([a, b])).not.toBe(hashSnapshot([a]));
  });

  it("快照文件名稳定（同一 query 恒定）", () => {
    expect(fixtureFileName("儒林外史 太祖")).toBe(fixtureFileName("儒林外史 太祖"));
    expect(fixtureFileName("a")).not.toBe(fixtureFileName("b"));
  });

  it("快照缺失 → 抛 SearchUnavailableError（= 未检索，**不得**记成「查不到」）", async () => {
    // 🚨 回归护栏：这里若返回空命中，判定层会把「没搜过」写成 unresolvable，
    // 后续运行见键即跳过 → 永远补不上（批 86 实测踩到过）。
    const provider = createFixtureProvider("不存在的目录");
    await expect(provider.search("任意 query")).rejects.toBeInstanceOf(SearchUnavailableError);
  });
});

describe("formatKnowledgeSummary（两个消费方共用一份文案）", () => {
  const base = {
    skippedReason: null,
    providerName : "fixture:x",
    bookTitles   : ["儒林外史"],
    targets      : 3,
    calls        : 2,
    costUsd      : 0.0012,
    resolved     : 1,
    disputed     : 0,
    unresolvable : 1,
    written      : 2,
    skippedSearch: 0
  };

  it("正常汇总含作品名、成本、三态计数与「图谱未改动」", () => {
    const text = formatKnowledgeSummary(base);
    expect(text).toContain("儒林外史");
    expect(text).toContain("$0.0012");
    expect(text).toContain("resolved 1");
    expect(text).toContain("unresolvable 1");
    expect(text).toContain("图谱未改动");
  });

  it("被跳过时只输出原因（不输出误导性的 0 计数）", () => {
    const text = formatKnowledgeSummary({ ...base, skippedReason: "未配置检索源" });
    expect(text).toContain("已跳过");
    expect(text).toContain("未配置检索源");
    expect(text).not.toContain("成本");
  });
});
