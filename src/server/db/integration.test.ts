// @vitest-environment node
/**
 * 数据库层集成测试。
 *
 * 为什么需要它：
 * - 单元测试只覆盖纯函数；而「迁移 SQL 能否执行」「外键约束是否满足」
 *   「落库后能否原样读回图谱」这三件事**只有对着真实 PostgreSQL 才验证得了**；
 * - 正式验收需要 Docker，开发机与 CI 上未必具备。本测试用 PGlite
 *   （WASM 编译的真实 PostgreSQL 17）在进程内起一个监听 TCP 的实例，
 *   让 `postgres.js` 直连 —— **无需任何外部依赖**即可跑通完整链路。
 *
 * 覆盖链路：迁移 → 关系字典种子 → 导入作品 → 归并 → 图谱落库 → 读取快照。
 *
 * 两处必须绕开的宿主差异：
 * 1. `connection()` 是 Next 的 PPR 运行时边界声明，在请求作用域外必然抛错 —— 只替换该函数；
 * 2. PGlite 的 socket 服务端**不支持跨连接并发**（`Promise.all` 发往多个 socket 时响应会串包，
 *    表现为 `postgres.js` 解析 DataRow 越界）。故此处把连接池固定为 `max: 1`，
 *    使并发查询在同一条连接上排队。真实 PostgreSQL 无此限制，生产代码的 `max: 10` 不受影响。
 *
 * 注意：本文件必须运行在 node 环境（jsdom 下 PGlite 的 WASM 无法加载）。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RELATION_TYPES } from "@/lib/relations";
import { normalizeName } from "@/lib/text";

// `server-only` 在非 RSC 环境会抛错；集成测试直连服务端模块，显式置空。
vi.mock("server-only", () => ({}));

// 见文件头「两处必须绕开的宿主差异」第 1 条。
vi.mock("next/server", () => ({
  connection: () => Promise.resolve()
}));

// 见文件头第 2 条：仅把连接池压到单连接，drizzle / schema / 查询逻辑全部走真实实现。
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

/** 迁移目录（vitest 的 cwd 为项目根）。 */
const MIGRATION_DIR = join(process.cwd(), "drizzle");

/** 按文件名排序读出全部迁移 SQL（`0000_`、`0001_`… 即 Drizzle 的应用顺序）。 */
function readMigrations(): string[] {
  return readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATION_DIR, name), "utf8"));
}

/** 测试用小说文本：3 章，人物反复出现，便于校验提及与关系。 */
const SAMPLE_NOVEL = [
  "第一回 王冕学画",
  "",
  "王冕七岁上死了父亲，母亲做些针指供他到村学堂里读书。秦老住在王冕家隔壁，两家往来甚密。",
  "",
  "王冕自此只在秦老家里放牛看书。危素见王冕画得好，便收王冕做了学生。",
  "",
  "第二回 周进登第",
  "",
  "周进在汶上县教了三年书，学生范进也来附学。周进见范进勤勉，十分欢喜。",
  "",
  "范进中了秀才，周进又教范进文章。胡屠户是范进的岳父，常来周进家走动。",
  "",
  "第三回 范进中举",
  "",
  "范进中了举人，胡屠户前来贺喜。周进闻讯，也差人送了一份贺礼给范进。"
].join("\n");

/** 迁移应建出的表（14 张；批 94 加入后台鉴权的 users）。 */
const EXPECTED_TABLES = [
  "analysis_calls",
  "analysis_issues",
  "analysis_runs",
  "books",
  "chapters",
  "entities",
  "entity_aliases",
  "entity_mentions",
  "evidence_spans",
  "external_knowledge",
  "paragraphs",
  "relation_types",
  "relationships",
  "users"
];

let pglite: PGlite;
let stopServer: (() => Promise<void>) | null = null;

/** 落库后的作品 ID，供后续断言共享。 */
let bookId = "";

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.waitReady;

  for (const migration of readMigrations()) {
    await pglite.exec(migration);
  }

  // 关系码有外键约束，必须先落种子数据（对应 `pnpm db:seed`）。
  for (const type of RELATION_TYPES) {
    await pglite.query(
      "insert into relation_types (code, label, category, direction) values ($1, $2, $3, $4)",
      [type.code, type.label, type.category, type.direction]
    );
  }

  // 静态 import 的具名导出探测对该包会失败（解析到 CJS 产物），改用动态导入。
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  const server = new PGLiteSocketServer({
    db            : pglite,
    port          : 0, // 交由内核分配空闲端口，避免与本地 PostgreSQL 冲突
    host          : "127.0.0.1",
    maxConnections: 10
  });
  await server.start();
  stopServer = () => server.stop();

  // 必须在首次调用 `getServerEnv()` 之前设置，否则会读到未定义。
  process.env.DATABASE_URL = `postgres://postgres:postgres@${server.getServerConn()}/postgres`;
}, 120_000);

