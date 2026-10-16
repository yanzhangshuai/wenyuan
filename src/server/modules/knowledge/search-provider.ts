import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { SearchHit, SearchResult } from "./types";

/**
 * 检索器接口（设计文档 §3.4 的 `tools: web_search`）。
 *
 * ## 为什么做成可插拔
 * 1. **确定性可测**：`FixtureProvider` 从本地快照读结果 —— 整条判定链（检索→结构化→判决→落库）
 *    可以离线跑通、可重复、可在 CI 里断言；真实检索源不稳定、不可复现，不能作为测试依赖。
 * 2. **换源不动管线**：判定层与解析管线**解耦**，换检索源只改 provider，
 *    不改 Agent、不改表结构、不碰图谱。
 * 3. **不内置 HTML 抓取**：抓搜索引擎结果页违反其服务条款且极易失效；
 *    本模块只对接**结构化 JSON 接口**（用户自备 key），或读本地快照。
 */

/**
 * 「本次**未检索**」的专用错误（与「检索了但没结果」严格区分）。
 *
 * 🚨 为什么必须区分（批 86 实测教训）：快照缺失若返回空命中，
 * 判定层会把「我们根本没搜过」记成 `unresolvable`（查不到）——
 * 那是**缓存污染**：后续运行看到已有键就跳过，永远补不上。
 * HTTP 检索器返回 200 但零结果才是真正的「查不到」。
 */
export class SearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

export interface SearchProvider {
  /** 检索器身份，写入留档（与 snapshotHash 一起构成可复核链）。 */
  readonly name: string;
  search(query: string, options?: { limit?: number }): Promise<SearchResult>;
}

/** 快照文件名：query 的 sha256 前 16 位（稳定、可预生成）。 */
export function fixtureFileName(query: string): string {
  return `${createHash("sha256").update(query).digest("hex").slice(0, 16)}.json`;
}

/**
 * 离线快照检索器：`<dir>/<sha256(query).slice(0,16)>.json`。
 *
 * 快照格式 = `SearchResult` 的 JSON（`{ query, provider, hits: [...] }`）。
 * 找不到快照时返回**空 hits**（等价「查不到」）—— 判定层会把它记为 `unresolvable`，
 * 这正是「查过了，查不到也要落库」的语义。
 */
export function createFixtureProvider(dir: string): SearchProvider {
  const name = `fixture:${path.basename(dir)}`;
  return {
    name,
    // 本地读盘是同步的：显式包成 Promise，保持与 HTTP 检索器同一接口语义。
    search(query: string, options?: { limit?: number }): Promise<SearchResult> {
      const file = path.join(dir, fixtureFileName(query));
      let raw: string;
      try {
        raw = readFileSync(file, "utf8");
      } catch {
        // 快照缺失 = 本次**没搜**（不是「搜了没结果」）→ 返回 rejected promise
        // （⚠️ 必须 reject 而非同步 throw：本方法是同步实现包 Promise，
        //   同步 throw 会在调用点直接炸出，绕过调用方的 try/catch）。
        return Promise.reject(new SearchUnavailableError(`快照缺失：${file}（未检索，不记为「查不到」）`));
      }
      const parsed = JSON.parse(raw) as Partial<SearchResult>;
      const hits = Array.isArray(parsed.hits) ? parsed.hits : [];
      return Promise.resolve({
        query,
        provider: typeof parsed.provider === "string" ? parsed.provider : name,
        hits    : hits.slice(0, options?.limit ?? hits.length)
      });
    }
  };
}

/** HTTP JSON 检索器配置（用户自备检索服务：Serper / Tavily / Bing API / 自建皆可）。 */
export interface HttpSearchProviderConfig {
  /** 接口地址（POST，请求体 `{ query, limit }`）。 */
  url   : string;
  apiKey: string;
  /** 留档名（默认取 URL 主机名）。 */
  name? : string;
}

/**
 * HTTP JSON 检索器：把**任意**返回 JSON 的检索服务归一化成 `SearchHit[]`。
 *
 * 兼容三种常见形状（其余一律丢弃、不猜）：
 * - `{ hits: [{title,url,snippet,content}] }`
 * - `{ organic: [...] }`（Serper）
 * - `{ results: [{title,url,content}] }`（Tavily）
 */
export function createHttpJsonProvider(config: HttpSearchProviderConfig): SearchProvider {
  const name = config.name ?? safeHost(config.url);
  return {
    name,
    async search(query: string, options?: { limit?: number }): Promise<SearchResult> {
      const limit = options?.limit ?? 5;
      const response = await fetch(config.url, {
        method : "POST",
        headers: {
          "content-type" : "application/json",
          "authorization": `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({ query, limit })
      });
      if (!response.ok) {
        throw new Error(`检索服务返回 ${String(response.status)}（provider=${name}）`);
      }
      const payload: unknown = await response.json();
      return { query, provider: name, hits: normalizeHits(payload).slice(0, limit) };
    }
  };
}

/** 从任意检索响应里抽取命中（认不出就返回空数组，不猜）。 */
export function normalizeHits(payload: unknown): SearchHit[] {
  if (payload === null || typeof payload !== "object") return [];
  const container = payload as Record<string, unknown>;
  const list = [container.hits, container.organic, container.results].find((candidate) =>
    Array.isArray(candidate)
  );
  if (!Array.isArray(list)) return [];

  const hits: SearchHit[] = [];
  for (const item of list) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : typeof record.link === "string" ? record.link : null;
    if (url === null) continue;
    const title = typeof record.title === "string" ? record.title : "";
    const snippet =
      typeof record.snippet === "string"
        ? record.snippet
        : typeof record.description === "string"
          ? record.description
          : "";
    const content = typeof record.content === "string" ? record.content : undefined;
    hits.push(content === undefined ? { title, url, snippet } : { title, url, snippet, content });
  }
  return hits;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "http";
  }
}

/**
 * 按环境变量选择检索器（判定层入口）。
 *
 * - 配了 `SEARCH_API_URL` + `SEARCH_API_KEY` → HTTP JSON 检索器；
 * - 配了 `SEARCH_FIXTURE_DIR` → 离线快照检索器（测试 / 无网环境）；
 * - 都没有 → `null`（调用方必须**显式报错**，不许静默降级成「用模型记忆猜」——
 *   参数知识幻觉大且查不出出处，设计文档 §5.4 已否决）。
 */
export function resolveSearchProvider(env: Record<string, string | undefined>): SearchProvider | null {
  const url = env.SEARCH_API_URL;
  const key = env.SEARCH_API_KEY;
  if (typeof url === "string" && url.length > 0 && typeof key === "string" && key.length > 0) {
    return createHttpJsonProvider({ url, apiKey: key, name: env.SEARCH_PROVIDER_NAME });
  }
  const fixtureDir = env.SEARCH_FIXTURE_DIR;
  if (typeof fixtureDir === "string" && fixtureDir.length > 0) {
    return createFixtureProvider(fixtureDir);
  }
  return null;
}
