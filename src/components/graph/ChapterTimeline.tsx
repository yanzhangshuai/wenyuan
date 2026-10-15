"use client";

import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 底部章节时间轴（对齐 v1 `chapter-timeline`）。
 *
 * ## 为什么需要它
 *
 * 「截至第 N 回」是理解人物关系演化的核心视角：读者关心的是
 * 「读到第 30 回时，这两个人认识了没有」。v1 用底部滑块表达这个维度，
 * v3 保持同一交互语言。
 *
 * ## 与 v1 的实现差异（刻意的）
 *
 * v1 每切一章都请求一次后端（服务端重算快照）；v3 的边自带
 * `startChapter`/`endChapter`，切片**全在客户端完成**（见 `lib/graph/chapter-slice.ts`），
 * 因此拖动滑块无网络往返，手感是即时的。
 *
 * ## 自动播放
 *
 * 每 2 秒推进一回（对齐 v1），到末回自动停止。
 * ⚠️ 用 ref 镜像当前回号：`setInterval` 的回调闭包会捕获旧值。
 */

export interface ChapterTimelineProps {
  /** 总回数（即快照的 `chapterCount`）。 */
  totalChapters  : number;
  /** 当前回号（受控）。 */
  currentChapter : number;
  /** 回号变更回调。 */
  onChapterChange: (chapter: number) => void;
  /** 回数单位文案（「回」/「章」）。 */
  chapterUnit?   : string;
}

/** 自动播放的推进间隔（毫秒），对齐 v1 的 2 秒。 */
const AUTOPLAY_INTERVAL_MS = 2000;

export function ChapterTimeline({
  totalChapters,
  currentChapter,
  onChapterChange,
  chapterUnit = "回"
}: ChapterTimelineProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 镜像当前回号，供 `setInterval` 回调读取最新值。 */
  const chapterRef = useRef(currentChapter);

  useEffect(() => {
    chapterRef.current = currentChapter;
  }, [currentChapter]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    intervalRef.current = setInterval(() => {
      const next = chapterRef.current + 1;
      if (next > totalChapters) {
        setIsPlaying(false);
        return;
      }
      onChapterChange(next);
    }, AUTOPLAY_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, totalChapters, onChapterChange]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChapterChange(Number(event.target.value));
    },
    [onChapterChange]
  );

  // 没有章节时不渲染，避免空壳 UI。
  if (totalChapters <= 0) {
    return null;
  }

  // 进度百分比；只有一回时分母按 1 处理，避免除 0。
  const progress = ((currentChapter - 1) / Math.max(totalChapters - 1, 1)) * 100;
  const atStart = currentChapter <= 1;
  const atEnd = currentChapter >= totalChapters;

  return (
    <div className="graph-stage-timeline" role="group" aria-label="章节时间轴">
      <div className="graph-stage-timeline-inner">
        <div className="graph-stage-timeline-controls">
          <button
            type="button"
            className="graph-stage-timeline-btn"
            onClick={() => {
              onChapterChange(1);
            }}
            disabled={atStart}
            aria-label={`跳到第 1 ${chapterUnit}`}
            title={`第 1 ${chapterUnit}`}
          >
            <SkipBack className="size-3.5" />
          </button>
          <button
            type="button"
            className="graph-stage-timeline-btn"
            onClick={() => {
              onChapterChange(Math.max(1, currentChapter - 1));
            }}
            disabled={atStart}
            aria-label={`上一${chapterUnit}`}
            title={`上一${chapterUnit}`}
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            type="button"
            className="graph-stage-timeline-btn"
            onClick={() => {
              setIsPlaying((previous) => !previous);
            }}
            aria-label={isPlaying ? "暂停自动播放" : "自动播放"}
            title={isPlaying ? "暂停" : "自动播放"}
          >
            {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <button
            type="button"
            className="graph-stage-timeline-btn"
            onClick={() => {
              onChapterChange(Math.min(totalChapters, currentChapter + 1));
            }}
            disabled={atEnd}
            aria-label={`下一${chapterUnit}`}
            title={`下一${chapterUnit}`}
          >
            <ChevronRight className="size-3.5" />
          </button>
          <button
            type="button"
            className="graph-stage-timeline-btn"
            onClick={() => {
              onChapterChange(totalChapters);
            }}
            disabled={atEnd}
            aria-label={`跳到第 ${String(totalChapters)} ${chapterUnit}`}
            title={`第 ${String(totalChapters)} ${chapterUnit}`}
          >
            <SkipForward className="size-3.5" />
          </button>
        </div>

        <span className="graph-stage-timeline-label">
          第 {currentChapter} {chapterUnit}
        </span>

        <div className="graph-stage-timeline-track">
          <div className="graph-stage-timeline-rail">
            <div className="graph-stage-timeline-fill" style={{ width: `${String(progress)}%` }} />
          </div>
          <input
            type="range"
            min={1}
            max={totalChapters}
            value={currentChapter}
            onChange={handleChange}
            onMouseDown={() => {
              setIsDragging(true);
            }}
            onMouseUp={() => {
              setIsDragging(false);
            }}
            onTouchStart={() => {
              setIsDragging(true);
            }}
            onTouchEnd={() => {
              setIsDragging(false);
            }}
            className="graph-stage-timeline-input"
            aria-label={`章节滑块：第 ${currentChapter} ${chapterUnit}`}
          />
          {isDragging ? (
            <div className="graph-stage-timeline-bubble" style={{ left: `${String(progress)}%` }}>
              第 {currentChapter} {chapterUnit}
            </div>
          ) : null}
        </div>

        <span className="graph-stage-timeline-count">
          {currentChapter} / {totalChapters}
        </span>
      </div>
    </div>
  );
}
