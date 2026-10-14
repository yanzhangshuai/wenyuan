import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { normalizeName } from "@/lib/text";
import { resolveWorkPack } from "@/server/modules/analysis/genre-pack";
import { DISCOVERY_DEFAULTS, discoverNgrams, selectByFreedom } from "@/server/modules/analysis/genre-pack/discovery";
import { auditPack, normalizeEntries, planPackEntries } from "@/server/modules/analysis/genre-pack/pack-audit";

import { loadBookBody } from "./lib/book-corpus";

/**
 * **作品包的「生产端」**（批次 38）—— 把 `works/*.ts` 从「手编源文件」变成「**生成产物**」。
 *
 * ## 为什么需要它（§2.F 发现二）
 *
 * 参考项目 AI-Reader-V2 的 P0 是「**统计候选 → LLM 分类成白名单**」。
 * 我们借了**消费端**（拿词典做锚定），没借**生产端**（自动造词典）
 * → `works/*.ts` 成了手编源文件 → **每一次改进都成了一次手工编辑**。
 *
 * 本脚本把那条链补上，**输入只有三样，全部是版本化的**：
 *
 * ```
 *   策展产物（LLM 输出的 accepted 白名单）  works/<book>.curation.json
 * + 语料（生产口径：normalizeEncoding → stripStructuralNoise → parseChapters）
 * + 异文映射（可审阅的极小表）             works/<book>.variants.json
 *   ──────────────────────────────────────
 *   → 三条审计（pack-audit.ts）→ 确定的条目集合 → 与已提交的 works/<book>.ts 比对
 * ```
 *
 * ## 用法
 *
 * ```bash
 * # 再生成校验：断言「已提交的包 == 生成结果」（**手改会被抓**）
 * pnpm exec tsx scripts/build-work-pack.ts --pack 儒林外史 --corpus books/儒林外史.txt --check
 *
 * # 打印可粘进 works/*.ts 的条目块
 * pnpm exec tsx scripts/build-work-pack.ts --pack 儒林外史 --corpus books/儒林外史.txt --emit
 * ```
 *
 * 未给 `--curation` 时退化为**固定点检查**：以**已提交的包**为输入跑审计，
 * 报告「三条审计是否已经干净」—— 用于**还没有策展产物**的书（如红楼）。
 *
 * ⚠️ 本脚本不 import `server-only`，故**不需要** `--conditions=react-server`。
 */

/** 命令行参数。 */
interface CliOptions {
  readonly pack       : string;
  readonly corpus     : string;
  readonly curation   : string | undefined;
  readonly variants   : string | undefined;
  readonly withdrawals: string | undefined;
  readonly aliases    : string | undefined;
  readonly emit       : boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let pack = "";
  let corpus = "";
  let curation: string | undefined;
  let variants: string | undefined;
  let withdrawals: string | undefined;
  let aliases: string | undefined;
  let emit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pack") {
      pack = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--corpus") {
      corpus = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--curation") {
      curation = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--variants") {
      variants = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--withdrawals") {
      withdrawals = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--aliases") {
      aliases = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--emit") {
      emit = true;
      continue;
    }
  }

  if (pack === "" || corpus === "") {
    throw new Error(
      "用法：tsx scripts/build-work-pack.ts --pack <作品标题> --corpus <书籍文本> " +
        "[--curation <策展产物.json>] [--variants <异文映射.json>] [--withdrawals <撤下表.json>] " +
        "[--aliases <别名组.json>] [--check|--emit]"
    );
  }
  return { pack, corpus, curation, variants, withdrawals, aliases, emit };
}

/** 读一份 `{properNouns: [[surface, postag], ...]}`。 */
async function readPackFile(path: string): Promise<{ name: string; postag: number }[]> {
  const raw = await readFile(resolve(path), "utf8");
  const parsed = JSON.parse(raw) as { properNouns?: [string, number][] };
  if (!Array.isArray(parsed.properNouns)) {
    throw new Error(`${path} 里没有 properNouns 数组`);
  }
  return parsed.properNouns.map(([name, postag]) => ({ name, postag }));
}

/**
 * 读一份异文映射。兼容两种形状：`{"死条目": "替换写法"}` 与
 * `{"_note": "...", "entries": {...}}` —— 后者用来把**待判 / 待启用**的异文
 * 连**理由**一起留在文件里（判断必须留痕；红楼那 3 条就是这么挂着的）。
 */
async function readVariantMap(path: string | undefined): Promise<Record<string, string>> {
  if (path === undefined) {
    return {};
  }
  const raw = await readFile(resolve(path), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const source =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "entries" in parsed
      ? (parsed).entries
      : parsed;
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new Error(`${path} 必须是对象，或含 entries 对象的对象`);
  }
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") {
      throw new Error(`${path} 的值必须是字符串：${key}`);
    }
    map[key] = value;
  }
  return map;
}

