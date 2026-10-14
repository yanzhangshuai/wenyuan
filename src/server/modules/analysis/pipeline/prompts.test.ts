import { describe, expect, it } from "vitest";

import { RELATION_TYPES } from "@/lib/relations";

import {
  DICTIONARY_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  MAX_ROLLING_NAMES,
  MAX_ROLLING_SUMMARY_CHARS,
  PROMPT_VERSION,
  buildDictionaryUserPrompt,
  buildExtractionUserPrompt,
  renderRollingContext
} from "./prompts";

/** 构造候选名。 */
function candidate(surface: string, frequency: number) {
  return { surface, normalized: surface, frequency, firstChapter: 1 };
}

describe("提示词常量", () => {
  it("系统提示词不含任何分片相关内容，保证前缀缓存可命中", () => {
    // 这是省 token 的核心约束：系统提示一旦拼接了分片变量，缓存就会全部失效。
    expect(EXTRACTION_SYSTEM_PROMPT).not.toContain("待抽取文本");
    expect(DICTIONARY_SYSTEM_PROMPT).not.toContain("待判定词表");
  });

  it("提取提示词由代码生成关系码清单，与 RELATION_TYPES 保持一致", () => {
    for (const relation of RELATION_TYPES) {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain(relation.code);
    }
  });

  it("提取提示词明确标注关系方向语义", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("无向");
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("有向");
  });

  it("版本号非空，便于运行记录追溯", () => {
    expect(PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("系统提示词体积保持在千字量级（对比 v1 每片 35K token）", () => {
    expect(EXTRACTION_SYSTEM_PROMPT.length).toBeLessThan(2000);
  });
});

describe("buildExtractionUserPrompt", () => {
  it("无候选词典时只输出正文", () => {
    const text = buildExtractionUserPrompt("范进中举。");
    expect(text).toBe("## 待抽取文本\n范进中举。");
  });

  it("有候选词典时携带频次，供模型复用写法", () => {
    const text = buildExtractionUserPrompt("范进中举。", [candidate("范进", 12), candidate("周进", 5)]);
    expect(text).toContain("范进(12)");
    expect(text).toContain("周进(5)");
    expect(text).toContain("## 待抽取文本\n范进中举。");
  });

  it("候选词典不替代正文，正文始终完整保留", () => {
    const body = "甲".repeat(100);
    const text = buildExtractionUserPrompt(body, [candidate("范进", 3)]);
    expect(text).toContain(body);
  });

  it("携带滚动上下文：上片出场名进入 user 消息", () => {
    const text = buildExtractionUserPrompt("周进看他。", [candidate("周进", 5)], {
      priorNames: ["范进", "周进"],
      summary   : "范进"
    });

    expect(text).toContain("前文已出场的人名");
    expect(text).toContain("范进");
    // 正文必须在场，且上下文位于正文之前（稳定前缀利于 prompt cache）。
    expect(text).toContain("## 待抽取文本\n周进看他。");
    expect(text.indexOf("前文已出场的人名")).toBeLessThan(text.indexOf("## 待抽取文本"));
  });

  it("无上下文时行为与旧版一致，不产生多余段落", () => {
    const text = buildExtractionUserPrompt("范进中举。", [candidate("范进", 12)]);
    expect(text).not.toContain("前文上下文");
  });

  it("滚动上下文中的摘要被截断到上限", () => {
    const text = buildExtractionUserPrompt("正文", [], {
      priorNames: [],
      summary   : "甲".repeat(1000)
    });

    const summaryLine = text.split("\n").find((line) => line.startsWith("前情摘要：")) ?? "";
    expect(summaryLine.length).toBeLessThanOrEqual(MAX_ROLLING_SUMMARY_CHARS + "前情摘要：".length);
  });

  it("滚动上下文中的名字数量被压缩到上限", () => {
    const names = Array.from({ length: 200 }, (_, index) => `名${String(index)}`);
    const text = renderRollingContext({ priorNames: names, summary: "" });

    // 只保留前 MAX_ROLLING_NAMES 条。
    const namesLine = text.split("\n").find((line) => line.startsWith("前文已出场的人名：")) ?? "";
    expect(namesLine.split("、").length).toBeLessThanOrEqual(MAX_ROLLING_NAMES);
  });

  it("滚动上下文去重且忽略空白名", () => {
    const text = renderRollingContext({ priorNames: ["范进", "范进", "  ", "周进"], summary: "" });

    expect(text).toContain("范进、周进");
    expect(text).not.toContain("、、");
  });

  it("空上下文渲染为空串，不污染提示词", () => {
    expect(renderRollingContext(undefined)).toBe("");
    expect(renderRollingContext({ priorNames: [], summary: "   " })).toBe("");
  });
});

describe("buildDictionaryUserPrompt", () => {
  it("每行一个候选名", () => {
    const text = buildDictionaryUserPrompt([candidate("范进", 3), candidate("周进", 2)]);
    expect(text).toBe("## 待判定词表\n范进\n周进");
  });
});

// 原 `buildReviewUserPrompt`（P3 二审）的用例已随 P3 删除（2026-10-10）。
// 它原先断言的是「只传名字清单、不传原文」——这条数据路径隔离的设计是对的，
// 但实现要求逐实体输出判定，体量 O(名字数)，在 maxTokens=8192 下必然截断，
// 历史上从未成功过一次。删除理由见 `run.ts` 文件头「为什么没有 P3」。
//
// ⚠️ 删除一个阶段必须留下**替代护栏**，否则它会被悄悄加回来：
// 见 `llm-callpoints.test.ts`（钉住「管线只有 2 个 LLM 调用点」）。
