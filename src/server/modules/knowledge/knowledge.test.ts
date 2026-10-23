import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SearchUnavailableError,
  createFixtureProvider,
  createHttpJsonProvider,
  fixtureFileName,
  normalizeDeepSeekHits,
  normalizeHits,
  resolveSearchProvider
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

describe("run-agent 的环境加载顺序（批 92 实测缺陷的护栏）", () => {
  it("先 ensureEnvLoaded 再 resolveSearchProvider（否则 .env 里的 key 读不到）", () => {
    // 缺陷现象：getServerEnv() 惰性触发（首次连库），而检索源判断发生在连库之前
    // → 写在 .env 里的 SEARCH_API_KEY 读不到，报误导性的「未配置检索源」。
    const raw = readFileSync(path.resolve(process.cwd(), "src/server/modules/knowledge/run-agent.ts"), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
    const loadIndex = code.indexOf("ensureEnvLoaded()");
    const resolveIndex = code.indexOf("resolveSearchProvider(process.env)");
    expect(loadIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeGreaterThan(-1);
    expect(loadIndex).toBeLessThan(resolveIndex);
  });
});

/**
 * DeepSeek Search 的适配契约。
 *
 * 为什么单独测它：DeepSeek 与通用契约**只差两个字段**（`count` 而非 `limit`、
 * `summary` 而非 `snippet`），这种「看起来一样、其实不一样」最容易在换源时静默失败 ——
 * 请求成功但 `results` 解析出 0 条，判定层会把全部实体记成 `unresolvable`。
 */
describe("DeepSeek Search 适配", () => {
  const payload = {
    results: [
      {
        title   : "虞育德",
        url     : "https://baike.baidu.com/item/虞育德",
        snippet : "短摘要（100–200 字）",
        summary : "长摘要（600–800 字，判定层真正需要的上下文）",
        content : ""
      },
      { title: "缺 url 的条目", snippet: "应被丢弃" }
    ]
  };

  it("summary 优先当 snippet：短摘要不足以判断「是不是同一个人」", () => {
    const hits = normalizeDeepSeekHits(payload);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.snippet).toContain("长摘要");
    // `content` 为空字符串时视为「没有正文」，不能塞个空串进去冒充证据。
    expect(hits[0]?.content).toBeUndefined();
  });

  it("认不出形状时返回空数组，不猜", () => {
    expect(normalizeDeepSeekHits(null)).toEqual([]);
    expect(normalizeDeepSeekHits({ foo: 1 })).toEqual([]);
  });

  it("DeepSeek 的 URL 可以省略 SEARCH_API_KEY（与模型共用一把密钥）", () => {
    const provider = resolveSearchProvider({
      SEARCH_API_URL: "https://api.deepseek.com/v1/tools/search",
      AI_API_KEY    : "sk-model-key"
    });
    expect(provider).not.toBeNull();
  });

  it("非 DeepSeek 的 URL 不会复用 AI_API_KEY（复用不相干的 key 只会得到 401，比没配更难查）", () => {
    const provider = resolveSearchProvider({
      SEARCH_API_URL: "https://api.example.com/search",
      AI_API_KEY    : "sk-model-key"
    });
    expect(provider).toBeNull();
  });

  it("显式 SEARCH_API_KEY 仍然优先（换源时不被迫改 AI_API_KEY）", () => {
    const provider = resolveSearchProvider({
      SEARCH_API_URL : "https://api.deepseek.com/v1/tools/search",
      SEARCH_API_KEY : "sk-explicit",
      AI_API_KEY     : "sk-model-key"
    });
    expect(provider).not.toBeNull();
  });

  it("请求体用 count 而不是 limit，并显式要求返回正文", async () => {
    // 缺陷形态：沿用通用契约的 `{query, limit}` → DeepSeek 忽略未知字段、
    // 按默认 count=10 返回，虽然不会报错，但 `limit` 的意图静默失效。
    const captured: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(typeof init?.body === "string" ? init.body : "");
      return Promise.resolve(
        new Response(JSON.stringify({ results: [] }), {
          status : 200,
          headers: { "content-type": "application/json" }
        })
      );
    }) as typeof fetch;

    try {
      const provider = createHttpJsonProvider({
        url   : "https://api.deepseek.com/v1/tools/search",
        apiKey: "sk-test"
      });
      await provider.search("儒林外史 虞育德", { limit: 3 });
    } finally {
      globalThis.fetch = original;
    }

    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0] ?? "{}")).toEqual({
      query       : "儒林外史 虞育德",
      count       : 3,
      need_content: true
    });
  });
});
