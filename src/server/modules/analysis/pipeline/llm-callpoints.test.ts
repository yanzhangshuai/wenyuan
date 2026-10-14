/**
 * LLM 调用点契约（**护栏**，不是文档）。
 *
 * 为什么必须有这个测试：
 * 2026-10-10 删除了 P3 二审 —— 它在真实语料上 **100% 空转**：
 * 把全部实体名拼成一个清单一次调用，而提示词要求逐实体输出判定，
 * 输出体量 **O(名字数)**；实测《儒林外史》908 名、《红楼梦》1002 名，
 * 而 `maxTokens = 8192` → 输出 token **恰好撞上限 8192** → 截断
 * → `review_parse_failed` → 原样返回实体。历史上从未成功过一次。
 * 它只白付 1 次调用 + 8192 输出 token（占成本 1.7%～4.6%）。
 *
 * ⚠️ 删除一个阶段是**看不见的改动**：
 * 删掉之后管线照样跑、其余测试照样绿，唯一的变化是「少了一次调用」——
 * 而「少一次调用」不会让任何断言失败。于是「把它加回来」也会是看不见的改动。
 * **这个测试就是那个看得见的地方。**
 *
 * 它钉住三件事：
 * 1. 调用点**总数** —— 防止悄悄新增/删除 LLM 阶段；
 * 2. 调用点**身份** —— stage 名必须仍是 `dictionary` / `extract`，不得重现 `review`；
 * 3. 确定性阶段**必须零 LLM** —— P2/P4/P5/P6 一旦偷偷加了模型调用，
 *    成本就变成非线性，而「成本可线性预测」是本项目的核心架构承诺。
 *
 * 设计说明：这里**读源码文本**而不是导入模块。导入会拉起 `server-only`
 * 与数据库客户端；而本测试要断言的恰恰是「源码里有没有那个调用」，
 * 文本层面才是唯一可靠的观测点。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 去掉注释后再断言 —— 与 `verify/_wb_controlflow_diff.py` 同一口径。
 *
 * ⚠️ 这一步是**必需**的，不是洁癖：文档性注释**应该**能点名被删除的符号，
 * 否则「这里曾经有什么、为什么删掉」就无从记录。护栏要抓的是
 * **代码里真的引用了它**。不区分这两者，护栏就会逼着人删掉解释性注释 ——
 * 那正好与本项目「改动必须留下理由」的要求相反。
 *
 * （这条经验来自一次真实的自伤：本文件首版直接扫原始文本，
 * 于是 `run.ts` 里解释「哪些符号已随 P3 移除」的那段注释把测试自己弄红了。）
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/\s.*$/gm, "");
}

/** 读取同目录下的源码文本（**已去注释**）。 */
function readSource(file: string): string {
  return codeOnly(readFileSync(join(here, file), "utf8"));
}

const runSource = readSource("run.ts");

/** `src/` 根（本文件在 `src/server/modules/analysis/pipeline/`，上溯 5 层）。 */
const srcRoot = join(here, "../../../..");

/**
 * 确定性阶段模块（P2 grounding / P4 投票 / P5 归并 / P6 聚合 + 辅助件）。
 *
 * 这些模块**不允许**出现任何 LLM 调用 —— 它们的存在意义就是
 * 「把模型的输出变成确定性结果」，一旦自己再调模型，这层就失去意义。
 */
const DETERMINISTIC_MODULES = [
  "aggregate.ts",
  "dictionary.ts",
  "entity-gate.ts",
  "grounding.ts",
  "merge.ts",
  "persist-graph.ts",
  "repair-json.ts",
  "slice.ts",
  "tokenizer.ts",
  "vote.ts"
] as const;

