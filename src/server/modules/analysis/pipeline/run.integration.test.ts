// @vitest-environment node
/**
 * 管线端到端集成测试（P0 → P6）。
 *
 * 为什么必须有这一层：
 * `vote.test.ts` / `merge.test.ts` 等单测只验证「函数本身正确」，
 * 而本项目踩过的坑恰恰在**函数之间的接线**上 ——
 * 例如 `runPipeline` 曾把 `voteRelations` 的入参写成单元素数组，
 * 导致 `votes` 恒为 1、跨分片投票彻底失效，而当时 142 个测试**全绿**。
 *
 * 本文件用「编排层 + 真实持久化 + 脚本化假模型」跑完整管线，
 * 断言的是**可观察的落库结果与真实提示词**，
 * 因此上述接线错误会直接导致断言失败（已用变异测试验证，见文件末尾说明）。
 *
 * 宿主差异处理与 `src/server/db/integration.test.ts` 一致，见该文件头注释。
 *
 * 维护提示（变异自测）：把 `runPipeline` 中 `groupRelationsBySlice(...)` 的
 * `sliceResults.map((item) => item.sliceIndex)` 改成 `[0]`（重现旧缺陷），
 * 本文件应出现失败 —— 若仍全绿，说明测试退化为「只测函数、不测接线」。
 *
 * 维护提示 2（N20 护栏的变异自测，2026-10-10 已实测 3/3 全杀）：
 * - 把 `if (abortReasons.length > 0)` 改成恒假 → 「N20 防护」与
 *   「分片提取失败必须留档」**两条**都应失败；
 * - 只删 `empty_entities` 那条 push → 仅「N20 防护」失败（提示 reasons 里缺它）；
 * - 只删 `extractOneSlice` catch 路径里的 `context.failedSlices.add(...)`
 *   → 仅「N20 防护」失败（提示 reasons 里缺 `extract_failure_ratio`）。
 * 三条都杀不掉，说明闸门或它的接线被改弱了。
 *
 * 维护提示 3（M1 埋点的变异自测，2026-10-11，见 `_wb_mutation_8c.py` 的 M32）：
 * - 把 `run.ts` 里的 `if (result.truncated)` 改成 `if (false)`
 *   → 「M1：撞输出上限必须留档」应失败。若仍全绿，说明「真值留档」没被测试覆盖，
 *   G1（信号在手却被丢弃）会在下一次重构里悄悄复发。
 *
 * 维护提示 4（P5 冲突别名留名字的变异自测，2026-10-11）：
 * - 删掉 `run.ts` 里 `merge_summary` 的 `conflictingAliasNames` 一行
 *   → 「P5 冲突别名：既要切断错并，也要把**名字**留在 merge_summary 里」应失败；
 * - 只改 `conflictingAliases`（计数）而不改名字 → 同上应失败（契约断言会抓到不一致）。
 * 两条都杀不掉，说明「名字级留档」又退回成「只记数量」。
 *
 * 维护提示 5（P5 冲突别名留**声称者**的变异自测，批次 26B）：
 * - 把 `run.ts` 里 `conflictingAliasOwners: merged.conflictingAliasOwners` 改成 `{}`
 *   → 同上用例应失败（见 `_wb_mutation_8c.py` 的 **M37**）；
 * - 把 `merge.ts` 里 `conflictingAliasOwners: Object.fromEntries(conflictingAliasOwners)`
 *   改成 `{}` → 也应由**同一个用例**失败（见 `_wb_mutation_merge.py` 的 **H**）。
 * 两条都杀不掉，说明「P5 可 $0 预演」这个前提**没有护栏** ——
 * 那正是批次 25「放行了 20 条却算不出被吃掉哪几条」的成因。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RELATION_TYPES } from "@/lib/relations";

/**
 * 每次脚本化调用返回的思考 token 数。
 *
 * 用 `vi.hoisted` 声明而非普通 `const`：`vi.mock` 会被提升到文件顶部，
 * 而下面的工厂函数引用了它 —— 提升后再用普通 const 有 TDZ 风险。
 */
const { REASONING_PER_CALL } = vi.hoisted(() => ({ REASONING_PER_CALL: 7 }));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

// `segmentit` 的 CJS 产物在 vitest 的 node 环境下初始化失败
// （`Cannot read properties of undefined (reading 'use')`），这是第三方库的
// 模块互操作问题，与本项目逻辑无关。分词只影响 P0 候选名的**来源**，
// 不影响本文件要验证的接线（投票 / 类型决策 / 上下文 / 锚点），
// 因此这里用确定性的假分词器替换，使测试聚焦于编排层。
vi.mock("@/server/modules/analysis/pipeline/tokenizer", () => ({
  scanBookCandidates: () => [
    { surface: "王冕", normalized: "王冕", frequency: 20, firstChapter: 1 },
    { surface: "秦老", normalized: "秦老", frequency: 18, firstChapter: 1 },
    { surface: "危素", normalized: "危素", frequency: 6, firstChapter: 1 },
    { surface: "某书院", normalized: "某书院", frequency: 5, firstChapter: 1 },
    { surface: "周进", normalized: "周进", frequency: 10, firstChapter: 2 },
    { surface: "范进", normalized: "范进", frequency: 12, firstChapter: 2 },
    { surface: "胡屠户", normalized: "胡屠户", frequency: 8, firstChapter: 2 }
  ]
}));

vi.mock("@/server/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { default: postgres } = await import("postgres");
  const schema = await import("@/server/db/schema");

  let instance: ReturnType<typeof drizzle<typeof schema>> | null = null;

  return {
    getDatabase: () => {
      instance ??= drizzle(postgres(process.env.DATABASE_URL ?? "", { max: 1 }), { schema });
      return instance;
    }
  };
});

/** 关系抽取阶段（P1）被调用过的用户消息，供滚动上下文断言使用。 */
const extractionPrompts: string[] = [];

