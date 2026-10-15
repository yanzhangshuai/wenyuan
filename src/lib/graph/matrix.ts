import type { GraphCodeStat, GraphEdge, GraphNode } from "@/types/graph";

/**
 * 关系矩阵与「人物对」派生逻辑（纯函数）。
 *
 * 设计原因：矩阵、详情卡、关系特异判定都是**同一份边集**的不同投影，
 * 抽成不依赖 React / DOM 的纯函数后，可以在 Node 侧用 fixture 直接断言，
 * 而不必渲染 Canvas（jsdom 下 Canvas 无法真实渲染，断言只会得到「假绿」）。
 *
 * 边界：本文件不查库、不碰 DOM、不读主题 —— 只做集合与计数运算。
 */

/** 一对人物（无向）。索引按 UUID 字典序归一化，使 A↔B 与 B↔A 归为同一对。 */
export interface PersonPair {
  /** 归一化后的较小 UUID。 */
  low  : string;
  /** 归一化后的较大 UUID。 */
  high : string;
  /** 该对人物之间的全部边（可能跨多种关系码）。 */
  edges: GraphEdge[];
}

/** 矩阵单元格（一行一列的交点）。 */
export interface MatrixCell {
  rowCode: string;
  colCode: string;
  /**
   * 命中的人物对数。
   * - 对角（rowCode === colCode）＝具备该关系码的人物对数；
   * - 非对角＝同时具备两种关系码的人物对数。
   */
  count  : number;
}

/** 矩阵整体。 */
export interface RelationMatrix {
  /** 行列共用的关系码顺序（与 `codeStats` 一致，按出现次数降序）。 */
  codes: string[];
  /** 扁平单元格数组，便于按 `rowCode/colCode` 查找。 */
  cells: MatrixCell[];
}

/**
 * 归一化一对人物 ID（无向）。
 *
 * @param a 端点 A
 * @param b 端点 B
 * @returns 字典序归一化后的 [low, high]
 */
export function normalizePair(a: string, b: string): readonly [string, string] {
  return a <= b ? ([a, b] as const) : ([b, a] as const);
}

/**
 * 按人物对归并边。
 *
 * 为什么需要：同一对人物可能同时有「父子」「兄弟」「朋友」多条边，
 * 矩阵非对角格与详情卡都以**人物对**为单位，而非以边为单位。
 *
 * @param edges 边集
 * @returns 人物对列表（按首次出现顺序稳定排列）
 */
