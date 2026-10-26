// @vitest-environment node
import { describe, expect, it } from "vitest";

import { escapeCsv, toEntitiesCsv, toGraphJson, toRelationshipsCsv } from "./export";
import type { GraphSnapshot } from "@/types/graph";

/**
 * 导出的纯函数测试。
 *
 * 重点在 `escapeCsv`：一句带逗号的原文引用如果没被正确包裹，
 * 整行会错位，而 Excel 不会报错 —— 用户看到的是一张错乱的表。
 */

const snapshot = {
  bookId            : "b1",
  bookTitle         : "测试书",
  chapterCount      : 10,
  truncatedNodeCount: 0,
  legend            : [],
  chapters          : [],
  nodes: [
    { id: "e1", name: "贾政", type: "PERSON", factionIndex: null, degree: 5, subDegree: 3, mentionCount: 12 },
    { id: "e2", name: "宝玉", type: "PERSON", factionIndex: null, degree: 8, subDegree: 4, mentionCount: 30 }
  ],
  edges: [
    {
      id           : "r1",
      source       : "e1",
      target       : "e2",
      typeCode     : "父子",
      label        : "父子",
      category     : 0,
      startChapter : 2,
      endChapter   : null,
      status       : "ACTIVE",
      evidenceQuotes: ["贾政道：“宝玉，你过来。”", "第二句", "第三句"],
      evidenceCount: 3
    }
  ]
} as unknown as GraphSnapshot;

const aliases = new Map([["e1", ["政老爷", "存周"]]]);

describe("escapeCsv", () => {
  it("普通值原样返回", () => {
    expect(escapeCsv("贾政")).toBe("贾政");
    expect(escapeCsv(12)).toBe("12");
  });

  it("含逗号的值被双引号包裹", () => {
    expect(escapeCsv("甲,乙")).toBe('"甲,乙"');
  });

  it("含双引号的值：包裹 + 内部双引号翻倍（RFC 4180）", () => {
    expect(escapeCsv('他说"好"')).toBe('"他说""好"""');
  });

  it("含换行的值被包裹（否则整行会断开）", () => {
    expect(escapeCsv("第一行\n第二行")).toBe('"第一行\n第二行"');
  });

  it("null / undefined 输出空串", () => {
    expect(escapeCsv(null)).toBe("");
    expect(escapeCsv(undefined)).toBe("");
  });
});

describe("toEntitiesCsv", () => {
  const csv = toEntitiesCsv({ snapshot, aliasesByEntity: aliases });

  it("带 UTF-8 BOM（否则 Excel 中文乱码）", () => {
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("表头 + 每个实体一行", () => {
    const lines = csv.replace("\uFEFF", "").trim().split("\r\n");
    expect(lines).toHaveLength(3); // 表头 + 2 实体
    expect(lines[0]).toContain("名称");
  });

  it("别名用 / 连接，没有别名时为空", () => {
    expect(csv).toContain("政老爷 / 存周");
    const lines = csv.replace("\uFEFF", "").trim().split("\r\n");
    expect(lines[2]?.split(",")[2]).toBe(""); // 宝玉无别名
  });
});

describe("toRelationshipsCsv", () => {
  const csv = toRelationshipsCsv({ snapshot, aliasesByEntity: aliases });

  it("源/目标写实体名而不是 uuid（导出的第一用途是给人看）", () => {
    expect(csv).toContain("贾政,父子,宝玉");
  });

  it("endChapter 为 null 时留空", () => {
    const line = csv.replace("\uFEFF", "").trim().split("\r\n")[1];
    expect(line?.split(",")[4]).toBe("");
  });

  it("证据只取前两条（全部引用可能上千字，塞进单元格既难读也超 Excel 限制）", () => {
    expect(csv).toContain("贾政道");
    expect(csv).not.toContain("第三句");
  });
});

describe("toGraphJson", () => {
  const json = JSON.parse(toGraphJson({ snapshot, aliasesByEntity: aliases })) as {
    entities     : { name: string; aliases: string[] }[];
    relationships: { source: string; target: string; evidenceQuotes: string[] }[];
  };

  it("实体带别名，关系两端是实体名", () => {
    expect(json.entities[0]?.aliases).toEqual(["政老爷", "存周"]);
    expect(json.relationships[0]?.source).toBe("贾政");
  });

  it("JSON 里保留**全部**证据（与 CSV 只取两条不同）", () => {
    expect(json.relationships[0]?.evidenceQuotes).toHaveLength(3);
  });
});