/**
 * P1 提取是否强制失败（供「失败留档」用例使用）。
 *
 * 保持默认 false，使既有用例行为完全不变。
 */
let forceExtractionFailure = false;

/**
 * P1 提取是否「撞输出上限」（`finish_reason === "length"`）。
 *
 * 用途见本文件末尾 M1 用例（§3.23 五）。默认 false，
 * 使既有用例返回的 `truncated` 恒为 false —— 与改动前行为逐字一致。
 *
 * ⚠️ 这里模拟的是**真值**（服务端真的因为长度停住），而不是
 * `extract_truncated` 那个**代理**信号（「repair 过且 schema 仍失败」）。
 * 两者偏差方向不定（§3.23 三，G5），所以护栏必须钉在真值这一侧。
 */
let forceTruncated = false;

/**
 * P1 提取是否刻意产出**冲突别名**（同一别名被两个不同规范名声称）。
 *
 * 用途见本文件末尾「P5 冲突别名必须留名字」用例。默认 false，
 * 使既有用例返回的 `conflictingAliases` 恒为空 —— 与改动前行为逐字一致。
 *
 * 为什么需要它：`merge_summary` 原先只记 `conflictingAliases` 的**长度**，
 * 而「哪个别名被当成冲突丢了」在 `analysis_issues` 里**无从归因**（§8 名字级留档只做了一半）。
 * 只有真的造出一个冲突，才能钉住「名字也要记」这条接线。
 */
let forceAliasConflict = false;

/**
 * P1 提取是否刻意产出**「本片外、全书内」的别名**。
 *
 * 用途见本文件末尾「闸门别名作用域是全书」用例。默认 false。
 *
 * 为什么需要它：闸门原先要求别名**在本片**出现（`not_in_slice`），
 * 这比 P2 grounding（只要求**全书**出现）更严，而闸门的丢弃是**终局**的 ——
 * 「在本片之外、但在全书之内」的真别名会被永久删掉。要钉住这条口径，
 * 必须造出一个**只在本片外出现**的别名：`汶上县` 只在第二回里真实出现，
 * 于是「第一回的那些分片」就是天然的「本片外、全书内」场景。
 */
let forceOutOfSliceAlias = false;

/** 本次运行中，实际注入了「本片外」别名的分片数（前提校验用）。 */
let outOfSliceAliasSlices = 0;

/** 脚本化假模型：按 system 提示词区分阶段。 */
vi.mock("@/server/modules/ai/client", async () => {
  const actual = await import("@/server/modules/ai/client");
  return {
    ...actual,
    // 真实实现是异步（含退避重试），这里保持同签名；用 `Promise.resolve` 满足类型，
    // 同时避免「async 但无 await」的 lint 报错。
    callWithRetry: vi.fn(
      (request: { system: string; user: string }) => {
        // 模拟「连重试都救不回来」的失败：真实实现此时会抛 AiCallError。
        // 用真实的 `AiCallError`（而非普通 Error），以验证管线能正确取到 `kind`。
        if (forceExtractionFailure && request.system.includes("关系抽取")) {
          return Promise.reject(new actual.AiCallError("empty_output", "模型返回空内容"));
        }
        // 「撞输出上限」只对 P1 提取阶段生效（P0 词典输出体量小，不参与该场景）。
        const truncated = forceTruncated && request.system.includes("关系抽取");
        return Promise.resolve({
          text : scriptedCompletion(request.system, request.user),
          // 每次调用固定返回 REASONING_PER_CALL 个思考 token，
          // 使「思考 token 是否被累计」可断言（累计值应恒等于 次数 × 该常量）。
          usage: {
            tokensIn       : 100,
            tokensOut      : 50,
            reasoningTokens: REASONING_PER_CALL,
            costUsd        : 0
          },
          latencyMs   : 1,
          // M1 护栏（§3.23 五）：`truncated` / `finishReason` 是 `AiCompletionResult`
          // 的**必填**字段，真实实现由 `finish_reason === "length"` 算出（`ai/client.ts`）。
          // 默认 false / "stop" → 与本文件其余用例的旧行为一致
          // （旧 mock 压根没给这两个字段，读出来是 undefined，同样为假）。
          truncated,
          finishReason: truncated ? "length" : "stop"
        });
      }
    ),
    getModelSnapshot: () => ({
      provider    : "test-provider",
      extractModel: "test-extract",
      reviewModel : "test-review",
      temperature : 0,
      thinking    : "disabled" as const
    }),
    getBudgetEnv: () => ({ budgetUsd: 10, concurrency: 3 })
  };
});

/** 从提示词中截出「待抽取文本」正文。 */
function extractBody(user: string): string {
  const marker = "## 待抽取文本\n";
  const start = user.indexOf(marker);
  return start === -1 ? "" : user.slice(start + marker.length);
}