export function groupByPair(edges: readonly GraphEdge[]): PersonPair[] {
  const byKey = new Map<string, PersonPair>();
  for (const edge of edges) {
    const [low, high] = normalizePair(edge.source, edge.target);
    const key = `${low}\u0000${high}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { low, high, edges: [edge] });
    } else {
      existing.edges.push(edge);
    }
  }
  return [...byKey.values()];
}

/**
 * 计算子图度数（只统计传入的边）。
 *
 * 用途：`GraphNode.degree` 是全库口径，画布半径用它是对的；
 * 但「这个人在这张图里有没有连线」必须用本函数的结果，
 * 否则 0 度节点会看起来有关系（demo 里的 `陈木南` 即此例）。
 *
 * @param nodes 节点集
 * @param edges 子图边集
 * @returns 节点 ID → 子图度数
 */
export function computeSubDegrees(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[]
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const node of nodes) {
    map.set(node.id, 0);
  }
  for (const edge of edges) {
    // 端点不在节点集内时不计，保证「度数」与「画面里的可见连线」严格一致。
    if (map.has(edge.source)) {
      map.set(edge.source, (map.get(edge.source) ?? 0) + 1);
    }
    if (map.has(edge.target)) {
      map.set(edge.target, (map.get(edge.target) ?? 0) + 1);
    }
  }
  return map;
}

/**
 * 找出「关系特异」的人物对 —— 同一对人物之间有多种关系码。
 *
 * 用途：这是最值得人工复核的样本（模型可能把一次交互误拆成多种关系）。
 *
 * @param edges 边集
 * @returns 含多种关系码的人物对（按码集合大小降序、再按 low 稳定排序）
 */
export function computeExclusivePairs(edges: readonly GraphEdge[]): PersonPair[] {
  return groupByPair(edges)
    .filter((pair) => new Set(pair.edges.map((edge) => edge.typeCode)).size > 1)
    .sort((left, right) => {
      const leftCodes = new Set(left.edges.map((edge) => edge.typeCode)).size;
      const rightCodes = new Set(right.edges.map((edge) => edge.typeCode)).size;
      if (rightCodes !== leftCodes) {
        return rightCodes - leftCodes;
      }
      return left.low.localeCompare(right.low);
    });
}

/**
 * 构建关系共现矩阵。
 *
 * 维度 = **传入的关系码**（来自切片实算的 `codeStats`），因此是动态 N×N；
 * 不可硬编码维度 —— 切片内未出现的关系码若被带进来会形成空行空列。
 *
 * @param edges 边集（应为当前切片过滤后的边）
 * @param codes 行列顺序（通常取 `codeStats.map(s => s.code)`）
 * @returns 矩阵（对角与非对角统一存于 `cells`）
 */
export function buildMatrix(
  edges: readonly GraphEdge[],
  codes: readonly string[]
): RelationMatrix {
  const pairs = groupByPair(edges);

  // 每个格子先按「人物对」去重：同一对人物有多条同码边时只计 1。
  //
  // 🔑 上三角的判定必须用**下标**（`codes` 内的位置），不能用字符串比较：
  // `兄弟`/`父子` 的 UTF-16 序与 `codes` 数组序相反，用字符串比较会漏计
  // （这在开发中真实踩到过，见测试「非对角值」一例）。
  const indexOf = new Map(codes.map((code, index) => [code, index]));
  const counts = new Map<string, number>();
  for (const pair of pairs) {
    const presentCodes = new Set(pair.edges.map((edge) => edge.typeCode));
    const list = codes.filter((code) => presentCodes.has(code));
    for (const rowCode of list) {
      for (const colCode of list) {
        const rowIndex = indexOf.get(rowCode) ?? -1;
        const colIndex = indexOf.get(colCode) ?? -1;
        if (rowIndex > colIndex) {
          continue; // 上三角 + 对角，保证无向且不重复计数
        }
        const key = `${rowCode}\u0000${colCode}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  const cells: MatrixCell[] = [];
  for (let row = 0; row < codes.length; row += 1) {
    for (let col = row; col < codes.length; col += 1) {
      const rowCode = codes[row] ?? "";
      const colCode = codes[col] ?? "";
      cells.push({
        rowCode,
        colCode,
        count: counts.get(`${rowCode}\u0000${colCode}`) ?? 0
      });
    }
  }

  return { codes: [...codes], cells };
}

/**
 * 取矩阵某格的值（自动处理行列交换，故查询顺序无关）。
 *
 * 🔑 归一化必须用**矩阵自身的 `codes` 顺序**，不能用字符串比较：
 * `buildMatrix` 只生成「按 `codes` 下标做的上三角」，若此处改用字典序归一化，
 * 就会去查一个根本没生成的格子（例如 `兄弟`/`父子` 的 UTF-16 序与数组序相反），
 * 从而永远返回 0 —— 这是一个真实踩到过的错误（见本文件测试）。
 *
 * @param matrix 矩阵
 * @param codeA 关系码 A
 * @param codeB 关系码 B
 * @returns 命中的人物对数；码不在维度内时为 0
 */
export function cellCount(matrix: RelationMatrix, codeA: string, codeB: string): number {
  const indexA = matrix.codes.indexOf(codeA);
  const indexB = matrix.codes.indexOf(codeB);
  if (indexA === -1 || indexB === -1) {
    return 0;
  }
  const rowCode = indexA <= indexB ? codeA : codeB;
  const colCode = indexA <= indexB ? codeB : codeA;
  const hit = matrix.cells.find(
    (cell) => cell.rowCode === rowCode && cell.colCode === colCode
  );
  return hit?.count ?? 0;
}

/** 矩阵详情卡的视图模型。 */
export interface MatrixDetailEntry {
  low  : string;
  high : string;
  /** 该对人物之间**命中查询条件**的边。 */
  edges: GraphEdge[];
}

/**
 * 组装非对角格详情：同时具备 `codeA` 与 `codeB` 的人物对。
 *
 * 注意：只保留**同时命中两个码**的对；每条边都保留（含同一对的其它码），
 * 以便详情卡展示「这一对其实还有第三、第四种关系」的全貌。
 *
 * @param edges 边集
 * @param codeA 关系码 A
 * @param codeB 关系码 B
 * @returns 命中的条目（按 code 组合出现顺序稳定排列）
 */
export function buildPairDetail(
  edges: readonly GraphEdge[],
  codeA: string,
  codeB: string
): MatrixDetailEntry[] {
  return groupByPair(edges)
    .filter((pair) => {
      const present = new Set(pair.edges.map((edge) => edge.typeCode));
      return present.has(codeA) && present.has(codeB);
    })
    .map((pair) => ({ low: pair.low, high: pair.high, edges: pair.edges }));
}

/**
 * 组装对角格详情：具备该关系码的人物对。
 *
 * @param edges 边集
 * @param code 关系码
 * @returns 命中的条目；每条只保留**该码**的边（对角格问的是「这个码」）
 */
export function buildDiagDetail(
  edges: readonly GraphEdge[],
  code: string
): MatrixDetailEntry[] {
  return groupByPair(edges)
    .filter((pair) => pair.edges.some((edge) => edge.typeCode === code))
    .map((pair) => ({
      low  : pair.low,
      high : pair.high,
      edges: pair.edges.filter((edge) => edge.typeCode === code)
    }));
}

/**
 * 取关系码的统计（用于矩阵行列顺序与图例）。
 *
 * @param codeStats 快照携带的码统计
 * @returns 关系码顺序（已按 count 降序，此处只做投影）
 */
export function matrixCodes(codeStats: readonly GraphCodeStat[]): string[] {
  return codeStats.map((stat) => stat.code);
}

/**
 * 人物对 → 稳定键（与 `groupByPair` 的归并键同构）。
 *
 * 用途：详情卡与画布高亮需要交换「哪一对人物」这个身份，
 * 而 React key / Set 成员都要求字符串 —— 集中在此生成可避免两处写法漂移。
 *
 * @param a 端点 A
 * @param b 端点 B
 * @returns 归一化键（`low\u0000high`，与 `groupByPair` 一致）
 */
export function pairKey(a: string, b: string): string {
  const [low, high] = normalizePair(a, b);
  return `${low}\u0000${high}`;
}

/**
 * 关系码在章节上的分布（演化序列的原始数据）。
 *
 * 语义：第 i 个元素 = 该码「起始回号为 i」的边数（**不是**活跃数）。
 * 对齐 demo 的取法（按 `start` 归入回号桶），因此可与之逐条比对。
 *
 * ⚠️ 回号为 0（前置内容，如「前言」）落在下标 0 —— 这是合法桶，**不可丢弃**；
 * 全书回号可能不连续（缺回），缺失位置保持 0 而不是压缩，数组下标必须等于回号。
 *
 * @param edges 边集
 * @param code 关系码
 * @param chapterCount 全书回数（决定数组长度；取 `chapterCount` 与最大回号+1 的较大者）
 * @returns 长度 = 桶数的计数数组
 */
export function buildChapterSeries(
  edges: readonly GraphEdge[],
  code: string,
  chapterCount: number
): number[] {
  const maxStart = edges.reduce(
    (max, edge) => (edge.typeCode === code ? Math.max(max, edge.startChapter) : max),
    0
  );
  // +1 把「回号」翻译成「数组长度」：回号 57 需要 58 个桶（0..57）。
  const length = Math.max(chapterCount + 1, maxStart + 1, 1);
  const series = new Array<number>(length).fill(0);
  for (const edge of edges) {
    if (edge.typeCode !== code) {
      continue;
    }
    const index = edge.startChapter;
    if (index < 0 || index >= series.length) {
      continue; // 越界回号静默跳过，避免污染最后一个桶
    }
    series[index] = (series[index] ?? 0) + 1;
  }
  return series;
}

/**
 * 取一批人物的展示名（详情卡用）。
 *
 * @param nodes 节点集
 * @returns 节点 ID → 名称；缺失 ID 不在表内（调用方须给兜底文案）
 */
export function buildNameLookup(nodes: readonly GraphNode[]): ReadonlyMap<string, string> {
  return new Map(nodes.map((node) => [node.id, node.name]));
}

/**
 * 详情卡的条目排序：边数多者在前，再按端点名稳定排序。
 *
 * 为什么不用 `low.localeCompare`：UUID 字典序对用户无意义，
 * 按「关系更丰富」优先能让人先看到更值得复核的样本。
 *
 * @param entries 详情条目
 * @param names 端点名查找表
 * @returns 新数组（不改原数组）
 */
export function sortDetailEntries(
  entries: readonly MatrixDetailEntry[],
  names: ReadonlyMap<string, string>
): MatrixDetailEntry[] {
  const nameOf = (id: string): string => names.get(id) ?? id;
  return [...entries].sort((left, right) => {
    if (right.edges.length !== left.edges.length) {
      return right.edges.length - left.edges.length;
    }
    const leftLabel = `${nameOf(left.low)}${nameOf(left.high)}`;
    const rightLabel = `${nameOf(right.low)}${nameOf(right.high)}`;
    return leftLabel.localeCompare(rightLabel);
  });
}

/**
 * 找出「关系特异」人物对的键集合（供画布高亮批量判定）。
 *
 * @param edges 边集
 * @returns 键集合（`pairKey` 语义）
 */
export function exclusivePairKeys(edges: readonly GraphEdge[]): ReadonlySet<string> {
  return new Set(
    computeExclusivePairs(edges).map((pair) => `${pair.low}\u0000${pair.high}`)
  );
}
