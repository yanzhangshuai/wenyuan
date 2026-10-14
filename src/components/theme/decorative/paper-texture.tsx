"use client";

/**
 * 文件定位（丹青主题装饰背景）：
 * - 文件路径：`src/components/theme/decorative/paper-texture.tsx`
 * - 所属层次：前端视觉装饰层（客户端组件）。
 *
 * 丹青水墨背景 — danqing 装饰
 * 朱砂渐变光晕 + 水墨纹理 SVG + 竖线纹理
 *
 * 业务意图：
 * - 为“丹青”主题提供识别度更高的文化语义背景；
 * - 通过低透明度控制视觉冲击，保证正文与图表仍是主信息层。
 */
export function PaperTexture() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {/* 1) 多层径向光晕：营造朱砂墨晕气氛。 */}
      <div className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full opacity-[0.07]"
        style={{ background: "radial-gradient(circle, oklch(0.55 0.18 25) 0%, transparent 70%)", filter: "blur(60px)" }} />
      <div className="absolute -bottom-40 -left-20 w-[500px] h-[500px] rounded-full opacity-[0.05]"
        style={{ background: "radial-gradient(circle, oklch(0.45 0.12 35) 0%, transparent 70%)", filter: "blur(80px)" }} />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] opacity-[0.03]"
        style={{ background: "radial-gradient(ellipse, oklch(0.55 0.18 25) 0%, transparent 60%)", filter: "blur(120px)" }} />
      {/* 2) SVG 湍流噪声：模拟轻水墨肌理，避免纯 CSS 渐变的“塑料感”。 */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.025]" xmlns="http://www.w3.org/2000/svg">
        <filter id="ink-t"><feTurbulence type="turbulence" baseFrequency="0.012 0.008" numOctaves={6} seed={3} result="n" />
          <feColorMatrix type="saturate" values="0" in="n" result="g" /><feBlend in="SourceGraphic" in2="g" mode="multiply" /></filter>
        <rect width="100%" height="100%" filter="url(#ink-t)" fill="oklch(0.55 0.18 25)" />
      </svg>
      {/* 3) 竖向细纹：补充纸张纤维方向感。 */}
      <div className="absolute inset-0 opacity-[0.02]"
        style={{ backgroundImage: "repeating-linear-gradient(90deg, oklch(0.8 0.02 80) 0px, transparent 1px, transparent 120px)" }} />
    </div>
  );
}