/** 脚本化模型：按 system 提示词区分阶段。 */
function scriptedCompletion(system: string, user: string): string {
  // P0 词典分类：全部接受；「某书院」判为 ORGANIZATION，其余 PERSON。
  if (system.includes("专名筛选器")) {
    const names =
      user
        .split("## 待判定词表\n")[1]
        ?.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0) ?? [];
    return JSON.stringify({
      verdicts: names.map((name) => ({
        name,
        accepted: true,
        type    : name === "某书院" ? "ORGANIZATION" : "PERSON"
      }))
    });
  }

  // P3 二审：全部通过。
  if (system.includes("实体审核员")) {
    const names =
      user
        .split("## 待复核实体清单\n")[1]
        ?.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0) ?? [];
    return JSON.stringify({
      verdicts: names.map((name) => ({ name, entityExists: true, nameSupported: true }))
    });
  }

  // P1 提取：按正文中出现的人物产出实体与关系。
  // 关键：同一对人物在**每个包含它们的分片**都输出一次，
  // 使跨分片投票有票可计（这正是旧接线失效的地方）。
  const body = extractBody(user);
  extractionPrompts.push(user);

  const entities: { canonical: string; type: string; nameType: string; aliases: string[] }[] = [];
  const relations: {
    typeCode       : string;
    sourceCanonical: string;
    targetCanonical: string;
    quote          : string;
  }[] = [];

  // 「县」是刻意放入的**单字泛称噪声**：正文里的「汶上县」让它能通过 P2 grounding
  // （字面确实出现过），只有 P1 落库前的准入闸门才拦得住它。
  const cast = ["王冕", "秦老", "危素", "某书院", "周进", "范进", "胡屠户", "县"];
  const present = cast.filter((name) => body.includes(name));
  for (const name of present) {
    // 「范老爷」刻意**不在正文中出现** —— 用于验证闸门「别名必须有字面证据」这条规则：
    // 模型凭空补的别名必须被丢弃，否则它会成为 P5 归并的桥接键。
    let aliases = name === "范进" ? ["范老爷"] : [];
    // 刻意让「王冕」与「秦老」**两个不同规范名**都声称别名「危素」。
    // 「危素」在第一回正文里真实出现 → 能过闸门的 `not_in_book` 检查 → 真的到达 P5，
    // 于是 P5 的「冲突别名」护栏必须丢弃它（`aliasOwners` 按规范名计数 → size 2）。
    if (forceAliasConflict && (name === "王冕" || name === "秦老")) {
      aliases = ["危素"];
    }
    // 批次 25：让「王冕」在**不含「汶上县」的分片**里被声称别名「汶上县」——
    // 「汶上县」在全书的第二回里真实出现，因此这正是「本片外、全书内」的别名。
    if (forceOutOfSliceAlias && name === "王冕" && !body.includes("汶上县")) {
      aliases = ["汶上县"];
      outOfSliceAliasSlices += 1;
    }
    entities.push({ canonical: name, type: "PERSON", nameType: "NAMED", aliases });
  }

  if (present.includes("王冕") && present.includes("秦老")) {
    // 关键：quote 必须是**原文中真实存在的不同句子** ——
    // ① 必须能通过 P2 grounding（字面命中），否则整条关系被剔除；
    // ② 必须**因分片而异**，这样 P4 跨片计票才能观察到 quotes 累积到 ≥2。
    // 若各片 quote 相同，`appendRelation` 会按内容去重，无法区分
    // 「计票失效」与「证据本就重复」。
    const candidates = [
      "秦老住在王冕家隔壁，两家往来甚密。",
      "王冕在秦老家里放牛看书，秦老待王冕如亲子，村中人都说秦老与王冕两家情谊深厚。",
      "危素见王冕画得好，便收王冕做了学生。"
    ];
    const quote = candidates.find((item) => body.includes(item));
    if (quote !== undefined) {
      relations.push({
        typeCode       : "朋友",
        sourceCanonical: "王冕",
        targetCanonical: "秦老",
        quote
      });
    }
  }
  if (present.includes("周进") && present.includes("范进")) {
    const candidates = [
      "周进在汶上县教了三年书，学生范进也来附学。",
      "周进见范进勤勉，十分欢喜，常以范进为得意门生，同窗都称周进与范进情同父子。",
      "范进中了举人，胡屠户前来贺喜。"
    ];
    const quote = candidates.find((item) => body.includes(item));
    if (quote !== undefined) {
      relations.push({
        typeCode       : "师生",
        sourceCanonical: "周进",
        targetCanonical: "范进",
        quote
      });
    }
  }

  return JSON.stringify({ entities, relations });
}

const MIGRATION_DIR = join(process.cwd(), "drizzle");

function readMigrations(): string[] {
  return readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATION_DIR, name), "utf8"));
}

/**
 * 造一段足够长的章节文本。
 *
 * 目的：让 `sliceChapter`（默认 3500 字/片）把**同一章切成多片**，
 * 从而真正产生「前一片 → 后一片」的滚动上下文依赖，
 * 以及「同一关系被多个分片观测」的投票场景。
 *
 * 注意：填充句必须足够长，否则整章仍不足 3500 字、只会产出 1 片
 * （这一点曾导致本文件的投票/上下文断言在「测试前提不成立」的情况下失败）。
 *
 * @param filler 重复填充的句子（应包含关键人物，使多片都命中同一关系）
 * @param times 重复次数
 * @returns 章节正文
 */
function pad(filler: string, times: number): string {
  return Array.from({ length: times }, () => filler).join("\n\n");
}

/**
 * 测试用小说：两章，每章被填充到足以切成 ≥2 片。
 *
 * 「王冕 / 秦老」在章内反复出现 → 产生多分片观测，使投票可被观察。
 */
const SAMPLE_NOVEL = [
  "第一回 王冕学画",
  "",
  "秦老住在王冕家隔壁，两家往来甚密。",
  "",
  "王冕七岁上死了父亲，母亲做些针指供他到村学堂里读书。秦老常来照看王冕。",
  "",
  pad("王冕在秦老家里放牛看书，秦老待王冕如亲子，村中人都说秦老与王冕两家情谊深厚。", 90),
  "",
  "危素见王冕画得好，便收王冕做了学生。秦老闻知，也替王冕欢喜。",
  "",
  pad("王冕学画有成，秦老常对人称道王冕，说王冕日后必有大出息。", 90),
  "",
  "王冕曾在某书院借读三月，秦老送王冕前往。",
  "",
  "第二回 周进登第",
  "",
  "周进在汶上县教了三年书，学生范进也来附学。",
  "",
  pad("周进见范进勤勉，十分欢喜，常以范进为得意门生，同窗都称周进与范进情同父子。", 90),
  "",
  "周进见范进勤勉，十分欢喜。范进中了秀才，周进又教范进文章。",
  "",
  pad("胡屠户是范进的岳父，常来周进家走动，周进也以礼相待胡屠户。", 90),
  "",
  "范进中了举人，胡屠户前来贺喜。"
].join("\n");

