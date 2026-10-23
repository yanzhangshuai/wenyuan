"use client";

import { Loader2, Sparkles, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  formatGroupsText,
  formatNounsText,
  parseGroupsText,
  parseNounsText
} from "@/lib/pack-text";
import { cn } from "@/lib/utils";

/**
 * 解析条件编辑器（Client Component）。
 *
 * ## 为什么用两个大文本框而不是逐条表单
 *
 * 专名有 100–300 条、别名组几十条。逐条表单要点击上百次，而用户真实的编辑动作
 * 是「从别处复制一批名字进来」「删掉几行错的」—— 文本框正好匹配这种批量操作。
 *
 * 代价是格式错误要靠解析器兜底，所以 `parseNounsText` / `parseGroupsText`
 * 都是纯函数并单独测试（见 `pack-editor.test.ts`）。
 *
 * ## 为什么「自动生成」要二次确认
 *
 * 它会**覆盖**库里已有的配置。用户手改过的内容一旦被覆盖就找不回来，
 * 所以只在「库里有配置」时才弹确认。
 */

/** 库里的配置（与 API 返回对齐）。 */
export interface StoredPack {
  source        : string;
  status        : string;
  properNouns   : { name: string; postag: number }[];
  aliasGroups   : string[][];
  suggestionNote: string | null;
  updatedAt     : string;
}

/** 实际生效的配置（来自 `loadWorkPack`）。 */
export interface EffectivePack {
  origin         : string;
  packId         : string;
  packLabel      : string;
  properNounCount: number;
  aliasGroupCount: number;
}

export interface PackEditorProps {
  bookId       : string;
  initialStored: StoredPack | null;
  effective    : EffectivePack;
  className?   : string;
}

/** 来源的中文名。 */
const ORIGIN_LABELS: Record<string, string> = {
  db         : "自定义",
  builtin    : "内置包",
  unregistered: "空词典"
};

// 纯函数定义在 `@/lib/pack-text`（无依赖，可单测）；这里 re-export 保持组件对外 API 不变。
export { formatGroupsText, formatNounsText, parseGroupsText, parseNounsText };

export function PackEditor({ bookId, initialStored, effective, className }: PackEditorProps) {
  const [stored, setStored] = useState<StoredPack | null>(initialStored);
  const [nounsText, setNounsText] = useState(formatNounsText(initialStored?.properNouns ?? []));
  const [groupsText, setGroupsText] = useState(formatGroupsText(initialStored?.aliasGroups ?? []));
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function reload(): Promise<StoredPack | null> {
    const response = await fetch(`/api/admin/books/${bookId}/pack`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as { stored?: StoredPack | null };
    const next = payload.stored ?? null;
    setStored(next);
    setNounsText(formatNounsText(next?.properNouns ?? []));
    setGroupsText(formatGroupsText(next?.aliasGroups ?? []));
    return next;
  }

  async function handleGenerate(): Promise<void> {
    if (stored !== null) {
      const confirmed = window.confirm(
        "自动生成会覆盖当前配置（包括你手工改过的内容）。继续吗？\n\n" +
          "提示：已有人工验证过作品包的书，建议不要用自动生成。"
      );
      if (!confirmed) return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch(`/api/admin/books/${bookId}/pack/suggest`, { method: "POST" });
      const payload = (await response.json()) as {
        ok?    : boolean;
        message?: string;
        result?: {
          candidateCount  : number;
          properNounCount : number;
          aliasGroupCount : number;
          droppedAliases  : unknown[];
        };
      };
      if (!response.ok || payload.ok !== true) {
        toast.error(payload.message ?? "生成失败");
        return;
      }
      await reload();
      toast.success("已生成建议配置", {
        description: `扫描 ${String(payload.result?.candidateCount ?? 0)} 个候选 · ${String(
          payload.result?.properNounCount ?? 0
        )} 个专名 · ${String(payload.result?.aliasGroupCount ?? 0)} 个别名组`
      });
    } catch {
      toast.error("生成失败：网络异常");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/admin/books/${bookId}/pack`, {
        method : "PUT",
        headers: { "content-type": "application/json" },
        body   : JSON.stringify({
          properNouns: parseNounsText(nounsText),
          aliasGroups: parseGroupsText(groupsText),
          status     : "confirmed"
        })
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok !== true) {
        toast.error(payload.message ?? "保存失败");
        return;
      }
      await reload();
      toast.success("已保存", { description: "下次解析生效（已跑过的结果不会变）" });
    } catch {
      toast.error("保存失败：网络异常");
    } finally {
      setIsSaving(false);
    }
  }

  const isDraft = stored?.status === "draft";

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">解析条件</CardTitle>
            <CardDescription>
              这本书的人名/地名词典与别名组。词典决定分词准不准，别名组决定同一人会不会被拆成两个。
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{ORIGIN_LABELS[effective.origin] ?? effective.origin}</Badge>
            {isDraft ? <Badge variant="secondary">待确认</Badge> : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-xs">
          当前生效：{effective.packLabel} · {effective.properNounCount} 个专名 ·{" "}
          {effective.aliasGroupCount} 个别名组
        </p>

        {isDraft ? (
          <Alert>
            <AlertTitle>这份配置是自动生成的，尚未确认</AlertTitle>
            <AlertDescription>
              如果解析结果出现「两个人被合成一个」，先看这里 —— 别名组是唯一会直接导致错并的输入。
              确认无误后点「保存」。
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pack-nouns">
              专名词典 <span className="text-muted-foreground font-normal">（每行一个，地名写「名字,64」）</span>
            </Label>
            <Textarea
              id="pack-nouns"
              className="h-64 font-mono text-xs"
              value={nounsText}
              onChange={(event) => {
                setNounsText(event.target.value);
              }}
              placeholder={"贾宝玉\n林黛玉\n荣国府,64"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pack-groups">
              别名组 <span className="text-muted-foreground font-normal">（每行一组，用 = 分隔）</span>
            </Label>
            <Textarea
              id="pack-groups"
              className="h-64 font-mono text-xs"
              value={groupsText}
              onChange={(event) => {
                setGroupsText(event.target.value);
              }}
              placeholder={"宝玉 = 宝二爷 = 怡红公子\n贾政 = 政老爷 = 存周"}
            />
            <p className="text-muted-foreground text-xs">
              ⚠️ 别名组是「声明即断言」：写错会让两个人被无条件合并。只写能回原文逐对辩护的组。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              void handleGenerate();
            }}
            disabled={isGenerating || isSaving}
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? "正在扫描全书…" : "自动生成建议"}
          </Button>
          <Button
            className="gap-2"
            onClick={() => {
              void handleSave();
            }}
            disabled={isGenerating || isSaving}
          >
            {isSaving ? <Loader2 className={cn("h-4 w-4 animate-spin")} /> : <Save className="h-4 w-4" />}
            保存
          </Button>
          <span className="text-muted-foreground text-xs">
            {isGenerating ? "首次扫描全书约需 10–60 秒，请不要关闭页面" : "保存后下次解析生效"}
          </span>
        </div>

        {stored?.suggestionNote === null || stored === null ? null : (
          <p className="text-muted-foreground font-mono text-[11px]">{stored.suggestionNote}</p>
        )}
      </CardContent>
    </Card>
  );
}
