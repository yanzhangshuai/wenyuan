import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { normalizeEncoding, stripStructuralNoise } from "@/server/modules/importing/canonicalize";
import { parseChapters } from "@/server/modules/importing/parse-text";
import { importBook } from "@/server/modules/importing/persist";

/**
 * 书籍导入脚本。
 *
 * 用法：
 *   pnpm import:book <文本文件路径> [--title 标题] [--author 作者]
 *
 * 设计原因：
 * - 导入与解析**分离** —— 先把章节/段落落库并冻结坐标，再单独运行解析管线。
 *   这样调整提示词或换模型时无需重新导入，也避免重复的文本处理开销；
 * - 默认标题取文件名（去掉扩展名），符合「一本书一个文件」的常见组织方式。
 *
 * 运行方式：`package.json` 的 `import:book` 已内置 `--conditions=react-server`，
 * 这是 `server-only` 在纯 Node 环境下正常工作所必需的。
 */

/** 命令行参数。 */
interface CliOptions {
  filePath: string;
  title   : string | undefined;
  author  : string | null;
}

/**
 * 解析命令行参数。
 *
 * @param argv 进程参数（不含 node 与脚本路径）
 * @returns 解析结果
 * @throws 缺少文件路径时抛出
 */
function parseArgs(argv: readonly string[]): CliOptions {
  const positional: string[] = [];
  let title: string | undefined;
  let author: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--title") {
      title = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--author") {
      author = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      positional.push(arg);
    }
  }

  const filePath = positional[0];
  if (filePath === undefined) {
    throw new Error(
      "缺少文本文件路径。用法：pnpm import:book <文件> [--title 标题] [--author 作者]"
    );
  }

  return { filePath, title, author };
}

/** 执行导入。 */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const absolutePath = resolve(options.filePath);

  const raw = await readFile(absolutePath, "utf8");
  const title = options.title ?? basename(absolutePath).replace(/\.[^.]+$/, "");

  // 两步清洗，**顺序不可交换**：先归编码（BOM / CRLF / 零宽字符），再删整行噪声。
  //
  // 为什么放在「读文件之后、解析之前」，而不是藏在 `parseChapters` 内部：
  // 否则其他直接读原文的代码（探针、将来的作品包生成器）都得各自记得
  // 处理 BOM / CRLF / 零宽字符，而实测红楼梦就是 CRLF（3366 行）。
  // 编码归一这一步对两本语料**逐字节零影响**（见 docs/问题清单与后续工作.md §3.9）。
  //
  // `stripStructuralNoise` 的安全边界是**只删整行、只认三条可枚举白名单**
  // （字数标记 / 分隔线 / 本章完标记），并返回**删除区间清单** ——
  // 原文永久保留，删除可审计、可回滚。详见 canonicalize.ts。
  const normalized = normalizeEncoding(raw);
  const { text, deletions } = stripStructuralNoise(normalized);
  const parsedChapters = parseChapters(text);

  if (parsedChapters.length === 0) {
    throw new Error(`未能从 ${absolutePath} 中解析出任何内容`);
  }

  const summary = await importBook(title, options.author, parsedChapters);

  console.log(`[import] 作品《${summary.title}》导入完成`);
  console.log(`  bookId      : ${summary.bookId}`);
  console.log(`  章节数      : ${summary.chapterCount}`);
  console.log(`  段落数      : ${summary.paragraphCount}`);
  console.log(`  总字数      : ${summary.totalChars}`);

  // 删除区间清单必须打印：删行是**移动坐标**的动作，
  // 金标里的「回号 + 段号 + 原文引用」全靠它才能对回原文。
  if (deletions.length > 0) {
    const byLabel = new Map<string, number>();
    for (const item of deletions) {
      byLabel.set(item.label, (byLabel.get(item.label) ?? 0) + 1);
    }
    console.log(
      `  结构性噪声：删除 ${deletions.length} 行（` +
        `${[...byLabel].map(([label, count]) => `${label}×${count}`).join("　")}）`
    );
    // 只列前 5 条 —— 完整清单在 `stripStructuralNoise` 的返回值里，可随时重算。
    for (const item of deletions.slice(0, 5)) {
      console.log(`    L${item.lineNo}  [${item.label}]  ${item.text}`);
    }
    if (deletions.length > 5) {
      console.log(`    …… 其余 ${deletions.length - 5} 行`);
    }
    console.log("    ⚠️ 删行会移动段落序号 —— 金标里的段号须同步复核。");
  } else {
    console.log("  结构性噪声：0 行（未命中任何白名单模式）");
  }
  if (summary.oversizedChapters.length > 0) {
    console.warn(
      `  警告：以下章节超过 6 万字，疑似章节切分失败，请人工确认：${summary.oversizedChapters.join(", ")}`
    );
  }
}

await main();