let pglite: PGlite;
let stopServer: (() => Promise<void>) | null = null;

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.waitReady;

  for (const migration of readMigrations()) {
    await pglite.exec(migration);
  }

  for (const type of RELATION_TYPES) {
    await pglite.query(
      "insert into relation_types (code, label, category, direction) values ($1, $2, $3, $4)",
      [type.code, type.label, type.category, type.direction]
    );
  }

  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  const server = new PGLiteSocketServer({
    db            : pglite,
    port          : 0,
    host          : "127.0.0.1",
    maxConnections: 10
  });
  await server.start();
  stopServer = () => server.stop();

  process.env.DATABASE_URL = `postgres://postgres:postgres@${server.getServerConn()}/postgres`;
}, 120_000);

afterAll(async () => {
  await stopServer?.();
  await pglite.close();
});

describe("runPipeline 端到端（P0 → P6）", () => {
  it("跑通完整管线并落库，返回成本与实体/关系计数", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");

    const imported = await importBook("儒林外史集成", "吴敬梓", parseChapters(SAMPLE_NOVEL));
    const result = await runPipeline({ bookId: imported.bookId });

    expect(result.entityCount).toBeGreaterThan(0);
    expect(result.relationCount).toBeGreaterThan(0);
    // 成本落档必须可用（analysis_calls 有记录）。
    expect(result.cost.callCount).toBeGreaterThan(0);
    expect(result.cost.tokensIn).toBeGreaterThan(0);
    // 思考 token 必须被累计：脚本化模型每次返回 REASONING_PER_CALL，
    // 故累计值恒等于 调用次数 × 该常量。若累计逻辑被删，此处得 0 而变红。
    expect(result.cost.reasoningTokens).toBe(result.cost.callCount * REASONING_PER_CALL);
  }, 120_000);

  it("跨分片投票生效：vote_summary 显示同一关系被多片共同印证", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");
    const { eq } = await import("drizzle-orm");
    const { getDatabase } = await import("@/server/db/client");
    const { analysisIssues } = await import("@/server/db/schema");

    const imported = await importBook("儒林外史投票", "吴敬梓", parseChapters(SAMPLE_NOVEL));
    const result = await runPipeline({ bookId: imported.bookId });

    // 前提校验：分片数必须 > 1，否则投票场景根本不成立。
    const extractCalls = extractionPrompts.filter((prompt) => prompt.includes("待抽取文本")).length;
    expect(extractCalls).toBeGreaterThan(1);

    const db = getDatabase();
    const issues = await db
      .select({ code: analysisIssues.code, payload: analysisIssues.payload })
      .from(analysisIssues)
      .where(eq(analysisIssues.runId, result.runId));

    const voteSummary = issues.find((issue) => issue.code === "vote_summary");
    expect(voteSummary).toBeDefined();

    // 核心断言：存在被 ≥2 个分片共同观测的关系。
    // 旧接线把全书压成一片 → 所有 votes 恒为 1 → multiSlice 恒为 0（本断言失败）。
    const payload = voteSummary?.payload as
      | { slices: number; multiSlice: number; maxVotes: number }
      | undefined;
    expect(payload?.slices).toBeGreaterThan(1);
    expect(payload?.multiSlice).toBeGreaterThan(0);
    expect(payload?.maxVotes).toBeGreaterThan(1);
  }, 120_000);

  it("跨分片观测被合并：同一关系多片观测后仍为单条边", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");
    const { eq } = await import("drizzle-orm");
    const { getDatabase } = await import("@/server/db/client");
    const { relationships, entities } = await import("@/server/db/schema");

    const imported = await importBook("儒林外史去重", "吴敬梓", parseChapters(SAMPLE_NOVEL));
    await runPipeline({ bookId: imported.bookId });

    const db = getDatabase();
    const rows = await db
      .select({ sourceName: entities.canonical, typeCode: relationships.relationTypeCode })
      .from(relationships)
      .innerJoin(entities, eq(relationships.sourceEntityId, entities.id))
      .where(eq(relationships.bookId, imported.bookId));

    expect(rows.length).toBeGreaterThan(0);

    // 同一 (pair, 类型) 无论被多少分片观测，落库仍只有一条边（去重生效）。
    const keys = rows.map((row) => `${row.sourceName}\u0000${row.typeCode}`);
    expect(new Set(keys).size).toBe(rows.length);
  }, 120_000);

  it("证据引用跨片累积：同一关系的多条不同引用被保留", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");

    const imported = await importBook("儒林外史证据", "吴敬梓", parseChapters(SAMPLE_NOVEL));
    await runPipeline({ bookId: imported.bookId });

    const evidence = await pglite.query<{ n: number }>(
      `select count(*)::int as n from evidence_spans es
       join relationships r on r.id = es.relationship_id
       where r.book_id = $1
       group by es.relationship_id`,
      [imported.bookId]
    );
    expect(evidence.rows.length).toBeGreaterThan(0);
    // 多片各给出不同的真实引用 → 累积 ≥2 条。
    const maxQuotes = Math.max(...evidence.rows.map((row) => row.n));
    expect(maxQuotes).toBeGreaterThan(1);
  }, 120_000);

  it("P0 的类型声明进入 P5：某书院被判为 ORGANIZATION 而非退回 PERSON", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");
    const { eq } = await import("drizzle-orm");
    const { getDatabase } = await import("@/server/db/client");
    const { entities } = await import("@/server/db/schema");

    const imported = await importBook("儒林外史类型", "吴敬梓", parseChapters(SAMPLE_NOVEL));
    await runPipeline({ bookId: imported.bookId });

    const db = getDatabase();
    const rows = await db
      .select({ canonical: entities.canonical, type: entities.type })
      .from(entities)
      .where(eq(entities.bookId, imported.bookId));

    // 修复前：类型只由分片提取决定（脚本把它标成 PERSON）→ 这里会是 PERSON。
    // 修复后：P0 的 ORGANIZATION 声明优先。
    const shuyuan = rows.find((row) => row.canonical === "某书院");
    expect(shuyuan).toBeDefined();
    expect(shuyuan?.type).toBe("ORGANIZATION");

    // 其余人物仍为 PERSON（未被误伤）。
    const wangmian = rows.find((row) => row.canonical === "王冕");
    expect(wangmian?.type).toBe("PERSON");
  }, 120_000);

  it("实体准入闸门：泛称不进图谱，称谓人物降为 TITLE_ONLY", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");
    const { eq } = await import("drizzle-orm");
    const { getDatabase } = await import("@/server/db/client");
    const { analysisIssues, entities, entityAliases } = await import("@/server/db/schema");

    const imported = await importBook("儒林外史闸门", "吴敬梓", parseChapters(SAMPLE_NOVEL));
    const result = await runPipeline({ bookId: imported.bookId });

    const db = getDatabase();
    const rows = await db
      .select({ canonical: entities.canonical, nameType: entities.nameType })
      .from(entities)
      .where(eq(entities.bookId, imported.bookId));

    // ① 单字泛称「县」：正文「汶上县」使它能通过 P2 grounding，
    //    只有闸门拦得住 —— 这条断言同时证明闸门**确实接在管线里**，
    //    而不只是「有一个没人调用的纯函数」。
    expect(rows.map((row) => row.canonical)).not.toContain("县");

    // ② 以职业为唯一称呼的人物保留，但名字类型降为 TITLE_ONLY。
    const tu = rows.find((row) => row.canonical === "胡屠户");
    expect(tu).toBeDefined();
    expect(tu?.nameType).toBe("TITLE_ONLY");

    // ③ 有本名的人物不受影响（降噪不得误伤）。
    expect(rows.find((row) => row.canonical === "王冕")?.nameType).toBe("NAMED");

    // ④ 拒绝行为必须留档：只删不记会让「某实体为什么没进图谱」无从归因。
    const issues = await db
      .select({ code: analysisIssues.code, payload: analysisIssues.payload })
      .from(analysisIssues)
      .where(eq(analysisIssues.runId, result.runId));

    const gateIssue = issues.find((issue) => issue.code === "entity_gate_rejected");
    expect(gateIssue).toBeDefined();

    // ⑤ 别名字面证据校验生效：mock 给「范进」凭空补了「范老爷」（全书里根本没有）。
    //
    // ⚠️ 这里**必须断言闸门的留档，而不是查库**。
    // 查库会得到「假绿」：即使闸门不做字面证据校验，「范老爷」也会被 P2 grounding
    // （全书字面匹配）拦下 —— 断言无论接线与否都通过，等于没测。
    // 只有 `droppedAliases` 里的 `not_in_book` 是**闸门独有**的证据。
    const payload = gateIssue?.payload as
      | {
          rejections    : { canonical: string; reason: string }[];
          droppedAliases: { alias: string; reason: string }[];
        }
      | undefined;
    expect(
      payload?.rejections.some((item) => item.canonical === "县" && item.reason === "single_char")
    ).toBe(true);
    expect(
      payload?.droppedAliases.some(
        (item) => item.alias === "范老爷" && item.reason === "not_in_book"
      )
    ).toBe(true);

    // 附带确认：凭空补的别名最终也确实没有落进别名表。
    const aliasRows = await db
      .select({ alias: entityAliases.alias })
      .from(entityAliases)
      .where(eq(entityAliases.bookId, imported.bookId));
    expect(aliasRows.map((row) => row.alias)).not.toContain("范老爷");
  }, 120_000);

  it("P5 冲突别名：既要切断错并，也要把**名字**留在 merge_summary 里", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");
    const { eq } = await import("drizzle-orm");
    const { getDatabase } = await import("@/server/db/client");
    const { analysisIssues, entities, entityAliases } = await import("@/server/db/schema");

    // 让 P1 把别名「危素」同时挂到「王冕」与「秦老」两个**不同规范名**上。
    forceAliasConflict = true;
    try {
      const imported = await importBook("儒林外史冲突别名", "吴敬梓", parseChapters(SAMPLE_NOVEL));
      const result = await runPipeline({ bookId: imported.bookId });

      const db = getDatabase();
      const issues = await db
        .select({ code: analysisIssues.code, payload: analysisIssues.payload })
        .from(analysisIssues)
        .where(eq(analysisIssues.runId, result.runId));

      const mergeIssue = issues.find((issue) => issue.code === "merge_summary");
      expect(mergeIssue).toBeDefined();

      const payload = mergeIssue?.payload as
        | {
            conflictingAliases    : number;
            conflictingAliasNames : string[];
            conflictingAliasOwners: Record<string, string[]>;
          }
        | undefined;

      // ① 前提校验：本用例必须**真的造出了冲突**，否则下面的断言会退化成「0 等于 0」的假绿。
      expect(payload?.conflictingAliases).toBeGreaterThan(0);

      // ② 契约：数量与名字必须一致，且名字是**原文形式**（不是归一化后的键）。
      expect(payload?.conflictingAliasNames).toEqual(["危素"]);

      // ②b 契约（批次 26B）：**声称者**也必须留档，且是原文形式、已排序。
      // 这是「P5 可 $0 预演」的全部前提 —— 名字只说明「丢了什么」，
      // 声称者才说明「为什么丢」，而后者正是 `aliasOwners` 那个**从不落库**的输入。
      expect(payload?.conflictingAliasOwners).toEqual({ 危素: ["王冕", "秦老"] });
      // ③ 一致性护栏：两个留档字段必须**同键**（防止将来只改一处、静默漂移）。
      expect(Object.keys(payload?.conflictingAliasOwners ?? {}).sort()).toEqual(
        [...(payload?.conflictingAliasNames ?? [])].sort()
      );

      // ③ 护栏真的生效：冲突别名**没有**把两个规范名并成一个实体。
      const rows = await db
        .select({ canonical: entities.canonical })
        .from(entities)
        .where(eq(entities.bookId, imported.bookId));
      const canonicals = rows.map((row) => row.canonical);
      expect(canonicals).toContain("王冕");
      expect(canonicals).toContain("秦老");
      // ④ 冲突别名不得落进别名表（否则它仍是下一次归并的桥接键）。
      const aliasRows = await db
        .select({ alias: entityAliases.alias })
        .from(entityAliases)
        .where(eq(entityAliases.bookId, imported.bookId));
      expect(aliasRows.map((row) => row.alias)).not.toContain("危素");
    } finally {
      // 复原：本开关会影响后续用例的 P1 输出，必须复位。
      forceAliasConflict = false;
    }
  }, 120_000);

  it("🔑 闸门别名作用域是**全书**：本片外、全书内的真别名不得被丢（批次 25）", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");
    const { eq } = await import("drizzle-orm");
    const { getDatabase } = await import("@/server/db/client");
    const { analysisIssues, entityAliases } = await import("@/server/db/schema");

    // 让「王冕」在**第一回的分片**里被声称别名「汶上县」。
    // 「汶上县」只在**第二回**里真实出现 → 这正是「本片外、全书内」的场景。
    forceOutOfSliceAlias = true;
    outOfSliceAliasSlices = 0;
    try {
      const imported = await importBook("儒林外史全书别名", "吴敬梓", parseChapters(SAMPLE_NOVEL));
      const result = await runPipeline({ bookId: imported.bookId });

      // ① 前提校验：必须**真的**造出了「本片外」的别名，
      //    否则下面的断言会退化成「空集不含某元素」的假绿。
      expect(outOfSliceAliasSlices).toBeGreaterThan(0);

      // ② 关键区分：闸门**不得**把「汶上县」当成 `not_in_book` 丢掉 ——
      //    它在**全书**里出现过（只是不在当前这一片）。
      //    ⚠️ 若闸门仍用「本片」口径，这一条必然失败（那一片的闸门会丢掉它）。
      const db = getDatabase();
      const issues = await db
        .select({ code: analysisIssues.code, payload: analysisIssues.payload })
        .from(analysisIssues)
        .where(eq(analysisIssues.runId, result.runId));
      const gatePayloads = issues
        .filter((issue) => issue.code === "entity_gate_rejected")
        .map(
          (issue) =>
            issue.payload as
              | { droppedAliases: { alias: string; reason: string }[] }
              | undefined
        );
      expect(gatePayloads.length).toBeGreaterThan(0);
      expect(
        gatePayloads.some((payload) =>
          payload?.droppedAliases.some(
            (item) => item.alias === "汶上县" && item.reason === "not_in_book"
          )
        )
      ).toBe(false);

      // ③ 它确实活到了落库（成为某实体的别名）—— 与 P2 grounding 的口径一致。
      const aliasRows = await db
        .select({ alias: entityAliases.alias })
        .from(entityAliases)
        .where(eq(entityAliases.bookId, imported.bookId));
      expect(aliasRows.map((row) => row.alias)).toContain("汶上县");
    } finally {
      forceOutOfSliceAlias = false;
      outOfSliceAliasSlices = 0;
    }
  }, 120_000);

  it("P1 注入滚动上下文：非首片的提示词带上前文出场人名", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");

    extractionPrompts.length = 0;

    const imported = await importBook("儒林外史上下文", "吴敬梓", parseChapters(SAMPLE_NOVEL));
    await runPipeline({ bookId: imported.bookId });

    const prompts = extractionPrompts.filter((prompt) => prompt.includes("## 待抽取文本"));
    expect(prompts.length).toBeGreaterThan(1);

    // 至少有一个非首片调用带上了滚动上下文。
    const withContext = prompts.filter((prompt) => prompt.includes("前文已出场的人名"));
    expect(withContext.length).toBeGreaterThan(0);

    // 且上下文必须排在正文之前（稳定前缀，利于 prompt cache）。
    for (const prompt of withContext) {
      expect(prompt.indexOf("前文已出场的人名")).toBeLessThan(prompt.indexOf("## 待抽取文本"));
    }
  }, 120_000);

  it("锚点 Top-N：候选词典不超上限注入，避免逐片重复全量词典", async () => {
    const { selectSliceAnchors } = await import("@/server/modules/analysis/pipeline/run");
    const { buildExtractionUserPrompt } = await import(
      "@/server/modules/analysis/pipeline/prompts"
    );

    const dictionary = Array.from({ length: 200 }, (_, index) => ({
      surface     : `人物${String(index)}`,
      normalized  : `人物${String(index)}`,
      frequency   : 200 - index,
      firstChapter: 1
    }));

    const anchors = selectSliceAnchors(dictionary, "人物7出现在此。", 60);
    const prompt = buildExtractionUserPrompt("人物7出现在此。", anchors);

    expect(anchors.length).toBeLessThanOrEqual(60);
    // 提示词中不出现全部 200 条。
    expect(prompt).not.toContain("人物199");
    expect(prompt).toContain("人物7");
  });

  /**
   * ⚠️ **这条用例的规格于 2026-10-10 被有意反转**（N20 修复的一部分）。
   *
   * 原文最后一行断言：「失败分片不应产出实体，但**仍要让管线跑完并落库（不中断）**」。
   * 那正是 N20 的缺陷本身 —— P1 全失败时 `persistGraph` 先删后建、写进空集，
   * 两本生产图谱被清空，而 `status` 仍是 `succeeded`、成本 $0、issues 0。
   * 换句话说，**旧断言把「删库报成功」当成规格保护了起来**。
   *
   * 现在：留档部分（`errorKind` 可归因）**逐字保留**，落库行为改为
   * 「拒绝落库 + 运行标记失败」。这不是为了让测试变绿而放宽口径，
   * 而是缺陷被修掉之后，尺子必须跟着改 —— 与「改金标必须是一次被看见的动作」同一条纪律。
   */
  it("分片提取失败必须留档，且带上可归因的 errorKind", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");
    const { desc, eq } = await import("drizzle-orm");
    const { getDatabase } = await import("@/server/db/client");
    const { analysisIssues, analysisRuns } = await import("@/server/db/schema");

    forceExtractionFailure = true;
    try {
      const imported = await importBook("儒林外史失败留档", "吴敬梓", parseChapters(SAMPLE_NOVEL));
      // N20 修复后：全失败会被质量闸门拦下并抛错，**不再落库**。
      await expect(runPipeline({ bookId: imported.bookId })).rejects.toThrow(/质量闸门/);

      // runId 不再由返回值给出（抛了），改按 bookId 取最近一次运行。
      const db = getDatabase();
      const [run] = await db
        .select({ id: analysisRuns.id })
        .from(analysisRuns)
        .where(eq(analysisRuns.bookId, imported.bookId))
        .orderBy(desc(analysisRuns.startedAt))
        .limit(1);
      expect(run?.id).toBeTruthy();

      const issues = await db
        .select({ code: analysisIssues.code, payload: analysisIssues.payload })
        .from(analysisIssues)
        .where(eq(analysisIssues.runId, run?.id ?? ""));

      const failed = issues.filter((issue) => issue.code === "extract_call_failed");
      expect(failed.length).toBeGreaterThan(0);

      // 核心断言（**未变**）：payload 必须含 errorKind。
      // 首轮全量解析的 7 条失败记录只有 message，无法区分
      // 「重试后仍空响应」与「内容不是合法 JSON」，只能事后翻日志猜。
      const payload = failed[0]?.payload as
        | { sliceIndex: number; errorKind: string; message: string }
        | undefined;
      expect(payload?.errorKind).toBe("empty_output");
      expect(typeof payload?.sliceIndex).toBe("number");
    } finally {
      forceExtractionFailure = false;
    }
  }, 120_000);

  /**
   * N20 的**回归护栏**（2026-10-10 事故：余额耗尽 → 两本生产图谱归零）。
   *
   * 这条用例断言的正是事故当天的签名：一次「看起来正常结束」的运行，
   * 把该作品既有的图谱**清空**了。修复前 ③ 会得到 0/0 而失败。
   */
  it("N20 防护：提取全失败时不得清空既有图谱，且运行必须不报成功", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");
    const { desc, eq } = await import("drizzle-orm");
    const { getDatabase } = await import("@/server/db/client");
    const { analysisIssues, analysisRuns, entities, relationships } = await import(
      "@/server/db/schema"
    );

    const imported = await importBook("儒林外史N20防护", "吴敬梓", parseChapters(SAMPLE_NOVEL));
    const db = getDatabase();
    const countGraph = async (): Promise<{ entities: number; relations: number }> => {
      const entityRows = await db
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.bookId, imported.bookId));
      const relationRows = await db
        .select({ id: relationships.id })
        .from(relationships)
        .where(eq(relationships.bookId, imported.bookId));
      return { entities: entityRows.length, relations: relationRows.length };
    };

    // ① 先正常跑一次，建立一张「好的」图谱 —— 它就是必须被保住的东西。
    const good = await runPipeline({ bookId: imported.bookId });
    const before = await countGraph();
    expect(before.entities).toBeGreaterThan(0);
    expect(before.relations).toBeGreaterThan(0);

    // ② 同一个作品，在「P1 全部失败」下重跑 —— 这正是 N20 的形态。
    forceExtractionFailure = true;
    try {
      await expect(runPipeline({ bookId: imported.bookId })).rejects.toThrow(/质量闸门/);
    } finally {
      forceExtractionFailure = false;
    }

    // ③ 核心断言：既有图谱必须**一个不多、一个不少**。
    //    修复前这里是 0/0 —— 那就是事故本身。
    expect(await countGraph()).toEqual(before);

    // ④ 这次运行必须**不报成功**（修复前恒为 succeeded）。
    const [latestRun] = await db
      .select({ id: analysisRuns.id, status: analysisRuns.status })
      .from(analysisRuns)
      .where(eq(analysisRuns.bookId, imported.bookId))
      .orderBy(desc(analysisRuns.startedAt))
      .limit(1);
    expect(latestRun?.id).not.toBe(good.runId);
    expect(latestRun?.status).toBe("failed");

    // ⑤ 必须留下**可归因**的解释，而不是只留一个失败状态。
    const issues = await db
      .select({ code: analysisIssues.code, payload: analysisIssues.payload })
      .from(analysisIssues)
      .where(eq(analysisIssues.runId, latestRun?.id ?? ""));
    const skipped = issues.find((issue) => issue.code === "persist_skipped_low_quality");
    expect(skipped).toBeDefined();
    const payload = skipped?.payload as
      | {
          reasons     : string[];
          totalSlices : number;
          failedSlices: number;
          failureRatio: number;
          entityCount : number;
        }
      | undefined;
    // 全失败 + 零实体 → 两条互补判据都应被点到名（缺一条说明判据被改弱了）。
    expect(payload?.reasons).toContain("empty_entities");
    expect(payload?.reasons).toContain("extract_failure_ratio");
    expect(payload?.failedSlices).toBe(payload?.totalSlices);
    expect(payload?.entityCount).toBe(0);

    // ⑥ 反作弊：闸门不能靠「反正都拦」蒙对 —— ① 的正常运行必须**真的**落过库。
    //    否则这条用例在「管线根本跑不通」时也会通过，等于没测。
    expect(good.entityCount).toBeGreaterThan(0);
  }, 120_000);

  /**
   * M1 的**回归护栏**（§3.23 五，2026-10-11）。
   *
   * 缺陷 G1 的形态很特别：`ai/client.ts` 早就算出了 `result.truncated`
   * （`finish_reason === "length"` 的**真值**），但 `run.ts` **从不读它** ——
   * 信号在手却被丢弃。于是「模型撞上限、产出被截断」这件事在库里查不到，
   * 事后只能拿 `extract_truncated` 这个**代理**去猜，而代理的偏差方向不定（G5）。
   *
   * 这条用例钉死「真值必须留档」：把 `run.ts` 里的 `if (result.truncated)`
   * 改成恒假 → 本用例失败（变异编号 M32，见 `_wb_mutation_8c.py`）。
   */
  it("M1：撞输出上限必须留档 extract_hit_token_limit（真值，不是代理）", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");
    const { eq } = await import("drizzle-orm");
    const { getDatabase } = await import("@/server/db/client");
    const { analysisIssues } = await import("@/server/db/schema");

    // 计数器是模块级的，会被前面的用例污染 —— 先清零，才能断言「条数 == 调用数」。
    extractionPrompts.length = 0;

    forceTruncated = true;
    try {
      const imported = await importBook("儒林外史截断留档", "吴敬梓", parseChapters(SAMPLE_NOVEL));
      const result = await runPipeline({ bookId: imported.bookId });

      const db = getDatabase();
      const issues = await db
        .select({ code: analysisIssues.code, payload: analysisIssues.payload })
        .from(analysisIssues)
        .where(eq(analysisIssues.runId, result.runId));

      const truncatedIssues = issues.filter((issue) => issue.code === "extract_hit_token_limit");
      // 前提校验：必须真的切成多片，否则「每条调用都留档」无从观察。
      const extractCalls = extractionPrompts.filter((prompt) =>
        prompt.includes("## 待抽取文本")
      ).length;
      expect(extractCalls).toBeGreaterThan(1);

      // 核心断言：**每一次**撞上限的调用都要留档，不能只记第一条。
      expect(truncatedIssues.length).toBe(extractCalls);

      const payload = truncatedIssues[0]?.payload as
        | {
            sliceIndex  : number;
            finishReason: string;
            tokensOut   : number;
            outputChars : number;
            sliceChars  : number;
          }
        | undefined;
      // 留档必须**可归因**：至少要知道「哪一片、为什么、输出多大、原片多大」。
      // 这正是 `extract_truncated` 给不了的（它只说「repair 过且 schema 仍失败」）。
      expect(payload?.finishReason).toBe("length");
      expect(payload?.tokensOut).toBe(50);
      expect(typeof payload?.sliceIndex).toBe("number");
      expect(payload?.outputChars).toBeGreaterThan(0);
      expect(payload?.sliceChars).toBeGreaterThan(0);

      // 反作弊：本埋点**只写 issues、不改图谱** ——
      // 否则「留档」会顺手改变产出，M1 就不再是零成本的可观测性改动。
      expect(result.entityCount).toBeGreaterThan(0);
      expect(result.relationCount).toBeGreaterThan(0);
    } finally {
      forceTruncated = false;
    }
  }, 120_000);
});

