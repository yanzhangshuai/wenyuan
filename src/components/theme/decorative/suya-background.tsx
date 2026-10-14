"use client";

/**
 * 文件定位（素雅主题装饰背景）：
 * - 文件路径：`src/components/theme/decorative/suya-background.tsx`
 * - 所属层次：前端视觉装饰层（客户端组件）。
 *
 * 素雅宣纸背景 — suya 装饰
 * 分质噪声纹理 + 斜线底纹 + 右上角竹青光晕
 *
 * React / Next.js 语义：
 * - 使用 `"use client"` 是为了与主题切换客户端状态联动；
 * - 该组件只负责视觉氛围，不参与业务数据流。
 *
 * 维护注意：
 * - `aria-hidden` 与 `pointer-events-none` 是关键无障碍和交互约束，避免装饰层抢占焦点与点击。
 */
export function SuyaBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {/* 1) 底层纸纹噪声：低透明度提供“宣纸肌理”，避免纯色背景生硬。 */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
        <filter id="pg"><feTurbulence type="fractalNoise" baseFrequency="0.65 0.45" numOctaves={4} seed={8} result="n" />
          <feColorMatrix type="saturate" values="0" in="n" /></filter>
        <rect width="100%" height="100%" filter="url(#pg)" fill="oklch(0.45 0.10 160)" />
      </svg>
      {/* 2) 轻斜线纹理：增强纸面方向感，透明度受控避免影响文字可读性。 */}
      <div className="absolute inset-0 opacity-[0.025]"
        style={{ backgroundImage: "repeating-linear-gradient(168deg, oklch(0.45 0.10 160) 0px, transparent 1px, transparent 80px)" }} />
      {/* 3) 右上角光晕：提供视觉重心，帮助构建“素雅”场景氛围。 */}
      <div className="absolute -top-10 -right-10 w-[400px] h-[600px] opacity-[0.06]"
        style={{ background: "radial-gradient(ellipse at top right, oklch(0.55 0.10 160) 0%, transparent 70%)", filter: "blur(50px)" }} />
    </div>
  );
}