/**
 * 读一份撤下表。兼容两种形状：`["条目", ...]` 与 `{"_note": "...", "entries": [...]}`
 * （后者用来把**理由**留在文件里 —— 判断必须留痕）。
 */
async function readWithdrawals(path: string | undefined): Promise<string[]> {
  if (path === undefined) {
    return [];
  }
  const raw = await readFile(resolve(path), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { entries?: unknown }).entries)
        ? (parsed as { entries: unknown[] }).entries
        : null);
  if (list === null) {
    throw new Error(`${path} 必须是数组，或含 entries 数组的对象`);
  }
  return list.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`${path} 里出现非字符串：${JSON.stringify(item)}`);
    }
    return item;
  });
}

/**
 * 读一份别名组。兼容两种形状：`[["甲","乙"], ...]` 与 `{"_note": "...", "groups": [...]}`
 * （后者用来把**证据与排除理由**留在文件里 —— 「声明即断言」，判断必须留痕）。
 *
 * ⚠️ 这里**不做**语义校验（「组内不足 2 个」「名字出现在两个组」）——
 * 那些在**注册期**由 `assertWorkPackIsValid` 拦，跑一次 analyze 就会触发，比这里更早更硬。
 */
async function readAliasGroups(path: string | undefined): Promise<string[][]> {
  if (path === undefined) {
    return [];
  }
  const raw = await readFile(resolve(path), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { groups?: unknown }).groups)
      ? (parsed as { groups: unknown[] }).groups
      : null;
  if (list === null) {
    throw new Error(`${path} 必须是数组，或含 groups 数组的对象`);
  }
  return list.map((item) => {
    if (!Array.isArray(item) || item.some((name) => typeof name !== "string")) {
      throw new Error(`${path} 的每一组必须是字符串数组：${JSON.stringify(item)}`);
    }
    return item as string[];
  });
}

/**
 * 别名组的**集合签名**（`--check` 用）。
 *
 * 每组归一化后去重、排序、拼成一个串；组与组之间再排序。
 * 理由与 `properNouns` 的集合比较一致：**顺序不是承重件**，只有「哪些名字属于同一人」是。
 */
function aliasGroupSignature(groups: readonly (readonly string[])[]): string[] {
  return groups
    .map((group) =>
      [...new Set(group.map((name) => normalizeName(name)).filter((key) => key.length > 0))]
        .sort()
        .join("\u0001")
    )
    .sort();
}

