"use client";

import { Loader2, Play, Save, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { METRIC_LABELS, gradeMetrics, type PackMetrics } from "@/server/modules/analysis/pack-suggest/metrics";

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
  /** 生成质量指标（自动生成的配置才有）。 */
  metrics?      : PackMetrics | null;
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
  /**
   * 内置包内容（库里没有配置时用于**预填**）。
   *
   * 不预填的后果（实测踩到）：页面显示「135 个专名」而文本框是空的，
   * 用户此时点保存 → 空配置写进库 → 内置包被静默覆盖成零词典。
   */
  builtinPack? : { properNouns: { name: string; postag: number }[]; aliasGroups: string[][] } | null;
  effective    : EffectivePack;
  /**
   * 是否显示「开始解析」。
   *
   * 为什么放在这里而不是只靠下方的进度面板：配置卡片占满一屏（两个 256px 的文本框），
   * 窗口矮的时候「开始解析」会被推到屏幕外 —— 实测用户找不到按钮。
   * 卡片内再放一个入口，滚到哪都能点。
   */
  canStart?    : boolean;
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

export function PackEditor({
  bookId,
  initialStored,
  builtinPack = null,
  effective,
  canStart = false,
  className
}: PackEditorProps) {
  const router = useRouter();
  const [stored, setStored] = useState<StoredPack | null>(initialStored);
  // 初始内容：库里的配置优先；没有则预填内置包（避免「显示 135 个专名但框是空的」）。
  const [nounsText, setNounsText] = useState(
    formatNounsText(initialStored?.properNouns ?? builtinPack?.properNouns ?? [])
  );
  const [groupsText, setGroupsText] = useState(
    formatGroupsText(initialStored?.aliasGroups ?? builtinPack?.aliasGroups ?? [])
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  async function reload(): Promise<StoredPack | null> {
    const response = await fetch(`/api/admin/books/${bookId}/pack`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as { stored?: StoredPack | null };
    const next = payload.stored ?? null;
    setStored(next);
    // 保存失败或还没保存时，回落到内置包内容 —— 不能把用户看到的 135 个专名清空。
    setNounsText(formatNounsText(next?.properNouns ?? builtinPack?.properNouns ?? []));
    setGroupsText(formatGroupsText(next?.aliasGroups ?? builtinPack?.aliasGroups ?? []));
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
    const nouns = parseNounsText(nounsText);
    const groups = parseGroupsText(groupsText);
    if (nouns.length === 0 && groups.length === 0) {
      // 空配置是合法的，但它会让解析退化成零词典（人名被切碎、候选名单缺人），
      // 而且不会报错。这种「看起来保存成功、其实把书弄坏了」的操作必须拦一次。
      const confirmed = window.confirm(
        "保存后配置为空：解析会退化为零词典，人名会被切碎、候选名单缺人。确定要清空吗？"
      );
      if (!confirmed) return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/admin/books/${bookId}/pack`, {
        method : "PUT",
        headers: { "content-type": "application/json" },
        body   : JSON.stringify({
          properNouns: nouns,
          aliasGroups: groups,
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

  /**
   * 开始解析（不隐含保存）。
   *
   * 刻意与「保存」分开：用户可能就是想用内置包直接跑（不改），
   * 若点开始解析顺带保存，会把「内置包」变成「自定义」—— 之后内置包更新就跟他无关了。
   */
  async function handleStart(): Promise<void> {
    setIsStarting(true);
    try {
      const response = await fetch(`/api/admin/books/${bookId}/analyze`, { method: "POST" });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok !== true) {
        toast.error(payload.message ?? "无法开始解析");
        return;
      }
      toast.success("已开始解析", { description: "进度显示在下方，可以稍后回来看结果" });
      router.refresh();
    } catch {
      toast.error("开始解析失败：网络异常");
    } finally {
      setIsStarting(false);
    }
  }

  const isDraft = stored?.status === "draft";
  // 提前取出并收窄类型：JSX 条件里的 `stored?.metrics` 不会把后续表达式收窄成非空。
  const metrics = stored?.metrics ?? null;
  const grades = metrics === null ? null : gradeMetrics(metrics);

  /**
   * 逐组审核用的视图数据。
   *
   * 保留**原始行号**而不是解析后的下标：`parseGroupsText` 会丢弃单元素行，
   * 用它算出来的下标去删原始行会错位（删掉相邻的那组）。
   */
  const groupLines = groupsText
    .split("\n")
    .map((line, lineIndex) => ({ line: line.trim(), lineIndex }))
    .filter((item) => item.line.length > 0 && item.line.split(/[=＝]/u).length >= 2)
    .map((item) => ({
      ...item,
      members: item.line
        .split(/[=＝]/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    }));

  /** 专名表里的名字集合：用来发现「别名组引用了词典里没有的名字」。 */
  const nounNames = new Set(parseNounsText(nounsText).map((item) => item.name));

  /** 删掉第 `lineIndex` 行（逐组审核的「剔除」动作）。 */
  function removeGroupLine(lineIndex: number): void {
    const lines = groupsText.split("\n");
    lines.splice(lineIndex, 1);
    setGroupsText(lines.join("\n"));
  }

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

        {metrics !== null && grades !== null ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-y py-2 text-xs">
            {(Object.keys(METRIC_LABELS) as (keyof typeof METRIC_LABELS)[]).map((key) => {
              const level = grades[key];
              return (
                <span key={key} className="flex items-center gap-1.5" title={METRIC_LABELS[key].hint}>
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      level === "good" ? "bg-emerald-500" : level === "warn" ? "bg-amber-500" : "bg-red-500"
                    )}
                  />
                  <span className="text-muted-foreground">{METRIC_LABELS[key].label}</span>
                  <span className="font-medium tabular-nums">{(metrics[key] * 100).toFixed(1)}%</span>
                </span>
              );
            })}
            <span className="text-muted-foreground ml-auto">
              指标偏低时，解析结果的错并或漏人风险更高
            </span>
          </div>
        ) : null}

        {isDraft ? (
          <Alert>
            <AlertTitle>这份配置是自动生成的，尚未确认</AlertTitle>
            <AlertDescription>
              如果解析结果出现「两个人被合成一个」，先看这里 —— 别名组是唯一会直接导致错并的输入。
              确认无误后点「保存」。
            </AlertDescription>
          </Alert>
        ) : null}

        {stored === null && builtinPack !== null ? (
          <Alert>
            <AlertTitle>
              当前使用内置包（{builtinPack.properNouns.length} 个专名 ·{" "}
              {builtinPack.aliasGroups.length} 个别名组）
            </AlertTitle>
            <AlertDescription>
              下方已填入它的内容。不改就不用动，解析会继续用内置包；
              改了再点保存，会生成一份自定义配置（从这一刻起这本书不再跟随内置包）。
            </AlertDescription>
          </Alert>
        ) : null}

        {stored === null && builtinPack === null ? (
          <Alert>
            <AlertTitle>这本书还没有人名/地名词典</AlertTitle>
            <AlertDescription>
              直接解析会用通用分词器，人名可能被切碎（「夏侯惇」→「夏侯」+「惇」），
              候选名单缺人，抽出来的关系也少。建议先点「自动生成建议」扫一遍全书，
              审核后再开始解析；也可以直接在下方手工填写。
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
              className="h-40 font-mono text-xs"
              value={groupsText}
              onChange={(event) => {
                setGroupsText(event.target.value);
              }}
              placeholder={"宝玉 = 宝二爷 = 怡红公子\n贾政 = 政老爷 = 存周"}
            />
            <p className="text-muted-foreground text-xs">
              ⚠️ 别名组是「声明即断言」：写错会让两个人被无条件合并。只写能回原文逐对辩护的组。
            </p>

            {groupLines.length === 0 ? null : (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                <div className="text-muted-foreground flex items-center justify-between pb-1 text-[11px]">
                  <span>逐组审核 · 共 {groupLines.length} 组</span>
                  <span>黄色 = 组内有名字不在专名表里</span>
                </div>
                {groupLines.map((group) => {
                  const missing = group.members.filter((member) => !nounNames.has(member));
                  return (
                    <div
                      key={group.lineIndex}
                      className={cn(
                        "flex items-center gap-2 rounded px-1.5 py-1 text-xs",
                        missing.length > 0 ? "bg-amber-500/10" : "hover:bg-muted/50"
                      )}
                    >
                      <span className="font-mono">{group.members.join(" = ")}</span>
                      {missing.length > 0 ? (
                        <span className="text-[11px] text-amber-600">
                          「{missing.join("」「")}」不在专名表
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive ml-auto h-6 px-1.5 text-[11px]"
                        onClick={() => {
                          removeGroupLine(group.lineIndex);
                        }}
                      >
                        剔除
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              void handleGenerate();
            }}
            // 内置包的书不提供自动生成：实测红楼生成出 145 专名 / 3 组，
            // 远低于内置的 163 / 32 —— 覆盖等于用未验证配置换掉金标基线。
            disabled={isGenerating || isSaving || (stored === null && builtinPack !== null)}
            title={
              stored === null && builtinPack !== null
                ? "已有人工验证过的内置包，不需要自动生成"
                : undefined
            }
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? "正在扫描全书…" : "自动生成建议"}
          </Button>
          <Button
            variant={canStart ? "outline" : "default"}
            className="gap-2"
            onClick={() => {
              void handleSave();
            }}
            disabled={isGenerating || isSaving || isStarting}
          >
            {isSaving ? <Loader2 className={cn("h-4 w-4 animate-spin")} /> : <Save className="h-4 w-4" />}
            保存
          </Button>
          {canStart ? (
            <Button
              className="gap-2"
              onClick={() => {
                void handleStart();
              }}
              disabled={isGenerating || isSaving || isStarting}
            >
              {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              开始解析
            </Button>
          ) : null}
          <span className="text-muted-foreground text-xs">
            {isGenerating
              ? "首次扫描全书约需 10–60 秒，请不要关闭页面"
              : canStart
                ? "开始解析会调用模型，一次约 $0.21–0.66"
                : "保存后下次解析生效"}
          </span>
        </div>

        {stored?.suggestionNote === null || stored === null ? null : (
          <p className="text-muted-foreground font-mono text-[11px]">{stored.suggestionNote}</p>
        )}
      </CardContent>
    </Card>
  );
}
