import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 三期判定层的**接线契约**（与 `uncertainty-wiring.test.ts` 同源教训）。
 *
 * 钉住三件在纯函数测试里看不见的事：
 * 1. 页面/视图真的把外部知识传到了详情卡（否则「接了但没人用」）；
 * 2. **UI 分区**：外部资料必须有自己的分区标题，不能与「本书信息」混排；
 * 3. **铁律**：判定层不碰图谱表、不进评测口径（评测脚本不得引用 knowledge 模块）。
 */

const ROOT = process.cwd();

function codeOnlyOf(relativePath: string): string {
  const source = readFileSync(path.resolve(ROOT, relativePath), "utf8");
  // ⚠️ 必须剥注释再断言（把解释当违规是最常见的尺子错）。
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

const page = codeOnlyOf("src/app/(graph)/book/[bookId]/page.tsx");
const view = codeOnlyOf("src/components/graph/GraphView.tsx");
const panel = codeOnlyOf("src/components/graph/GraphDetailPanel.tsx");
const section = codeOnlyOf("src/components/graph/ExternalKnowledgeSection.tsx");
const repository = codeOnlyOf("src/server/modules/knowledge/repository.ts");
const agent = codeOnlyOf("scripts/knowledge-agent.ts");

describe("三期接线：页面 → 视图 → 详情卡", () => {
  it("页面创建外部知识 Promise 并传给 GraphView", () => {
    expect(page).toContain("loadExternalKnowledgeForBook(bookId)");
    expect(page).toContain("externalKnowledge={externalKnowledge}");
  });

  it("视图把选中实体的外部资料传给详情卡", () => {
    expect(view).toContain("selectedNodeExternal");
    expect(view).toContain("external={selectedNodeExternal}");
  });

  it("详情卡渲染「外部资料」独立分区（UI 分区铁律）", () => {
    expect(panel).toContain("ExternalKnowledgeSection");
    expect(section).toContain("外部资料 · 全书视角");
    expect(section).toContain("sourceUrls");
  });

  it("档案页也渲染同一份分区（简介最该出现的地方）", () => {
    const profile = codeOnlyOf("src/app/(viewer)/book/[bookId]/entity/[entityId]/page.tsx");
    expect(profile).toContain("ExternalKnowledgeSection");
    expect(profile).toContain("loadExternalKnowledgeForBook");
    // 按规范名索引（判定层的 subjectKey = 规范名）
    expect(profile).toContain("knowledgeBySubject[data.profile.name]");
    // 空资料也展示分区（用户至少知道「为什么没有简介」）
    expect(profile).toContain("showWhenEmpty");
  });

  it("两个消费方共用同一份渲染实现（防「一处改一处漏」）", () => {
    // 分区标题只允许出现在共享组件里，不得在调用点重复写死。
    expect(panel).not.toContain("外部资料 · 全书视角");
    expect(section).toContain("外部资料 · 全书视角");
  });
});

describe("三期铁律：不写图谱表 · 不进评测口径", () => {
  it("仓库层只碰 external_knowledge，不引用图谱表", () => {
    expect(repository).toContain("server-only");
    expect(repository).toContain("externalKnowledge");
    for (const forbidden of ["persistGraph", "entities)", "relationships)", "entityAliases"]) {
      expect(repository).not.toContain(forbidden);
    }
  });

  it("Agent 不调用解析管线（独立、离线、可回退）", () => {
    for (const forbidden of ["runPipeline", "persistGraph", "pipeline/run"]) {
      expect(agent).not.toContain(forbidden);
    }
  });

  it("评测脚本不引用判定层（外部知识永不进评测口径）", () => {
    const evalDir = path.resolve(ROOT, "scripts/eval");
    const files = readdirSync(evalDir).filter((file) => file.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = codeOnlyOf(path.join("scripts/eval", file));
      expect(source).not.toContain("knowledge/repository");
      expect(source).not.toContain("external_knowledge");
    }
  });
});
