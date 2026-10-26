"use client";

import { Flag, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 「报告问题」入口（读者侧，L3）。
 *
 * ## 为什么只做四种
 *
 * 每一种都对应一个**管理员能立刻执行的配置修改**：拆别名组 / 加专名 / 改词性 / 加别名。
 * 不做「这条关系错了」—— 关系由 P1 逐片抽取 + 投票，改一条要重跑整片，
 * 不是配置层面能修的，给了按钮也只能晾在那里。
 *
 * ## 为什么要选类型而不是一个自由文本框
 *
 * 自由文本需要管理员逐条读、自己判断该改哪里。分类型后，队列里可以直接
 * 显示「贾蓝 ≠ 贾菌」这种摘要，管理员一眼知道要拆哪组。
 */

export interface FeedbackButtonProps {
  bookId    : string;
  /** 当前实体的规范名（默认填进「名字」）。 */
  entityName: string;
  className?: string;
}

type Kind = "missing_alias" | "wrong_merge" | "wrong_type" | "missing_entity";

const KIND_OPTIONS: { value: Kind; label: string; hint: string }[] = [
  { value: "missing_alias", label: "缺别名", hint: "这个人还有别的叫法没被收进来" },
  { value: "wrong_merge", label: "错并", hint: "这两个名字不是同一个人，被合成一个了" },
  { value: "wrong_type", label: "类型错", hint: "比如把地名标成了人名" },
  { value: "missing_entity", label: "漏了人物", hint: "这本书里有这个人，但图谱里没有" }
];

const TYPE_OPTIONS = ["PERSON", "LOCATION", "ORGANIZATION", "CONCEPT"] as const;

export function FeedbackButton({ bookId, entityName, className }: FeedbackButtonProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("missing_alias");
  const [name, setName] = useState(entityName);
  const [second, setSecond] = useState("");
  const [expectedType, setExpectedType] = useState<(typeof TYPE_OPTIONS)[number]>("PERSON");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function buildPayload(): unknown {
    switch (kind) {
      case "missing_alias":
        return { kind, name: name.trim(), alias: second.trim() };
      case "wrong_merge":
        // 第二个名字必填：错并需要「两个人」，只有一个名字没有意义。
        return { kind, names: [name.trim(), second.trim()].filter((item) => item.length > 0) };
      case "wrong_type":
        return { kind, name: name.trim(), expectedType };
      case "missing_entity":
        return { kind, name: name.trim() };
      default:
        return {};
    }
  }

  function isValid(): boolean {
    if (name.trim().length === 0) return false;
    if (kind === "missing_alias") return second.trim().length > 0;
    if (kind === "wrong_merge") return second.trim().length > 0;
    return true;
  }

  async function handleSubmit(): Promise<void> {
    if (!isValid()) {
      toast.error("请填写完整");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/feedback", {
        method : "POST",
        headers: { "content-type": "application/json" },
        body   : JSON.stringify({ bookId, payload: buildPayload() })
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok !== true) {
        toast.error(payload.message ?? "提交失败");
        return;
      }
      toast.success("已提交，管理员会看到", { description: "处理进度不在本页显示" });
      setOpen(false);
      setSecond("");
    } catch {
      toast.error("提交失败：网络异常");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={className ?? "gap-1.5"}>
          <Flag className="h-3.5 w-3.5" />
          报告问题
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>报告问题</DialogTitle>
          <DialogDescription>
            反馈会进入管理员队列。它不会直接改数据 —— 管理员确认后手动修配置。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>问题类型</Label>
            <div className="grid grid-cols-2 gap-2">
              {KIND_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.hint}
                  onClick={() => {
                    setKind(option.value);
                  }}
                  className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    kind === option.value
                      ? "border-primary bg-primary/5 text-foreground"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-name">{kind === "wrong_merge" ? "第一个名字" : "名字"}</Label>
            <Input
              id="fb-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              disabled={isSubmitting}
            />
          </div>

          {kind === "missing_alias" ? (
            <div className="space-y-1.5">
              <Label htmlFor="fb-second">它的另一个写法</Label>
              <Input
                id="fb-second"
                placeholder="如 宝二爷"
                value={second}
                onChange={(event) => {
                  setSecond(event.target.value);
                }}
                disabled={isSubmitting}
              />
            </div>
          ) : null}

          {kind === "wrong_merge" ? (
            <div className="space-y-1.5">
              <Label htmlFor="fb-second">第二个名字（被错并进来的）</Label>
              <Input
                id="fb-second"
                placeholder="如 贾菌"
                value={second}
                onChange={(event) => {
                  setSecond(event.target.value);
                }}
                disabled={isSubmitting}
              />
            </div>
          ) : null}

          {kind === "wrong_type" ? (
            <div className="space-y-1.5">
              <Label>它应该是</Label>
              <div className="flex flex-wrap gap-2">
                {TYPE_OPTIONS.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setExpectedType(type);
                    }}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      expectedType === type ? "border-primary bg-primary/5" : "text-muted-foreground"
                    }`}
                  >
                    {type === "PERSON" ? "人物" : type === "LOCATION" ? "地点" : type === "ORGANIZATION" ? "组织" : "概念"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button
            className="gap-2"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={isSubmitting || !isValid()}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            提交
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
