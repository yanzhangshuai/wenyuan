"use client";

import { AlertTriangle, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useState, type ChangeEvent, type SyntheticEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 导入表单（Client Component）。
 *
 * 交互要点：
 * - 同名作品会被**整体替换**（段落坐标不可变，只能重建），因此必须勾选确认后才能提交；
 * - 导入**不触发解析**：成功后提示去终端跑 `pnpm analyze <bookId>`；
 * - 失败时把服务端文案原样展示（如「未能从文本中解析出任何章节内容」）。
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

export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const picked = event.target.files?.[0] ?? null;
    setFile(picked);
    setResult(null);
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

      const response = await fetch("/api/admin/import", { method: "POST", body: form });
      const payload = (await response.json()) as {
        ok?     : boolean;
        message?: string;
        result? : ImportResult;
      };

      if (!response.ok || payload.ok !== true || payload.result === undefined) {
        setErrorMessage(payload.message ?? "导入失败，请稍后再试");
        return;
      }
      setResult(payload.result);
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
          支持 UTF-8 / GB18030 文本（自动归编码）；导入只建章节与段落，<strong>不触发解析</strong>。
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

          {result ? (
            <Alert>
              <AlertTitle>导入完成：《{result.title}》</AlertTitle>
              <AlertDescription>
                {result.chapterCount} 章 · {result.paragraphCount} 段 ·{" "}
                {result.totalChars.toLocaleString("zh-CN")} 字
                {result.deletedLines > 0 ? ` · 删除结构性噪声 ${result.deletedLines} 行` : ""}
                <br />
                下一步：在终端运行{" "}
                <code className="mx-1">pnpm analyze {result.bookId}</code>
                完成解析。
              </AlertDescription>
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
          {result === null ? null : (
            <Button asChild variant="ghost">
              <Link href={`/admin/books/${result.bookId}`}>查看书籍详情 →</Link>
            </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
