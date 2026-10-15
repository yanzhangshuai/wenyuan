import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GraphEdge, GraphSnapshot } from "@/types/graph";

import { MatrixDetailCard } from "./MatrixDetailCard";

/**
 * 矩阵详情卡测试。
 *
 * ⚠️ 用**受控 fixture**（两家三节点、四条边），不依赖生产库，
 * 也不复用 demo 的 46 节点切片 —— 那份切片的数字是切片性质而非逻辑常量。
 */

const BOOK_ID = "book-1";

/** 构造一条边。 */
function edge(
  id: string,
  source: string,
  target: string,
  typeCode: string,
  category: GraphEdge["category"],
  overrides: Partial<GraphEdge> = {}
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
    evidenceCount : 0,
    ...overrides
  };
}

/** 构造快照（只填详情卡用到的字段）。 */
function snapshot(edges: GraphEdge[]): GraphSnapshot {
  return {
    bookId      : BOOK_ID,
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
    chapters          : [
      { ordinal: 3, title: "周学道校士拔真才" },
      { ordinal: 4, title: "荐亡斋和尚吃官司" }
    ],
    codeStats: [
      { code: "父子", label: "父子", category: 0, count: 1 },
      { code: "朋友", label: "朋友", category: 1, count: 2 }
    ]
  };
}

describe("MatrixDetailCard", () => {
  it("未选中格子时不渲染任何内容", () => {
    const { container } = render(
      <MatrixDetailCard snapshot={snapshot([])} cell={null} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("非对角：只列出同时具备两种关系的人物对", () => {
    const edges = [
      edge("e1", "a", "b", "朋友", 1, { startChapter: 3 }),
      edge("e2", "a", "b", "父子", 0, { startChapter: 4 }),
      // 只有「朋友」——不该被非对角格选中
      edge("e3", "b", "c", "朋友", 1, { startChapter: 3 })
    ];
    render(
      <MatrixDetailCard
        snapshot={snapshot(edges)}
        cell={{ codeA: "父子", codeB: "朋友" }}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "父子 × 朋友" })).toBeInTheDocument();
    expect(screen.getByText(/同时具备这两种关系/)).toBeInTheDocument();
    // 范进—周进 一对；张乡绅不出现
    expect(screen.getByText(/范进 — 周进/)).toBeInTheDocument();
    expect(screen.queryByText(/张乡绅/)).not.toBeInTheDocument();
  });

  it("对角：列出该码涉及的全部人物对", () => {
    const edges = [
      edge("e1", "a", "b", "朋友", 1, { startChapter: 3 }),
      edge("e3", "b", "c", "朋友", 1, { startChapter: 3 })
    ];
    render(
      <MatrixDetailCard
        snapshot={snapshot(edges)}
        cell={{ codeA: "朋友", codeB: "朋友" }}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "朋友" })).toBeInTheDocument();
    expect(screen.getByText(/共 2 组人物对具备该关系/)).toBeInTheDocument();
    expect(screen.getByText(/范进 — 周进/)).toBeInTheDocument();
    expect(screen.getByText(/周进 — 张乡绅/)).toBeInTheDocument();
  });

  it("每条边渲染章节名与状态", () => {
    const edges = [edge("e1", "a", "b", "朋友", 1, { startChapter: 3, endChapter: 3 })];
    render(
      <MatrixDetailCard
        snapshot={snapshot(edges)}
        cell={{ codeA: "朋友", codeB: "朋友" }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("第 3 回 周学道校士拔真才")).toBeInTheDocument();
    expect(screen.getByText("持续")).toBeInTheDocument();
  });

  it("已终止的边标注「已终止」", () => {
    const edges = [
      edge("e1", "a", "b", "朋友", 1, { startChapter: 3, endChapter: 9, status: "ENDED" })
    ];
    render(
      <MatrixDetailCard
        snapshot={snapshot(edges)}
        cell={{ codeA: "朋友", codeB: "朋友" }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("已终止")).toBeInTheDocument();
  });

  it("渲染全部多条原文引用", () => {
    const edges = [
      edge("e1", "a", "b", "朋友", 1, {
        evidenceQuotes: ["第一段依据。", "第二段依据。"],
        evidenceCount : 2
      })
    ];
    render(
      <MatrixDetailCard
        snapshot={snapshot(edges)}
        cell={{ codeA: "朋友", codeB: "朋友" }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("第一段依据。")).toBeInTheDocument();
    expect(screen.getByText("第二段依据。")).toBeInTheDocument();
  });

  it("无原文的边给出明确空态", () => {
    const edges = [edge("e1", "a", "b", "朋友", 1, { evidenceQuotes: [], evidenceCount: 0 })];
    render(
      <MatrixDetailCard
        snapshot={snapshot(edges)}
        cell={{ codeA: "朋友", codeB: "朋友" }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("无原文片段（证据计数 0）")).toBeInTheDocument();
  });

  it("对角格超过 20 组时折叠并可展开", () => {
    // 构造 25 对人物（a 与 b 各连不同节点）
    const edges: GraphEdge[] = [];
    for (let index = 0; index < 25; index += 1) {
      edges.push(edge(`e${String(index)}`, "hub", `n${String(index)}`, "朋友", 1));
    }
    const custom: GraphSnapshot = {
      ...snapshot(edges),
      nodes: [
        { id: "hub", name: "中心", type: "PERSON", factionIndex: null, degree: 25, subDegree: 25, mentionCount: 100 },
        ...Array.from({ length: 25 }, (_, index) => ({
          id          : `n${String(index)}`,
          name        : `邻居${String(index)}`,
          type        : "PERSON" as const,
          factionIndex: null,
          degree      : 1,
          subDegree   : 1,
          mentionCount: 1
        }))
      ]
    };

    render(
      <MatrixDetailCard
        snapshot={custom}
        cell={{ codeA: "朋友", codeB: "朋友" }}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/共 25 组人物对/)).toBeInTheDocument();
    const more = screen.getByRole("button", { name: /展开其余 5 组/ });
    fireEvent.click(more);
    expect(screen.queryByRole("button", { name: /展开其余/ })).not.toBeInTheDocument();
    expect(screen.getByText(/邻居24/)).toBeInTheDocument();
  });

  it("点击关闭按钮触发 onClose", () => {
    const onClose = vi.fn();
    const edges = [edge("e1", "a", "b", "朋友", 1)];
    render(
      <MatrixDetailCard
        snapshot={snapshot(edges)}
        cell={{ codeA: "朋友", codeB: "朋友" }}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭矩阵详情" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("无命中时给出空态提示", () => {
    render(
      <MatrixDetailCard
        snapshot={snapshot([edge("e1", "a", "b", "朋友", 1)])}
        cell={{ codeA: "父子", codeB: "朋友" }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("该组合下没有命中的人物对。")).toBeInTheDocument();
  });
});
