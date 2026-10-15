import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import type { GraphSnapshot } from "@/types/graph";

import { GraphView } from "./GraphView";

/**
 * jsdom 没有 `ResizeObserver`，而 `ForceGraphCanvas` 在挂载时用它观察容器尺寸
 * （真实浏览器有）。此处的关注点是**浮层的存在与否**，不是画布尺寸，
 * 因此给一个空实现的桩即可 —— 不测画布本身（那是 jsdom 测不了的部分）。
 */
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe(): void {
        /* 空实现：本套件不关心尺寸变化 */
      }
      unobserve(): void {
        /* 空实现 */
      }
      disconnect(): void {
        /* 空实现 */
      }
    };
  }
});

/**
 * 三视图「浮层归属」契约。
 *
 * ## 为什么需要这个测试
 *
 * 「全图 / 聚焦 / 矩阵」共用同一个 `graph-stage-canvas` 容器，浮层（左上工具栏、
 * 左下图例、底部时间轴、右上视图切换条）都以绝对定位叠加其上。
 *
 * - 全图层：底子是**力导向画布**（没有表头、没有列表），浮层叠上去无妨；
 * - 聚焦层：底子是 `FocusView` —— 一块**铺满画布的内容面板**（顶部是人物名 +
 *   关系统计的表头，主体是关系卡片列表）；
 * - 矩阵层：底子是 `RelationMatrixPanel` —— 同样是内容面板。
 *
 * 因此「画布类浮层」只能在全图层出现。若它们漏到聚焦层，就会**压住表头**、
 * 盖住底部卡片 —— 用户实际遇到的现象是「表头文字被图标列截断」。
 *
 * ## 为什么用组件测试而不是只看 CSS
 *
 * 这条规则是**JSX 分支**（`mode === "full"`），不是 CSS 层叠 ——
 * 读源码文本能钉住写法，但钉不住「用户真的看不到」。这里同时做两件事：
 * ① 真渲染三视图，断言浮层的**存在 / 缺席**；
 * ② 顺带断言切换条**始终存在**（否则切不回全图 = 「进得去、出不来」）。
 */

function snapshot(): GraphSnapshot {
  return {
    bookId            : "book-1",
    bookTitle         : "儒林外史",
    chapterCount      : 57,
    truncatedNodeCount: 0,
    nodes             : [
      { id: "a", name: "范进", type: "PERSON", factionIndex: null, degree: 3, subDegree: 3, mentionCount: 40 },
      { id: "b", name: "周进", type: "PERSON", factionIndex: null, degree: 2, subDegree: 2, mentionCount: 30 },
      { id: "c", name: "胡屠户", type: "PERSON", factionIndex: null, degree: 1, subDegree: 1, mentionCount: 8 }
    ],
    edges: [
      {
        id            : "e1",
        source        : "a",
        target        : "b",
        typeCode      : "师生",
        label         : "师生",
        category      : 3,
        startChapter  : 3,
        endChapter    : null,
        status        : "ACTIVE",
        evidenceQuotes: ["范进拜周进为师"],
        evidenceCount : 1
      },
      {
        id            : "e2",
        source        : "a",
        target        : "c",
        typeCode      : "父子",
        label         : "父子",
        category      : 0,
        startChapter  : 2,
        endChapter    : null,
        status        : "ACTIVE",
        evidenceQuotes: ["胡屠户是范进的岳父"],
        evidenceCount : 1
      }
    ],
    legend: [
      { category: 0, label: "亲属", count: 1 },
      { category: 1, label: "友好", count: 0 },
      { category: 2, label: "对立", count: 0 },
      { category: 3, label: "从属", count: 1 },
      { category: 4, label: "其他", count: 0 }
    ],
    codeStats: [
      { code: "师生", label: "师生", category: 3, count: 1 },
      { code: "父子", label: "父子", category: 0, count: 1 }
    ],
    chapters: [{ ordinal: 1, title: "第一回" }]
  };
}

/** 切到某个视图（默认是全图）。 */
function switchTo(mode: "全图" | "聚焦" | "矩阵") {
  fireEvent.click(screen.getByRole("tab", { name: mode }));
}

describe("GraphView 三视图浮层归属", () => {
  it("全图：画布类浮层都在（工具栏 / 图例 / 时间轴 / 切换条）", () => {
    render(<GraphView bookId="book-1" snapshot={snapshot()} />);

    expect(screen.getByRole("tablist", { name: "视图切换" })).toBeInTheDocument();
    // 工具栏：以「筛选」按钮为代表。
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
    // 图例：以「关系类型」标题为代表。
    expect(screen.getByLabelText("关系分组图例")).toBeInTheDocument();
    // 时间轴：以角色组为代表（`ChapterTimeline` 的容器带 aria-label）。
    expect(screen.getByRole("group", { name: "章节时间轴" })).toBeInTheDocument();
  });

  it("聚焦：画布类浮层全部退出，切换条保留（否则「进得去、出不来」）", () => {
    render(<GraphView bookId="book-1" snapshot={snapshot()} />);
    switchTo("聚焦");

    // 🔑 核心断言：工具栏不得出现在聚焦层 —— 它会压住 FocusView 的表头。
    expect(screen.queryByRole("button", { name: "筛选" })).not.toBeInTheDocument();
    // 图例解释的是画布上边的颜色，聚焦层是卡片列表 → 同样退出。
    expect(screen.queryByLabelText("关系分组图例")).not.toBeInTheDocument();
    // 时间轴横跨底边、会压住关系卡片 → 同样退出。
    expect(screen.queryByRole("group", { name: "章节时间轴" })).not.toBeInTheDocument();

    // 但切换条必须留着，否则无法切回全图/矩阵。
    expect(screen.getByRole("tablist", { name: "视图切换" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "全图" })).toBeInTheDocument();
  });

  it("矩阵：画布类浮层同样退出，切换条保留", () => {
    render(<GraphView bookId="book-1" snapshot={snapshot()} />);
    switchTo("矩阵");

    expect(screen.queryByRole("button", { name: "筛选" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("关系分组图例")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "章节时间轴" })).not.toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "视图切换" })).toBeInTheDocument();
  });

  it("从聚焦切回全图后，画布类浮层恢复（不是一次性渲染）", () => {
    render(<GraphView bookId="book-1" snapshot={snapshot()} />);
    switchTo("聚焦");
    expect(screen.queryByRole("button", { name: "筛选" })).not.toBeInTheDocument();

    switchTo("全图");
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
    expect(screen.getByLabelText("关系分组图例")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "章节时间轴" })).toBeInTheDocument();
  });
});
