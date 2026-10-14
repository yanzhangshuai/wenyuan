import { describe, expect, it } from "vitest";

import { repairTruncatedJson, stripCodeFence } from "./repair-json";

describe("stripCodeFence", () => {
  it("去掉成对围栏", () => {
    expect(stripCodeFence("```json\n{\"a\":1}\n```")).toBe("{\"a\":1}");
  });

  it("去掉被截断的起始围栏", () => {
    expect(stripCodeFence("```json\n{\"a\":1")).toBe("{\"a\":1");
  });
});

describe("repairTruncatedJson", () => {
  it("完整 JSON 原样返回且标记未修复", () => {
    const result = repairTruncatedJson("{\"entities\":[{\"canonical\":\"范进\"}]}");
    expect(result.repaired).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ entities: [{ canonical: "范进" }] });
  });

  it("裁掉顶层容器之后的多余内容", () => {
    const result = repairTruncatedJson("{\"a\":1}\n以上是结果");
    expect(result.repaired).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ a: 1 });
  });

  it("截断在字符串中途时回退到最后一个完整元素", () => {
    const raw = "{\"entities\":[{\"canonical\":\"范进\",\"type\":\"PERSON\"},{\"canonical\":\"周";
    const result = repairTruncatedJson(raw);
    expect(result.repaired).toBe(true);
    expect(JSON.parse(result.text)).toEqual({
      entities: [{ canonical: "范进", type: "PERSON" }, {}]
    });
  });

  it("截断在完整标量之后时保留该标量", () => {
    const result = repairTruncatedJson("[1,2,3");
    expect(result.repaired).toBe(true);
    expect(JSON.parse(result.text)).toEqual([1, 2, 3]);
  });

  it("字符串内的括号不干扰结构计数", () => {
    const result = repairTruncatedJson("{\"quote\":\"他说「（你）好」\",\"x\":1");
    expect(result.repaired).toBe(true);
    expect(JSON.parse(result.text)).toEqual({ quote: "他说「（你）好」", x: 1 });
  });

  it("截断在键名中途时不产生非法 JSON", () => {
    const result = repairTruncatedJson("{\"a\":1,\"b\":2,\"c");
    expect(result.repaired).toBe(true);
    expect(JSON.parse(result.text)).toEqual({ a: 1, b: 2 });
  });

  it("找不到容器起始时原样返回", () => {
    const result = repairTruncatedJson("完全不是 JSON");
    expect(result.repaired).toBe(false);
    expect(result.text).toBe("完全不是 JSON");
  });
});
