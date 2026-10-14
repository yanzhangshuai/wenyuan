"use client";

/**
 * 文件定位（典藏主题装饰背景）：
 * - 文件路径：`src/components/theme/decorative/museum-glow.tsx`
 * - 所属层次：前端视觉装饰层（客户端组件）。
 *
 * 博物馆典藏背景 — diancang 装饰
 * 仅保留低强度黄铜光晕，避免与页面内容背景产生花纹冲突
 *
 * 设计原因：
 * - `diancang` 主题强调“馆藏文物”观感，光晕需克制；
 * - 与前景内容层保持足够对比，防止影响读写操作。
 */
export function MuseumGlow() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {/* 右上光源：模拟展陈灯打光。 */}
      <div
        className="absolute top-[-160px] right-[-120px] h-[640px] w-[640px] opacity-[0.045]"
        style={{
          background: "radial-gradient(circle at 70% 24%, oklch(0.72 0.12 85) 0%, transparent 68%)",
          filter    : "blur(84px)"
        }}
      />
      {/* 左下反射：平衡画面重心，避免背景视觉偏置。 */}
      <div
        className="absolute bottom-[-220px] left-[-180px] h-[620px] w-[620px] opacity-[0.04]"
        style={{
          background: "radial-gradient(circle at 30% 70%, oklch(0.60 0.10 70) 0%, transparent 70%)",
          filter    : "blur(92px)"
        }}
      />
    </div>
  );
}