/**
 * 进度回调的接线契约。
 *
 * 为什么必须在这一层测：`onProgress` 是**给后台页面看的唯一数据源**，
 * 它一旦接错（阶段漏报、计数不增、runId 对不上），页面就会显示「卡住不动」，
 * 而纯函数测试与管线产出断言**都不会变红** —— 这正是批 63「接线点无覆盖」的形态。
 *
 * 变异自测：
 * - 把 `runExtractionStage` 里的 `completed += 1` 删掉 → 「分片计数必须递增」失败；
 * - 把 `reportProgress(input, run.id, ...)` 的 `run.id` 换成 `input.bookId` →
 *   「runId 必须与返回的 runId 一致」失败；
 * - 删掉收尾的 `stage: "done"` 上报 → 「最后一个事件是 done」失败。
 */
describe("进度回调", () => {
  it("阶段单调前进、分片计数到达总数、runId 与返回一致", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");
    const { runPipeline } = await import("@/server/modules/analysis/pipeline/run");

    const imported = await importBook("儒林外史进度", "吴敬梓", parseChapters(SAMPLE_NOVEL));

    const events: { runId: string; stage: string; slicesDone: number; slicesTotal: number }[] = [];
    const result = await runPipeline({
      bookId: imported.bookId,
      onProgress: (progress) => {
        events.push({
          runId      : progress.runId,
          stage      : progress.stage,
          slicesDone : progress.slicesDone,
          slicesTotal: progress.slicesTotal
        });
      }
    });

    // 至少要有：起始 dictionary、extract 若干、收尾 done。
    expect(events.length).toBeGreaterThan(2);

    const first = events[0];
    expect(first?.stage).toBe("dictionary");
    // 所有事件必须指向同一个 run，且就是本次返回的那一条。
    expect(new Set(events.map((event) => event.runId)).size).toBe(1);
    expect(first?.runId).toBe(result.runId);

    const extractEvents = events.filter((event) => event.stage === "extract");
    expect(extractEvents.length).toBeGreaterThan(1);

    // 分片计数必须递增且到达总数（漏掉 `completed += 1` 会在这里变红）。
    for (let index = 1; index < extractEvents.length; index += 1) {
      const previous = extractEvents[index - 1]?.slicesDone ?? 0;
      const current = extractEvents[index]?.slicesDone ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous);
    }
    const lastExtract = extractEvents[extractEvents.length - 1];
    expect(lastExtract?.slicesTotal).toBeGreaterThan(0);
    expect(lastExtract?.slicesDone).toBe(lastExtract?.slicesTotal);

    // 最后一个事件必须是 done（否则页面会永远停在 96%）。
    expect(events[events.length - 1]?.stage).toBe("done");
  }, 120_000);
});