afterAll(async () => {
  await stopServer?.();
  await pglite.close();
});

describe("迁移", () => {
  it("建出全部 14 张表", async () => {
    const result = await pglite.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename"
    );
    expect(result.rows.map((row) => row.tablename)).toEqual(EXPECTED_TABLES);
  });

  it("枚举类型已创建（book_status 含 parsing/ready）", async () => {
    const result = await pglite.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = 'book_status'
       order by e.enumsortorder`
    );
    expect(result.rows.map((row) => row.enumlabel)).toEqual([
      "pending",
      "parsing",
      "ready",
      "failed"
    ]);
  });
});

describe("导入作品", () => {
  it("章节与段落落库，作品状态置为 ready", async () => {
    const { importBook } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");

    const summary = await importBook("儒林外史", "吴敬梓", parseChapters(SAMPLE_NOVEL));
    bookId = summary.bookId;

    expect(summary.chapterCount).toBe(3);
    expect(summary.oversizedChapters).toEqual([]);

    const books = await pglite.query<{ status: string; chapter_count: number }>(
      "select status, chapter_count from books where id = $1",
      [bookId]
    );
    expect(books.rows[0]?.status).toBe("ready");
    expect(books.rows[0]?.chapter_count).toBe(3);

    const paragraphs = await pglite.query<{ n: number }>(
      `select count(*)::int as n from paragraphs p
       join chapters c on c.id = p.chapter_id
       where c.book_id = $1`,
      [bookId]
    );
    expect(paragraphs.rows[0]?.n).toBe(summary.paragraphCount);
    expect(paragraphs.rows[0]?.n).toBeGreaterThan(0);
  });

  it("重复导入同一标题为整体替换，不产生重复作品", async () => {
    const { importBook, findBookIdByTitle } = await import("@/server/modules/importing/persist");
    const { parseChapters } = await import("@/server/modules/importing/parse-text");

    const second = await importBook("儒林外史", "吴敬梓", parseChapters(SAMPLE_NOVEL));
    bookId = second.bookId;

    const count = await pglite.query<{ n: number }>(
      "select count(*)::int as n from books where title = $1",
      ["儒林外史"]
    );
    expect(count.rows[0]?.n).toBe(1);
    expect(await findBookIdByTitle("儒林外史")).toBe(bookId);
  });
});

describe("图谱落库与读回", () => {
  it("归并 → 落库：实体、别名、提及、关系、证据全部写入", async () => {
    const { persistGraph, buildMentionIndex } = await import(
      "@/server/modules/analysis/pipeline/persist-graph"
    );
    const { mergeEntities } = await import("@/server/modules/analysis/pipeline/merge");
    const { loadGraphSnapshot } = await import("@/server/modules/graph/read-graph");

    // 构造候选实体并走真实的 P5 归并 —— 这一步同时验证
    // 「归并输出的 keyToEntityIndex 能被落库正确消费」（v1 的引用丢失缺陷点）。
    const merged = mergeEntities({
      entities: [
        { canonical: "王冕", type: "PERSON", aliases: ["冕儿"] },
        { canonical: "秦老", type: "PERSON", aliases: [] },
        { canonical: "危素", type: "PERSON", aliases: [] },
        { canonical: "周进", type: "PERSON", aliases: [] },
        { canonical: "范进", type: "PERSON", aliases: [] },
        { canonical: "胡屠户", type: "PERSON", aliases: [] }
      ],
      nameFrequency: new Map([
        [normalizeName("王冕"), 4],
        [normalizeName("秦老"), 2],
        [normalizeName("危素"), 1],
        [normalizeName("周进"), 5],
        [normalizeName("范进"), 6],
        [normalizeName("胡屠户"), 2]
      ])
    });

    const keys = merged.entities.flatMap((entity) => [
      normalizeName(entity.canonical),
      ...entity.memberKeys
    ]);
    const mentionIndex = await buildMentionIndex(bookId, keys);

    const summary = await persistGraph(
      {
        bookId,
        runId           : "00000000-0000-0000-0000-000000000001",
        entities        : merged.entities,
        keyToEntityIndex: merged.keyToEntityIndex,
        relations       : [
          {
            typeCode    : "师生",
            sourceKey   : normalizeName("危素"),
            targetKey   : normalizeName("王冕"),
            quotes      : ["危素见王冕画得好，便收王冕做了学生。"],
            startChapter: 1,
            endChapter  : null,
            status      : "ACTIVE"
          },
          {
            typeCode    : "师生",
            sourceKey   : normalizeName("周进"),
            targetKey   : normalizeName("范进"),
            quotes      : ["周进见范进勤勉，十分欢喜。"],
            startChapter: 2,
            endChapter  : null,
            status      : "ACTIVE"
          },
          {
            typeCode    : "朋友",
            sourceKey   : normalizeName("秦老"),
            targetKey   : normalizeName("王冕"),
            quotes      : ["秦老住在王冕家隔壁，两家往来甚密。"],
            startChapter: 1,
            endChapter  : 1,
            status      : "ENDED"
          }
        ]
      },
      mentionIndex
    );

    expect(summary.entityCount).toBe(6);
    expect(summary.relationCount).toBe(3);
    expect(summary.mentionCount).toBeGreaterThan(0);

    // 落库的关系必须带真实生命周期，而不是恒为 null / ACTIVE。
    const ended = await pglite.query<{
      start_chapter: number;
      end_chapter  : number;
      status       : string;
    }>("select start_chapter, end_chapter, status from relationships where status = 'ENDED'");
    expect(ended.rows).toHaveLength(1);
    expect(ended.rows[0]?.start_chapter).toBe(1);
    expect(ended.rows[0]?.end_chapter).toBe(1);

    // 证据引用确实落到了段落上（外键可达）。
    const evidence = await pglite.query<{ n: number }>(
      `select count(*)::int as n from evidence_spans es
       join relationships r on r.id = es.relationship_id
       where r.book_id = $1`,
      [bookId]
    );
    expect(evidence.rows[0]?.n).toBe(3);

    // 读回快照：这是页面真正消费的数据结构。
    const snapshot = await loadGraphSnapshot(bookId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.bookTitle).toBe("儒林外史");
    expect(snapshot?.nodes).toHaveLength(6);
    expect(snapshot?.edges).toHaveLength(3);
    expect(snapshot?.legend.length).toBeGreaterThan(0);

    // 度数：周进与范进各有一条师生关系，度数均为 1。
    const zhouJin = snapshot?.nodes.find((node) => node.name === "周进");
    expect(zhouJin?.degree).toBe(1);
    expect(zhouJin?.mentionCount).toBeGreaterThan(0);

    // 证据引用被读回并挂到边上；师生属第 3 组（从属）。
    const teacherEdge = snapshot?.edges.find((edge) => edge.typeCode === "师生");
    expect(teacherEdge?.evidenceQuotes.length).toBeGreaterThan(0);
    expect(teacherEdge?.evidenceCount).toBe(teacherEdge?.evidenceQuotes.length);
    expect(teacherEdge?.category).toBe(3);

    // 新增字段：章节摘要与按切片实算的关系码统计。
    expect(snapshot?.chapters.length).toBeGreaterThan(0);
    expect(snapshot?.codeStats.length).toBeGreaterThan(0);
    expect(snapshot?.nodes.every((node) => node.subDegree >= 0)).toBe(true);
  });

  it("未登记的关系码被外键拒绝（提示必须先执行 db:seed）", async () => {
    await expect(
      pglite.query(
        `insert into relationships (book_id, source_entity_id, target_entity_id, relation_type_code, start_chapter)
         select $1, (select id from entities where book_id = $1 limit 1),
                    (select id from entities where book_id = $1 offset 1 limit 1),
                    '不存在的关系码', 1`,
        [bookId]
      )
    ).rejects.toThrow(/foreign key|violates/i);
  });
});

describe("提及的作用域与关系去重口径（缺陷 N1 / N16）", () => {
  it("**N16 的成因**：同一实体三元组在库里只允许一条 —— 而 P6 曾按**归一化键**去重", async () => {
    // 这条断言钉住的是「为什么两个口径不一致会致命」：
    // `relationships_triple_uq` 建在**实体 id** 上，而 `aggregateRelations`
    // 按**归一化键三元组**分组。于是「键不同、实体相同」的两条关系
    // 在 P6 看来是两条、在库里是同一条 → 第二条被 onConflictDoNothing 静默吞掉。
    const pair = await pglite.query<{ id: string }>(
      "select id from entities where book_id = $1 order by canonical limit 2",
      [bookId]
    );
    const [source, target] = pair.rows;
    expect(source).toBeDefined();
    expect(target).toBeDefined();

    const insert = () =>
      pglite.query(
        `insert into relationships
           (book_id, source_entity_id, target_entity_id, relation_type_code, start_chapter)
         values ($1, $2, $3, '朋友', 1)`,
        [bookId, source?.id, target?.id]
      );

    await insert();
    // 第二次必须被拒 —— 这就是 N16 静默丢失的那 12 / 60 条的去处。
    await expect(insert()).rejects.toThrow(/duplicate key|unique|违反唯一/i);
  });

  it("**N1**：提及被限制在实体的观测章节内，跨回的别名提及被丢弃", async () => {
    const { persistGraph, buildMentionIndex } = await import(
      "@/server/modules/analysis/pipeline/persist-graph"
    );
    const { mergeEntities } = await import("@/server/modules/analysis/pipeline/merge");

    // 构造 N1 的最小复现（用样例语料的真实坐标）：
    //   `王冕` 只在第 1 回出现（2 段）；
    //   别名 `学生` 在第 1 回出现 1 次、**第 2 回也出现 1 次**（「学生范进也来附学」）。
    // 观测章节是第 1 回 → 别名驱动的第 2 回那一次提及必须被丢掉。
    // 这正是真实语料里 `王公`（全书 10 次、第一回 0 次）靠别名 `老父台`
    // 把第一回 段 9 的提及拖进来的同一个机制。
    const merged = mergeEntities({
      entities: [
        {
          canonical       : "王冕",
          type            : "PERSON",
          aliases         : ["学生"],
          observedChapters: [1]
        }
      ],
      nameFrequency: new Map()
    });
    // 前提断言：别名必须真的活下来了，否则本用例什么都没测到。
    expect(merged.entities[0]?.memberKeys).toEqual(["王冕", "学生"]);

    const keys = merged.entities.flatMap((entity) => [
      normalizeName(entity.canonical),
      ...entity.memberKeys
    ]);
    const mentionIndex = await buildMentionIndex(bookId, keys);

    // 先证明**索引本身是全库的**（并带章节序号）：别名命中的段落跨了 1、2 两回。
    const aliasHits = mentionIndex.get(normalizeName("学生")) ?? [];
    expect(aliasHits.map((hit) => hit.chapterOrdinal)).toEqual([1, 2]);

    const summary = await persistGraph(
      {
        bookId,
        runId           : "00000000-0000-0000-0000-000000000002",
        entities        : merged.entities,
        keyToEntityIndex: merged.keyToEntityIndex,
        relations       : []
      },
      mentionIndex
    );

    // 丢弃确实发生了，且被逐条留档（否则这个修法在库里完全不可见）。
    expect(summary.mentionScopeDropped).toBe(1);
    expect(summary.mentionScopeDrops).toEqual([{ canonical: "王冕", dropped: 1 }]);

    // 落库的提及**全部**落在观测章节（第 1 回）内 —— 这是 N1 的不变量。
    const rows = await pglite.query<{ ordinal: number }>(
      `select distinct c.ordinal from entity_mentions m
       join paragraphs p on p.id = m.paragraph_id
       join chapters c on c.id = p.chapter_id
       where m.entity_id = (select id from entities where book_id = $1)`,
      [bookId]
    );
    expect(rows.rows.map((row) => row.ordinal)).toEqual([1]);
  });

  /**
   * **N1 的计数口径**：同一次命中只能被数一次。
   *
   * 为什么必须单独一条：上面那条 N1 用例的丢弃来自**别名**（`学生`），
   * 而 `王冕`（规范名）的命中**全部在观测章节内** → 重复计数改变不了结果，
   * **它测不到这个 bug**。要触发它，越界的命中必须来自**规范名键本身**。
   *
   * 缺陷形态（`persist-graph.ts` 里 `[normalizeName(canonical), ...memberKeys]` 未去重，
   * 而 `memberKeys` 本来就含规范名键）：规范名的每一次越界命中被数两遍 →
   * `mention_scope_filtered.dropped` 虚高。批 10 曾修好，**随 N19 回滚一起被撤销**，
   * 于是批次 11 的 1664 / 5172 仍是虚高值。
   *
   * ⚠️ 断言写法刻意**不写死数字**：期望值由测试自己用「去重后的键」独立算一遍，
   * 这样它钉住的是**不变量**（每键只数一次），而不是某次运行的巧合。
   */
  it("**N1 计数口径**：规范名键不得因 memberKeys 重复而把越界命中数两遍", async () => {
    const { persistGraph, buildMentionIndex } = await import(
      "@/server/modules/analysis/pipeline/persist-graph"
    );
    const { mergeEntities } = await import("@/server/modules/analysis/pipeline/merge");

    // 观测章节取**第 2 回**，而 `王冕` 只在第 1 回出现 → 越界命中来自规范名键本身。
    const merged = mergeEntities({
      entities: [
        {
          canonical       : "王冕",
          type            : "PERSON",
          aliases         : ["学生"],
          observedChapters: [2]
        }
      ],
      nameFrequency: new Map()
    });
    expect(merged.entities[0]?.memberKeys).toEqual(["王冕", "学生"]);

    const keys = merged.entities.flatMap((entity) => [
      normalizeName(entity.canonical),
      ...entity.memberKeys
    ]);
    const mentionIndex = await buildMentionIndex(bookId, keys);

    // 独立算「应该丢几次」：**去重后**每个键的越界命中数之和。
    const observed = new Set([2]);
    const expected = [...new Set(keys)].reduce(
      (sum, key) =>
        sum +
        (mentionIndex.get(key) ?? []).filter((hit) => !observed.has(hit.chapterOrdinal)).length,
      0
    );
    // 前提断言：必须真的存在越界命中，否则本用例什么都没测到。
    expect(expected).toBeGreaterThan(0);

    const summary = await persistGraph(
      {
        bookId,
        runId           : "00000000-0000-0000-0000-000000000003",
        entities        : merged.entities,
        keyToEntityIndex: merged.keyToEntityIndex,
        relations       : []
      },
      mentionIndex
    );

    // 核心断言：报告值必须等于「去重后的键」算出的值。
    // 修复前 `[王冕, 王冕, 学生]` 逐键累加 → 规范名那部分被算两遍 → 约 2×。
    expect(summary.mentionScopeDropped).toBe(expected);
    expect(summary.mentionScopeDrops).toEqual([{ canonical: "王冕", dropped: expected }]);
  });

  it("**N1 的向后兼容**：未提供观测章节时不施加限制（旧调用点行为不变）", async () => {
    const { persistGraph, buildMentionIndex } = await import(
      "@/server/modules/analysis/pipeline/persist-graph"
    );
    const { mergeEntities } = await import("@/server/modules/analysis/pipeline/merge");

    // 不传 observedChapters → 空数组 → 不限制。
    // 这条分支是**故意**的：把它写成「限制到零章节」会让所有旧调用点静默产出零提及 ——
    // 一个比原缺陷更难发现的失败模式。
    const merged = mergeEntities({
      entities     : [{ canonical: "王冕", type: "PERSON", aliases: ["学生"] }],
      nameFrequency: new Map()
    });
    expect(merged.entities[0]?.observedChapters).toEqual([]);

    const keys = merged.entities.flatMap((entity) => [
      normalizeName(entity.canonical),
      ...entity.memberKeys
    ]);
    const mentionIndex = await buildMentionIndex(bookId, keys);

    const summary = await persistGraph(
      {
        bookId,
        runId           : "00000000-0000-0000-0000-000000000003",
        entities        : merged.entities,
        keyToEntityIndex: merged.keyToEntityIndex,
        relations       : []
      },
      mentionIndex
    );

    expect(summary.mentionScopeDropped).toBe(0);
    // 跨回的提及照样落库（第 1 回 + 第 2 回）。
    const ordinals = await pglite.query<{ ordinal: number }>(
      `select distinct c.ordinal from entity_mentions m
       join paragraphs p on p.id = m.paragraph_id
       join chapters c on c.id = p.chapter_id
       where m.entity_id = (select id from entities where book_id = $1)
       order by c.ordinal`,
      [bookId]
    );
    expect(ordinals.rows.map((row) => row.ordinal)).toEqual([1, 2]);
  });
});
