import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GraphEdge, GraphNode } from "@/types/graph";

import { GraphDetailPanel } from "./GraphDetailPanel";

/**
 * 详情面板测试。
 *
 * 只覆盖纯展示与回调行为 —— 画布本身依赖 `canvas`，在 jsdom 下无法真实渲染，
 * 对其做断言只会得到「假绿」，不如不测。
 */

const NODE: GraphNode = {
  id          : "node-a",
  name        : "范进",
  type        : "PERSON",
  factionIndex: null,
  degree      : 2,
  subDegree   : 2,
  mentionCount: 40
};

/** 构造一条关系。 */
function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id            : "edge-1",
    source        : "node-a",
    target        : "node-b",
    typeCode      : "师生",
    label         : "师生",
    category      : 3,
    startChapter  : 3,
    endChapter    : null,
    status        : "ACTIVE",
    evidenceQuotes: [],
    evidenceCount : 0,
    ...overrides
  };
}

describe("GraphDetailPanel", () => {
  it("未选中实体时展示引导文案", () => {
    render(
      <GraphDetailPanel
        node={null}
        relations={[]}
        counterpartNames={new Map()}
        onSelectNode={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/点击任一节点/)).toBeInTheDocument();
  });

  it("展示实体名、类型与统计", () => {
    render(
      <GraphDetailPanel
        node={NODE}
        relations={[makeEdge()]}
        counterpartNames={new Map([["edge-1", "周进"]])}
        onSelectNode={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("heading", { name: "范进" })).toBeInTheDocument();
    expect(screen.getByText(/人物 · 关联 1 人 · 出现 40 段/)).toBeInTheDocument();
  });

  it("渲染关系分组标签与关系码", () => {
    render(
      <GraphDetailPanel
        node={NODE}
        relations={[makeEdge()]}
        counterpartNames={new Map([["edge-1", "周进"]])}
        onSelectNode={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("从属")).toBeInTheDocument();
    expect(screen.getByText("师生")).toBeInTheDocument();
  });

  it("未结束的关系展示为「第 N 章起」", () => {
    render(
      <GraphDetailPanel
        node={NODE}
        relations={[makeEdge({ startChapter: 3, endChapter: null })]}
        counterpartNames={new Map([["edge-1", "周进"]])}
        onSelectNode={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("第 3 章起")).toBeInTheDocument();
  });

  it("已结束的关系展示章节区间", () => {
    render(
      <GraphDetailPanel
        node={NODE}
        relations={[makeEdge({ startChapter: 3, endChapter: 9, status: "ENDED" })]}
        counterpartNames={new Map([["edge-1", "周进"]])}
        onSelectNode={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("第 3–9 章")).toBeInTheDocument();
  });

  it("有证据引用时渲染原文", () => {
    render(
      <GraphDetailPanel
        node={NODE}
        relations={[
          makeEdge({
            evidenceQuotes: ["周学道坐在堂上，见范进进来。"],
            evidenceCount : 1
          })
        ]}
        counterpartNames={new Map([["edge-1", "周进"]])}
        onSelectNode={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("周学道坐在堂上，见范进进来。")).toBeInTheDocument();
  });

  it("多条证据引用时全部渲染", () => {
    render(
      <GraphDetailPanel
        node={NODE}
        relations={[
          makeEdge({
            evidenceQuotes: ["第一段依据。", "第二段依据。", "第三段依据。"],
            evidenceCount : 3
          })
        ]}
        counterpartNames={new Map([["edge-1", "周进"]])}
        onSelectNode={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("第一段依据。")).toBeInTheDocument();
    expect(screen.getByText("第二段依据。")).toBeInTheDocument();
    expect(screen.getByText("第三段依据。")).toBeInTheDocument();
  });

  it("无证据时不渲染引用块", () => {
    const { container } = render(
      <GraphDetailPanel
        node={NODE}
        relations={[makeEdge({ evidenceQuotes: [], evidenceCount: 0 })]}
        counterpartNames={new Map([["edge-1", "周进"]])}
        onSelectNode={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.querySelectorAll(".graph-detail-quote")).toHaveLength(0);
  });

  it("点击对端实体名回调对端 ID", () => {
    const onSelectNode = vi.fn();
    render(
      <GraphDetailPanel
        node={NODE}
        relations={[makeEdge()]}
        counterpartNames={new Map([["edge-1", "周进"]])}
        onSelectNode={onSelectNode}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "周进" }));
    expect(onSelectNode).toHaveBeenCalledWith("node-b");
  });

  it("点击关闭按钮触发 onClose", () => {
    const onClose = vi.fn();
    render(
      <GraphDetailPanel
        node={NODE}
        relations={[]}
        counterpartNames={new Map()}
        onSelectNode={vi.fn()}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("无关系时给出明确提示", () => {
    render(
      <GraphDetailPanel
        node={NODE}
        relations={[]}
        counterpartNames={new Map()}
        onSelectNode={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("该实体暂无已解析出的关系。")).toBeInTheDocument();
  });
});