/** 主流程。 */
async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const { body, headings } = await loadBookBody(resolve(options.corpus));

  const resolution = resolveWorkPack(options.pack);
  if (!resolution.matched) {
    throw new Error(`作品标题「${options.pack}」未命中注册表`);
  }
  const pack = resolution.pack;
  const committed = pack.properNouns.map(([surface, postag]) => ({ name: surface, postag }));

  // 输入：策展产物；未给则退化为「以已提交的包为输入」的固定点检查。
  const source = options.curation === undefined ? committed : await readPackFile(options.curation);
  const variantMap = await readVariantMap(options.variants);
  const withdrawals = await readWithdrawals(options.withdrawals);
  const aliasGroups = await readAliasGroups(options.aliases);

  const candidates = selectByFreedom(discoverNgrams(body), DISCOVERY_DEFAULTS.minFreedom);
  const report = auditPack(
    source.map((entry) => entry.name),
    { body, headings, candidates }
  );
  const plan = planPackEntries(
    source.map((entry) => entry.name),
    report,
    { variants: variantMap, withdrawals }
  );

  console.log("=".repeat(84));
  console.log(`《${options.pack}》　语料 ${basename(options.corpus)}（正文 ${String(body.length)} 字 / 回目 ${String(headings.length)} 行）`);
  console.log(
    options.curation === undefined
      ? "输入：**已提交的包**（固定点检查 —— 未给 --curation）"
      : `输入：策展产物 ${basename(options.curation)}`
  );
  console.log(`过闸候选（freedom >= ${String(DISCOVERY_DEFAULTS.minFreedom)}）：${String(candidates.length)} 条`);
  console.log("=".repeat(84));

  console.log();
  console.log("【审计 1】死条目（原文 = 正文 + 回目，出现 0 次）");
  console.log(`  ${String(report.deadEntries.length)} 条：${report.deadEntries.join(" ") || "（无）"}`);
  console.log(`  其中**只在回目**（活条目，不删）：${String(report.headingOnlyEntries.length)} 条` +
    (report.headingOnlyEntries.length > 0 ? " —— " + report.headingOnlyEntries.join(" ") : ""));

  console.log();
  console.log("【审计 2】前缀隐患提案（条目 ⊂ 过闸候选，且频次比 ≥ 0.3 —— `findPrefixConflicts` 看不见的那一类）");
  if (report.prefixHazards.length === 0) {
    console.log("  ✅ 无");
  } else {
    const inTable = new Set(withdrawals);
    for (const hazard of report.prefixHazards) {
      const mark = inTable.has(hazard.entry) ? "  ← 已在撤下表里" : "";
      console.log(
        `  ⛔ ${hazard.entry} ⊂ ${hazard.shadowed}(${String(hazard.shadowedFrequency)}，比 ${hazard.ratio.toFixed(2)})${mark}`
      );
    }
    console.log("  ⚠️ 这是**提案**：频次比是启发式，撤下与否是语义判断 → 决策记在 withdrawals 表里。");
  }

  console.log();
  console.log("【审计 3】一字异文建议（死条目在语料里的近写法）");
  if (report.variantSuggestions.length === 0) {
    console.log("  （无）");
  } else {
    for (const suggestion of report.variantSuggestions) {
      const applied = variantMap[suggestion.dead] === suggestion.replacement ? "  ← 已在映射表里" : "";
      console.log(
        `  · ${suggestion.dead} → ${suggestion.replacement}（正文 ${String(suggestion.occurrences)} 次）${applied}`
      );
    }
  }

  const planned = [...plan.kept, ...plan.added];
  const plannedSet = new Set(normalizeEntries(planned));
  const committedSet = new Set(normalizeEntries(committed.map((entry) => entry.name)));

  console.log();
  console.log("【计划】");
  console.log(`  输入 ${String(normalizeEntries(source.map((e) => e.name)).length)} 条` +
    ` → 删 ${String(plan.dropped.length)} → 补 ${String(plan.added.length)} → **${String(plannedSet.size)}** 条`);
  console.log(
    `  别名组 ${String(aliasGroups.length)} 组` +
      (options.aliases === undefined ? "（未给 --aliases）" : `（${basename(options.aliases)}）`)
  );

  if (options.emit) {
    console.log();
    console.log("【--emit】条目块（可直接粘进 works/*.ts）");
    const postagOf = new Map(source.map((entry) => [entry.name, entry.postag]));
    for (const name of planned) {
      const postag = postagOf.get(name) ?? 128;
      console.log(`  ["${name}", ${postag === 64 ? "POSTAG_PLACE" : "POSTAG_PERSON"}],`);
    }
    if (aliasGroups.length > 0) {
      console.log();
      console.log("【--emit】别名组块（可直接粘进 works/*.ts）");
      for (const group of aliasGroups) {
        console.log(`  [${group.map((name) => `"${name}"`).join(", ")}],`);
      }
    }
  }

  console.log();
  console.log("【--check】已提交的包 == 生成结果？");
  const onlyInPlanned = [...plannedSet].filter((name) => !committedSet.has(name));
  const onlyInCommitted = [...committedSet].filter((name) => !plannedSet.has(name));

  // 别名组也按**集合签名**比对（顺序不是承重件，只有「谁和谁同一个人」是）。
  const plannedGroups = aliasGroupSignature(aliasGroups);
  const committedGroups = aliasGroupSignature(pack.aliasGroups ?? []);
  const groupsOnlyInPlanned = plannedGroups.filter((key) => !committedGroups.includes(key));
  const groupsOnlyInCommitted = committedGroups.filter((key) => !plannedGroups.includes(key));

  if (
    onlyInPlanned.length === 0 &&
    onlyInCommitted.length === 0 &&
    groupsOnlyInPlanned.length === 0 &&
    groupsOnlyInCommitted.length === 0
  ) {
    console.log(`  ✅ 集合相等（${String(plannedSet.size)} 条 + 别名组 ${String(plannedGroups.length)} 组）` +
      "—— 包是**生成产物**，没有手工漂移");
    console.log("  ⚠️ 刻意**只比集合**：源码按 PERSONS/PLACES 两个子数组组织，顺序不是承重件。");
    return 0;
  }
  console.log(`  ❌ 不一致：生成侧多 ${String(onlyInPlanned.length)} 条 / 已提交侧多 ${String(onlyInCommitted.length)} 条`);
  if (onlyInPlanned.length > 0) {
    console.log(`    生成侧独有：${onlyInPlanned.join(" ")}`);
  }
  if (onlyInCommitted.length > 0) {
    console.log(`    已提交侧独有：${onlyInCommitted.join(" ")}`);
  }
  if (groupsOnlyInPlanned.length > 0) {
    console.log(`    别名组生成侧独有 ${String(groupsOnlyInPlanned.length)} 组：${groupsOnlyInPlanned.join(" ／ ")}`);
  }
  if (groupsOnlyInCommitted.length > 0) {
    console.log(`    别名组已提交侧独有 ${String(groupsOnlyInCommitted.length)} 组：${groupsOnlyInCommitted.join(" ／ ")}`);
  }
  console.log("  → 说明包被**手工改过**（或策展产物/异文映射/别名组未同步）。请改输入，别改产物。");
  return 1;
}

process.exit(await main());