describe("LLM 调用点契约", () => {
  it("管线恰好 2 个 LLM 调用点（P0 词典 + P1 提取）", () => {
    const callSites = runSource.match(/callWithRetry\(\{/g) ?? [];
    expect(callSites).toHaveLength(2);
  });

  it("调用点身份固定为 dictionary / extract，不得再出现 review", () => {
    expect(runSource).toContain('recordCall(context, "dictionary"');
    expect(runSource).toContain('recordCall(context, "extract"');
    // P3 已删除；若这行断言失败，说明二审被加回来了 —— 那必须是一次被看见的动作
    // （且必须同时恢复提示词、schema 与分批逻辑，并绑定一次重跑）。
    expect(runSource).not.toContain('recordCall(context, "review"');
  });

  it("run.ts 不再引用已删除的 P3 构件", () => {
    // 这些符号随 P3 一并移除，若重新出现，说明删除被回滚了一半。
    expect(runSource).not.toContain("runReviewStage");
    expect(runSource).not.toContain("ReviewResultSchema");
    expect(runSource).not.toContain("buildReviewUserPrompt");
  });

  it("确定性阶段模块必须零 LLM 调用", () => {
    for (const file of DETERMINISTIC_MODULES) {
      const text = readSource(file);
      expect(text, `${file} 属确定性阶段，不得出现 callWithRetry`).not.toContain("callWithRetry");
      expect(text, `${file} 属确定性阶段，不得直接引用 AI 客户端`).not.toContain(
        "modules/ai/client"
      );
    }
  });
});

/**
 * ⚠️ **批次 32 补的盲区**。
 *
 * 上面那三组断言只扫 `run.ts` 与硬编码的 10 个 `pipeline/*.ts`。
 * 批次 32 引入了本仓库**第一个会调 LLM 的离线脚本**
 * （`scripts/curate-work-pack.ts`，N12 tier ③ 的 LLM 半边入口）——
 * 它在上面所有断言下**完全不可见**：`run.ts` 没变、`pipeline/` 没变、
 * `genre-pack/` 也不在扫描列表里。
 *
 * 「守卫扫不到」不等于「不变量成立」。所以这里把它**变成扫得到**：
 *
 * 1. `genre-pack/` 必须是**纯的** —— 生成器的两半（`discovery.ts` 确定性半边、
 *    `curation.ts` 提示词与解析）都在这一层，一旦这里出现模型调用，
 *    「生成器是离线工具」这个前提就没了；
 * 2. `src/` 不得 import `scripts/` —— 这一条才是「离线脚本不在流水线内」的**真正证明**：
 *    只要没有任何 `src/` 文件引用 `scripts/`，那些调用点就**不可达**，
 *    因此 C3 契约（流水线恰好 2 个调用点）在结构上成立，
 *    而不是「恰好没人数到」。
 */
describe("离线脚本不得进入流水线（批次 32 补的盲区）", () => {
  it("genre-pack 模块必须零 LLM 调用（生成器的两半都是纯函数）", () => {
    for (const file of ["../genre-pack/discovery.ts", "../genre-pack/curation.ts"]) {
      const text = readSource(file);
      expect(text, `${file} 属离线生成器，不得出现 callWithRetry`).not.toContain("callWithRetry");
      expect(text, `${file} 属离线生成器，不得直接引用 AI 客户端`).not.toContain(
        "modules/ai/client"
      );
    }
  });

  it("src/ 下没有任何文件 import scripts/（离线脚本不可达 → 不在流水线内）", () => {
    const offenders: string[] = [];
    // ⚠️ 必须显式给 `encoding`：不给时 TS 的重载会解析成 `string | Buffer`。
    const relativePaths: string[] = readdirSync(srcRoot, { recursive: true, encoding: "utf8" });
    for (const relativePath of relativePaths) {
      if (!/\.(?:ts|tsx)$/.test(relativePath)) {
        continue;
      }
      const text = codeOnly(readFileSync(join(srcRoot, relativePath), "utf8"));
      if (/(?:from|import)\s*\(?\s*["'][^"']*\bscripts\//.test(text)) {
        offenders.push(relativePath);
      }
    }
    expect(
      offenders,
      `src/ 不得依赖 scripts/（会花钱的离线脚本会因此进入流水线）：${offenders.join(", ")}`
    ).toEqual([]);
  });
});
