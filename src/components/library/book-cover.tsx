"use client";

import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { cn, getStringHash } from "@/lib/utils";

/**
 * 文件定位（Client Component / 书籍封面展示）：
 * - 该组件用于书库卡片中的封面区域渲染。
 * - 使用 `"use client"` 的原因：依赖 hover 交互样式、浏览器端渲染细节，以及 Next/Image 客户端行为。
 *
 * 业务目标：
 * - 有真实封面时展示图片；
 * - 无封面时生成“稳定且可识别”的占位封面，避免列表视觉断层。
 *
 * 版式来源：与 v1 `wen-yuan` 的 `components/library/book-cover.tsx` 保持 1:1
 * （纯 Tailwind 工具类，颜色令牌走主题，故四个主题下观感一致）。
 */

interface BookCoverProps {
  /** 书籍唯一 ID：用于生成稳定哈希色，保证同一本书占位色在多次渲染中一致。 */
  id        : string;
  /** 书名：用于封面 alt 与无图时竖排标题展示。 */
  title     : string;
  /** 作者名，可为空（古籍常见佚名）。 */
  author?   : string | null;
  /** 朝代标签，可为空。 */
  dynasty?  : string | null;
  /** 封面图片 URL，可为空或空白字符串。 */
  coverUrl? : string | null;
  /** 外部样式扩展类。 */
  className?: string;
  /** 禁用态：用于表现不可操作或离线状态。 */
  disabled? : boolean;
}

/** 无封面时的占位底色池：取自古典纸张与书封常见色，稳定哈希后按 ID 分配。 */
const FALLBACK_COVER_COLORS = [
  "#8b3a3a",
  "#4a5568",
  "#744210",
  "#5a8a6c",
  "#c9a227",
  "#2d4a3e",
  "#8a5b44",
  "#5a6f8b"
] as const;

export function BookCover({ id, title, author, dynasty, coverUrl, className, disabled }: BookCoverProps) {
  const hash = getStringHash(id);
  const backgroundColor = FALLBACK_COVER_COLORS[hash % FALLBACK_COVER_COLORS.length];
  // 竖排标题：去掉空白后逐字成行，复刻古籍封面版式。
  const verticalTitle = title.replace(/\s+/g, "").split("");
  // 空串与空白串都视为「无封面」——因此需要 `|| null` 而不是 `?? null`。
  const trimmedCoverUrl = coverUrl?.trim();
  const normalizedCoverUrl =
    trimmedCoverUrl === undefined || trimmedCoverUrl === "" ? null : trimmedCoverUrl;
  const hasCover = normalizedCoverUrl !== null;

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden transition-[opacity,filter,background-color] duration-[320ms]",
        disabled && "grayscale opacity-80",
        className
      )}
      style={!hasCover ? { backgroundColor } : undefined}
    >
      {hasCover ? (
        <Image
          src={normalizedCoverUrl}
          alt={title}
          fill
          className="h-full w-full object-cover"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
      ) : (
        <div className="absolute inset-0 opacity-30 texture-paper" aria-hidden="true" />
      )}

      <div className="relative flex h-full flex-col items-center justify-center p-6 text-center text-card-foreground">
        <div className="absolute top-4 right-4">
          <Badge
            variant="secondary"
            className="border-0 bg-background/20 text-[10px] font-normal text-card-foreground/90 backdrop-blur-sm"
          >
            {dynasty === null || dynasty === "" ? "典籍" : dynasty}
          </Badge>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <h3 className="text-xl font-bold tracking-wider">
            {verticalTitle.map((char, index) => (
              <span key={`${char}-${String(index)}`} className="block">
                {char}
              </span>
            ))}
          </h3>
        </div>

        <div className="mt-auto">
          <p className="text-sm text-card-foreground/80">
            {author === null || author === "" ? "佚名" : author}
          </p>
        </div>
      </div>
    </div>
  );
}
