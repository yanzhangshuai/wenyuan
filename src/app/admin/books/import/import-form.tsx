"use client";

import { AlertTriangle, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type SyntheticEvent } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 导入表单（Client Component）。
 *
 * ## 流程：导入 → 详情页（默认不解析）
 *
 * 新书的人名/地名词典还没配，直接解析等于用空词典跑一遍（红楼一次约 $0.66），
 * 而配置往往要改几轮。所以默认**只入库**，跳到详情页让用户先确认两件事：
 * 章节切分对不对、解析条件要不要补。
 *
 * 勾了「导入后立即解析」才走自动流程 —— 适合已验证过的书（比如重导一遍）。
 *
 * ## 交互要点
 * - 同名作品会被**整体替换**（段落坐标不可变，只能重建），必须勾选确认后才能提交；
 * - 无论是否解析，成功后都跳详情页：那里有章节清单、解析条件、解析进度，是这本书的主页。
 */

/** 导入成功后的摘要（与服务端 `ImportResult` 对齐）。 */
interface ImportResult {
  bookId        : string;
  title         : string;
  chapterCount  : number;
  paragraphCount: number;
  totalChars    : number;
  deletedLines  : number;
}

/** 入队结果（与服务端 `EnqueueResult` 对齐）。 */
interface EnqueueResult {
  queued  : boolean;
  position: number;
  reason  : string | null;
}

export function ImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  /** 默认不解析：先确认章节与解析条件。 */
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const picked = event.target.files?.[0] ?? null;
    setFile(picked);
    setErrorMessage("");
    // 标题留空时用文件名（去扩展名）作为占位提示。
    if (picked !== null && title.length === 0) {
      setTitle(picked.name.replace(/\.[^.]+$/u, ""));
    }
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (file === null) {
      setErrorMessage("请先选择要导入的文本文件");
      return;
    }
    if (!confirmed) {
      setErrorMessage("请先确认「同名作品将被替换」");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const form = new FormData();
      form.set("file", file);
      form.set("title", title);
      form.set("author", author);
      form.set("autoAnalyze", autoAnalyze ? "1" : "0");

      const response = await fetch("/api/admin/import", { method: "POST", body: form });
      const payload = (await response.json()) as {
        ok?      : boolean;
        message? : string;
        result?  : ImportResult;
        analysis?: EnqueueResult | null;
      };

      if (!response.ok || payload.ok !== true || payload.result === undefined) {
        setErrorMessage(payload.message ?? "导入失败，请稍后再试");
        return;
      }

      const imported = payload.result;
      const summary = `${String(imported.chapterCount)} 章 · ${String(imported.paragraphCount)} 段 · ${imported.totalChars.toLocaleString("zh-CN")} 字`;

      if (payload.analysis !== null && payload.analysis !== undefined) {
        if (payload.analysis.queued) {
          toast.success(`《${imported.title}》导入完成，正在解析`, { description: summary });
        } else {
          // 入队失败（队列满 / 已在跑）—— 导入本身已成功，说清「解析没开始」。
          toast.warning(`《${imported.title}》导入完成，但解析未启动`, {
            description:
              payload.analysis.reason === "queue_full"
                ? "解析队列已满，可在详情页稍后手动开始"
                : "该作品已有解析任务在跑"
          });
        }
      } else {
        toast.success(`《${imported.title}》导入完成`, {
          description: `${summary}　请先确认章节切分与解析条件`
        });
      }

      router.push(`/admin/books/${imported.bookId}`);
    } catch {
      setErrorMessage("网络异常，导入未完成");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">上传文本</CardTitle>
        <CardDescription>
          支持 UTF-8 / GB18030 文本（自动归编码）。导入只建章节与段落，解析需要你在下一步确认后手动开始。
        </CardDescription>
      </CardHeader>

      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <CardContent className="space-y-4">
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>导入失败</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="file">文本文件（.txt）</Label>
            <Input
              id="file"
              type="file"
              accept=".txt,text/plain"
              onChange={handleFileChange}
              disabled={isSubmitting}
            />
            {file === null ? null : (
              <p className="text-muted-foreground text-xs">
                已选择 {file.name}（{(file.size / 1024).toFixed(1)} KB）
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title">作品标题</Label>
              <Input
                id="title"
                placeholder="留空则取文件名"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="author">作者（可选）</Label>
              <Input
                id="author"
                placeholder="如 吴敬梓"
                value={author}
                onChange={(event) => {
                  setAuthor(event.target.value);
                }}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>同名作品会被整体替换</AlertTitle>
            <AlertDescription>
              段落坐标一经写入即不可变，因此同名导入会<strong>级联清空</strong>该作品的实体、关系、提及与解析记录。
              如果只是想更新文本，请确认后再继续。
            </AlertDescription>
          </Alert>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="confirm-replace"
              checked={confirmed}
              onChange={(event) => {
                setConfirmed(event.target.checked);
              }}
              disabled={isSubmitting}
            />
            <Label htmlFor="confirm-replace" className="text-sm font-normal">
              我确认：若存在同名作品，将被替换
            </Label>
          </div>

          <div className="flex items-start space-x-2 border-t pt-4">
            <Checkbox
              id="auto-analyze"
              checked={autoAnalyze}
              onChange={(event) => {
                setAutoAnalyze(event.target.checked);
              }}
              disabled={isSubmitting}
            />
            <div className="space-y-1">
              <Label htmlFor="auto-analyze" className="text-sm font-normal">
                导入后立即解析（跳过配置审核）
              </Label>
              <p className="text-muted-foreground text-xs">
                默认不解析：新书还没有人名/别名词典，直接跑会用空词典，结果偏差且无法与配置后的结果比较。
                已验证过的书（比如重导）可以勾上。
              </p>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex items-center justify-between gap-4">
          <Button type="submit" className="gap-2" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                导入中...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                开始导入
              </>
            )}
          </Button>
          <span className="text-muted-foreground text-xs">
            导入后进入书籍详情页，确认章节与解析条件
          </span>
        </CardFooter>
      </form>
    </Card>
  );
}
