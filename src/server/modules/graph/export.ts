/**
 * 图谱导出（纯函数，零依赖）。
 *
 * ## 为什么导出 CSV 而不是只给 JSON
 *
 * JSON 适合程序读，但用户真正会做的是「丢进 Excel 看一眼」或「发给同事」。
 * CSV 直接双击就能开，JSON 得先找工具。
 *
 * ## 为什么带 BOM
 *
 * Excel 读不带 BOM 的 UTF-8 CSV 会把中文显示成乱码（GBK 解释）。
 * `\uFEFF` 是让 Excel 正确识别 UTF-8 的唯一可靠办法。
 */

import type { GraphSnapshot } from "@/types/graph";

/** 实体类型的中文名。 */
const TYPE_LABELS: Record<string, string> = {
  PERSON      : "人物",
  LOCATION    : "地点",
  ORGANIZATION: "组织",
  CONCEPT     : "概念"
};

/**
 * CSV 字段转义。
 *
 * 规则（RFC 4180）：含逗号、双引号、换行的字段用双引号包裹，内部的双引号翻倍。
 * 不做这一步的话，一句带逗号的原文引用会把整行列错位。
 */
export function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/u.test(text)) {
    return `"${text.replace(/"/gu, '""')}"`;
  }
  return text;
}

/** 一行 CSV。 */
function row(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(escapeCsv).join(",");
}

/** 导出所需的最小输入（别名需要外部提供，快照里没有）。 */
export interface ExportInput {
  snapshot: GraphSnapshot;
  /** 实体 id → 别名列表。 */
  aliasesByEntity: ReadonlyMap<string, readonly string[]>;
}

/**
 * 实体表。
 *
 * 列：名称、类型、别名、提及段落数、关系数（全库）、关系数（当前视图）
 */
export function toEntitiesCsv(input: ExportInput): string {
  const lines = [row(["名称", "类型", "别名", "提及段落数", "关系数", "当前视图关系数"])];
  for (const node of input.snapshot.nodes) {
    const aliases = input.aliasesByEntity.get(node.id) ?? [];
    lines.push(
      row([
        node.name,
        TYPE_LABELS[node.type] ?? node.type,
        aliases.join(" / "),
        node.mentionCount,
        node.degree,
        node.subDegree
      ])
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/**
 * 关系表。
 *
 * 列：源、关系、目标、起始回、终止回、状态、证据条数、证据引用
 *
 * ⚠️ 源/目标写**实体名**而不是 uuid：导出的第一用途是给人看，
 * uuid 在 Excel 里毫无意义。同名实体极少（P5 归并后），可接受。
 */
export function toRelationshipsCsv(input: ExportInput): string {
  const nameById = new Map(input.snapshot.nodes.map((node) => [node.id, node.name]));
  const lines = [row(["源实体", "关系", "目标实体", "起始回", "终止回", "状态", "证据条数", "证据引用"])];
  for (const edge of input.snapshot.edges) {
    lines.push(
      row([
        nameById.get(edge.source) ?? edge.source,
        edge.label || edge.typeCode,
        nameById.get(edge.target) ?? edge.target,
        edge.startChapter,
        edge.endChapter ?? "",
        edge.status === "ACTIVE" ? "持续" : "已结束",
        edge.evidenceQuotes.length,
        // 只取前两条：全部引用可能上千字，塞进一个单元格既难读也超出 Excel 限制。
        edge.evidenceQuotes.slice(0, 2).join(" ⏎ ")
      ])
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** 完整 JSON（程序读）。 */
export function toGraphJson(input: ExportInput): string {
  const nameById = new Map(input.snapshot.nodes.map((node) => [node.id, node.name]));
  return JSON.stringify(
    {
      bookId            : input.snapshot.bookId,
      bookTitle         : input.snapshot.bookTitle,
      chapterCount      : input.snapshot.chapterCount,
      exportedAt        : new Date().toISOString(),
      entities: input.snapshot.nodes.map((node) => ({
        name        : node.name,
        type        : node.type,
        aliases     : input.aliasesByEntity.get(node.id) ?? [],
        mentionCount: node.mentionCount,
        degree      : node.degree
      })),
      relationships: input.snapshot.edges.map((edge) => ({
        source       : nameById.get(edge.source) ?? edge.source,
        target       : nameById.get(edge.target) ?? edge.target,
        typeCode     : edge.typeCode,
        label        : edge.label,
        startChapter : edge.startChapter,
        endChapter   : edge.endChapter,
        status       : edge.status,
        evidenceQuotes: edge.evidenceQuotes
      }))
    },
    null,
    2
  );
}
