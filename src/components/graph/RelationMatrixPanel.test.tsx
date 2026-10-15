import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GraphEdge, GraphSnapshot } from "@/types/graph";

import { RelationMatrixPanel } from "./RelationMatrixPanel";

/**
 * 关系矩阵面板测试。
 *
 * ⚠️ 受控 fixture。重点断言的是「**维度取自快照内实际出现的关系码**」，
 * 这正是设计文档 §5.2 修正的核心 —— demo 的固定 7×7 是切片性质，
 * 真实页面按 degree 裁到前 N 后，切片内的码集与全库不同。
 */

function edge(
  id: string,
  source: string,
  target: string,
  typeCode: string,
  category: GraphEdge["category"]
): GraphEdge {
  return {
    id,
    source,
    target,
    typeCode,
    label         : typeCode,
    category,
    startChapter  : 1,
    endChapter    : null,
    status        : "ACTIVE",
    evidenceQuotes: [],
    evidenceCount : 0
  };
}

function snapshot(edges: GraphEdge[], codes: GraphSnapshot["codeStats"]): GraphSnapshot {
  return {
    bookId      : "book-1",
    bookTitle   : "儒林外史",
    chapterCount: 10,
    nodes       : [
      { id: "a", name: "范进", type: "PERSON", factionIndex: null, degree: 2, subDegree: 2, mentionCount: 40 },
      { id: "b", name: "周进", type: "PERSON", factionIndex: null, degree: 2, subDegree: 2, mentionCount: 30 },
      { id: "c", name: "张乡绅", type: "PERSON", factionIndex: null, degree: 1, subDegree: 1, mentionCount: 5 }
    ],
    edges,
    legend            : [],
    truncatedNodeCount: 0,
    chapters          : [],
    codeStats         : codes
  };
}

describe("RelationMatrixPanel", () => {
  it("无关系码时给出空态", () => {
    render(
      <RelationMatrixPanel snapshot={snapshot([], [])} activeCell={null} onSelectCell={vi.fn()} />
    );
    expect(screen.getByText("当前切片内没有可统计的关系码。")).toBeInTheDocument();
  });

  it("矩阵维度只取快照内实际出现的关系码（动态 N×N）", () => {
    const edges = [edge("e1", "a", "b", "朋友", 1)];
    // codeStats 只含「朋友」——即便全库还有别的码，切片内不出现就不该进维度
    render(
      <RelationMatrixPanel
        snapshot={snapshot(edges, [{ code: "朋友", label: "朋友", category: 1, count: 1 }])}
        activeCell={null}
        onSelectCell={vi.fn()}
      />
    );
    expect(screen.getByRole("columnheader", { name: "朋友" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "父子" })).not.toBeInTheDocument();
  });

  it("对角格显示该码的人物对数", () => {
    const edges = [
      edge("e1", "a", "b", "朋友", 1),
      edge("e2", "b", "c", "朋友", 1)
    ];
    render(
      <RelationMatrixPanel
        snapshot={snapshot(edges, [{ code: "朋友", label: "朋友", category: 1, count: 2 }])}
        activeCell={null}
        onSelectCell={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /朋友 与 朋友：2 组人物对/ })).toBeInTheDocument();
  });

  it("非对角格显示同时具备两码的人物对数", () => {
    const edges = [
      edge("e1", "a", "b", "朋友", 1),
      edge("e2", "a", "b", "父子", 0),
      edge("e3", "b", "c", "朋友", 1)
    ];
    render(
      <RelationMatrixPanel
        snapshot={snapshot(edges, [
          { code: "朋友", label: "朋友", category: 1, count: 2 },
          { code: "父子", label: "父子", category: 0, count: 1 }
        ])}
        activeCell={null}
        onSelectCell={vi.fn()}
      />
    );
    // ⚠️ 行列顺序 = `codeStats` 传入顺序（此处「朋友」在「父子」之前），
    // 故标签是「朋友 与 父子」而非「父子 与 朋友」—— 不假设任何语言默认序。
    // 朋友 × 父子 = 1（只有范进—周进）
    expect(
      screen.getByRole("button", { name: /朋友 与 父子：1 组人物对/ })
    ).toBeInTheDocument();
  });

  it("点击非空格子回调码对", () => {
    const onSelectCell = vi.fn();
    const edges = [edge("e1", "a", "b", "朋友", 1)];
    render(
      <RelationMatrixPanel
        snapshot={snapshot(edges, [{ code: "朋友", label: "朋友", category: 1, count: 1 }])}
        activeCell={null}
        onSelectCell={onSelectCell}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /朋友 与 朋友：1 组人物对/ }));
    expect(onSelectCell).toHaveBeenCalledWith({ codeA: "朋友", codeB: "朋友" });
  });

  it("空格子禁用且不触发回调（空态不发事件）", () => {
    const onSelectCell = vi.fn();
    const edges = [edge("e1", "a", "b", "朋友", 1)];
    render(
      <RelationMatrixPanel
        snapshot={snapshot(edges, [
          { code: "朋友", label: "朋友", category: 1, count: 1 },
          { code: "父子", label: "父子", category: 0, count: 0 }
        ])}
        activeCell={null}
        onSelectCell={onSelectCell}
      />
    );
    const emptyCell = screen.getByRole("button", { name: /朋友 与 父子：0 组人物对/ });
    expect(emptyCell).toBeDisabled();
    fireEvent.click(emptyCell);
    expect(onSelectCell).not.toHaveBeenCalled();
  });

  it("选中的格子带 data-active 标记", () => {
    const edges = [edge("e1", "a", "b", "朋友", 1)];
    render(
      <RelationMatrixPanel
        snapshot={snapshot(edges, [{ code: "朋友", label: "朋友", category: 1, count: 1 }])}
        activeCell={{ codeA: "朋友", codeB: "朋友" }}
        onSelectCell={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /朋友 与 朋友：1 组人物对/ })
    ).toHaveAttribute("data-active", "true");
  });

  it("只渲染上三角（下三角留空且不可点）", () => {
    const edges = [edge("e1", "a", "b", "朋友", 1), edge("e2", "a", "b", "父子", 0)];
    const { container } = render(
      <RelationMatrixPanel
        snapshot={snapshot(edges, [
          { code: "朋友", label: "朋友", category: 1, count: 1 },
          { code: "父子", label: "父子", category: 0, count: 1 }
        ])}
        activeCell={null}
        onSelectCell={vi.fn()}
      />
    );
    // 2×2 矩阵 → 4 格；上三角（含对角）3 个按钮，下三角 1 个占位
    expect(container.querySelectorAll(".rel-matrix-cell")).toHaveLength(3);
    expect(container.querySelectorAll(".rel-matrix-mirror")).toHaveLength(1);
  });
});
