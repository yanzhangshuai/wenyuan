/**
 * 截断 JSON 修复（零 LLM 成本）。
 *
 * 背景：稠密分片下模型常在最后一个元素中途被 `max_tokens` 截断，
 * 输出形如 `{"entities":[{"canonical":"范进","type":"PERSON"},{"canonical":"周`。
 * 这类输出**重试几乎必然再次截断**（v1 正是把它列为可重试，导致调用数放大 9 倍）。
 *
 * 策略：不重试，改为确定性修复 —— 回退到最后一个完整元素边界，再补齐未闭合的括号。
 */

/** 修复结果。 */
export interface JsonRepairResult {
  /** 修复后的 JSON 文本（未做 schema 校验）。 */
  text    : string;
  /** 是否实际发生了修复（供 `analysis_issues` 留档）。 */
  repaired: boolean;
}

/** 结构扫描结果。 */
interface StructureScan {
  /** 顶层容器是否已正常闭合。 */
  closed           : boolean;
  /** 扫描结束时仍未闭合的开括号栈（自外向内）。 */
  stack            : string[];
  /** 最后一个「完整元素」的结束位置（不含分隔符）。 */
  lastCompleteIndex: number;
  /** 扫描结束时是否仍处于字符串内部（截断在字符串中途）。 */
  inString         : boolean;
}

/**
 * 判定文本尾部是否为一个完整的 JSON 值。
 *
 * 用途：截断恰好落在完整标量之后（无尾随逗号）时，把「文本末尾」也视为安全切点，
 * 否则 `[1,2,3` 会被回退成 `[1,2]`，白白丢掉一个完整元素。
 */
const VALUE_END_PATTERN = /(?:["\]}\d]|true|false|null)$/;

/**
 * 去除 Markdown 代码围栏。
 *
 * @param raw 模型原始输出
 * @returns 去掉 ```json / ``` 包裹后的文本
 */
export function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  if (fenceMatch?.[1] !== undefined) {
    return fenceMatch[1].trim();
  }
  // 只有起始围栏（输出被截断在围栏内）时，去掉首行围栏。
  return trimmed.replace(/^```[a-zA-Z]*\s*\n?/, "").trim();
}

/**
 * 找到第一个 JSON 容器起始位置。
 *
 * @param text 已去围栏的文本
 * @returns `{` 或 `[` 的下标；未找到返回 -1
 */
function findJsonStart(text: string): number {
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  if (objectStart < 0) {
    return arrayStart;
  }
  if (arrayStart < 0) {
    return objectStart;
  }
  return Math.min(objectStart, arrayStart);
}

/**
 * 扫描 JSON 文本结构，定位最后一个完整元素边界。
 *
 * 关键点：必须跳过字符串内部（含转义），否则引号内的括号会破坏结构计数 ——
 * 而古典小说文本里「（」「）」这类字符很常见。
 *
 * @param text 从容器起始处开始的文本
 * @returns 结构扫描结果
 */
function scanStructure(text: string): StructureScan {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastCompleteIndex = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === undefined) {
      break;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push(ch);
      // 容器刚打开：此刻截断是合法的（补一个闭括号即可）。
      lastCompleteIndex = i + 1;
      continue;
    }

    if (ch === "}" || ch === "]") {
      const opened = stack.pop();
      if (opened === undefined) {
        // 多余的闭括号：结构已结束，忽略其后内容。
        return { closed: true, stack: [], lastCompleteIndex, inString: false };
      }
      lastCompleteIndex = i + 1;
      if (stack.length === 0) {
        return { closed: true, stack: [], lastCompleteIndex, inString: false };
      }
      continue;
    }

    if (ch === ",") {
      // 逗号处意味着它前面的值已完整：这是比容器边界更精确的安全切点。
      lastCompleteIndex = i;
      continue;
    }
  }

  return { closed: false, stack, lastCompleteIndex, inString };
}

/** 把未闭合的开括号栈转换成对应的闭括号串。 */
function buildClosers(stack: readonly string[]): string {
  return stack
    .slice()
    .reverse()
    .map((opened) => (opened === "{" ? "}" : "]"))
    .join("");
}

/**
 * 修复可能被截断的 JSON 文本。
 *
 * 行为：
 * - 未截断 → 裁掉顶层容器前后的多余内容，`repaired = false`；
 * - 已截断 → 回退到最后一个完整元素，补齐闭括号，`repaired = true`；
 * - 完全找不到容器起始 → 原样返回，交由 schema 校验判定失败。
 *
 * @param raw 模型原始输出
 * @returns 修复结果
 */
export function repairTruncatedJson(raw: string): JsonRepairResult {
  const stripped = stripCodeFence(raw);
  const start = findJsonStart(stripped);
  if (start < 0) {
    return { text: stripped, repaired: false };
  }

  const body = stripped.slice(start);
  const scan = scanStructure(body);
  if (scan.closed) {
    return { text: body.slice(0, scan.lastCompleteIndex), repaired: false };
  }

  // 截断恰好落在完整标量之后时，文本末尾本身就是安全切点。
  const trimmedBody = body.replace(/\s+$/, "");
  const cutIndex =
    !scan.inString && VALUE_END_PATTERN.test(trimmedBody)
      ? trimmedBody.length
      : scan.lastCompleteIndex;

  // 回退到安全切点，并去掉悬空的逗号 / 空白。
  const head = body.slice(0, cutIndex).replace(/[,\s]+$/, "");
  const text = `${head}${buildClosers(scan.stack)}`;
  return { text, repaired: true };
}
