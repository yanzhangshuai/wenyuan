import { describe, expect, it } from "vitest";

import {
  RELATION_TYPES,
  RELATION_TYPE_CODES,
  SYMMETRIC_RELATION_CODES,
  resolveRelationCode
} from "./relations";

describe("关系类型目录", () => {
  it("code 唯一，且 category 落在 0..4", () => {
    const codes = RELATION_TYPES.map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);

    for (const item of RELATION_TYPES) {
      expect(item.category).toBeGreaterThanOrEqual(0);
      expect(item.category).toBeLessThanOrEqual(4);
    }
  });

  it("闭集包含 10 个关系码", () => {
    expect(RELATION_TYPE_CODES.size).toBe(10);
  });

  it("对称关系码由 direction 派生，与 v1 静态表一致", () => {
    expect([...SYMMETRIC_RELATION_CODES].sort()).toEqual(
      ["兄弟", "夫妻", "同年", "同僚", "朋友", "仇敌"].sort()
    );
  });

  it("别称可归一化为规范码", () => {
    expect(resolveRelationCode("手足")).toBe("兄弟");
    expect(resolveRelationCode(" 座师 ")).toBe("师生");
    expect(resolveRelationCode("不存在的关系")).toBeNull();
  });
});
