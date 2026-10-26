/**
 * 图谱覆盖层的应用（纯函数，零依赖）。
 *
 * 把人工修正叠加到解析产出的快照上。**不修改入参**，返回新对象。
 *
 * ## 能力边界
 *
 * `GraphNode` 不带别名，所以四种覆盖里只有两种能影响当前画面：
 *
 * | kind | 对当前快照 | 说明 |
 * | --- | --- | --- |
 * | `hide_entity` | ✅ 节点与相关边被剔除 | 用于清掉「姑丈」这种不该存在的实体 |
 * | `change_type` | ✅ 改写 node.type | 用于「荷花」应为 CONCEPT 而非 PERSON |
 * | `drop_alias` | ❌ 不可见 | 快照没有别名字段；只在下次解析的 P5 归并时生效 |
 * | `add_alias` | ❌ 不可见 | 同上 |
 *
 * 后两种会被放进 `deferred`，页面据此提示「需要重新解析才生效」——
 * 假装它们立刻生效比不提示更糟。
 */

import type { GraphSnapshot } from "@/types/graph";

import type { GraphOverrideKind, GraphOverridePayload } from "@/server/db/schema";

/** 覆盖记录（与表结构解耦的最小形状）。 */
export interface OverrideRecord {
  kind      : GraphOverrideKind;
  targetName: string;
  payload   : GraphOverridePayload;
}

/** 应用结果。 */
export interface ApplyOverridesResult {
  /** 应用后的快照（无覆盖时是入参本身，引用相等）。 */
  snapshot : GraphSnapshot;
  /** 找不到目标实体的覆盖（重跑后实体被改名或合并）。 */
  unmatched: string[];
  /** 不影响当前画面的覆盖（`drop_alias` / `add_alias`），要重跑才生效。 */
  deferred : string[];
}

/**
 * 把覆盖层应用到快照上。
 *
 * @param snapshot 解析产出的原始快照
 * @param overrides 该书的全部覆盖
 * @returns 应用结果；`overrides` 为空时原样返回入参（零开销，保证无覆盖时逐字节不变）
 */
export function applyOverrides(
  snapshot: GraphSnapshot,
  overrides: readonly OverrideRecord[]
): ApplyOverridesResult {
  if (overrides.length === 0) {
    return { snapshot, unmatched: [], deferred: [] };
  }

  const nodeByName = new Map(snapshot.nodes.map((node) => [node.name, node]));
  const hidden = new Set<string>();
  const typeChanges = new Map<string, string>();
  const unmatched: string[] = [];
  const deferred: string[] = [];

  for (const override of overrides) {
    const node = nodeByName.get(override.targetName);
    if (node === undefined) {
      unmatched.push(override.targetName);
      continue;
    }
    switch (override.kind) {
      case "hide_entity":
        hidden.add(node.id);
        break;
      case "change_type":
        typeChanges.set(node.id, override.payload.kind === "change_type" ? override.payload.type : node.type);
        break;
      case "drop_alias":
      case "add_alias":
        // 快照没有别名字段 —— 记下来让页面提示「需要重新解析」。
        deferred.push(override.targetName);
        break;
      default:
        break;
    }
  }

  // 没有任何一项能影响画面时，也不必重建对象。
  if (hidden.size === 0 && typeChanges.size === 0) {
    return { snapshot, unmatched, deferred };
  }

  const nodes = snapshot.nodes
    .filter((node) => !hidden.has(node.id))
    .map((node) => {
      const nextType = typeChanges.get(node.id);
      return nextType === undefined ? node : { ...node, type: nextType as typeof node.type };
    });

  // 隐藏节点后，两端任一被隐藏的边必须一起剔除 —— 否则会出现悬空边（指向不存在的 id）。
  const edges = snapshot.edges.filter((edge) => !hidden.has(edge.source) && !hidden.has(edge.target));

  /**
   * legend 必须按过滤后的边重算：它是「图例上的数量」，不重算就会出现
   * 「图例说 12 条亲属关系，画面上只有 9 条」这种对不上的情况。
   */
  const countByCategory = new Map<number, number>();
  for (const edge of edges) {
    countByCategory.set(edge.category, (countByCategory.get(edge.category) ?? 0) + 1);
  }
  const legend = snapshot.legend
    .map((entry) => ({ ...entry, count: countByCategory.get(entry.category) ?? 0 }))
    .filter((entry) => entry.count > 0);

  // 关系码统计同理：它也是「按当前画面的边数」，不重算就会与图例一样对不上。
  const countByCode = new Map<string, number>();
  for (const edge of edges) {
    countByCode.set(edge.typeCode, (countByCode.get(edge.typeCode) ?? 0) + 1);
  }
  const codeStats = (snapshot.codeStats ?? [])
    .map((entry) => ({ ...entry, count: countByCode.get(entry.typeCode) ?? 0 }))
    .filter((entry) => entry.count > 0);

  return {
    snapshot: { ...snapshot, nodes, edges, legend, codeStats },
    unmatched,
    deferred
  };
}
