import { cn } from "@/lib/utils";

/**
 * 文件定位：
 * - 位于主题装饰组件目录，属于前端“视觉装饰层”组件，不承载业务数据。
 * - 默认是 Server Component 兼容写法（未使用 `use client`，也无浏览器专属 API），可在服务端预渲染输出 SVG。
 *
 * 业务职责：
 * - 为品牌/页面提供统一“文渊印章”视觉元素，强化品牌识别。
 * - 通过参数支持局部页面按需调整文字与尺寸，而不需要复制 SVG 代码。
 */
interface SealProps {
  /** 外部追加的样式类名，用于适配不同页面布局（展示字段）。 */
  className?: string;
  /** 印章文本内容，默认“文渊”（业务展示文案）。 */
  text?     : string;
  /** SVG 实际渲染尺寸（像素），默认 48。 */
  size?     : number;
}

/**
 * 文渊印章装饰组件。
 *
 * @param className 外部样式扩展，通常由页面布局层传入。
 * @param text 印章可访问文本及 `<title>` 内容，兼顾视觉与无障碍语义。
 * @param size 图形宽高（保持正方形），用于适配不同模块密度。
 * @returns 一个可复用的 SVG 装饰图形节点。
 *
 * 设计原因：
 * - 使用 `currentColor`，让印章颜色跟随上下文主题色，不需在每处单独改 SVG 填充。
 * - 通过 `mix-blend` 在明暗主题下获得更柔和叠加效果，减少装饰元素对正文可读性的干扰。
 */
export function WenYuanSeal({ className, text = "文渊", size = 48 }: SealProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={cn("text-primary opacity-80 mix-blend-multiply", className)}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={text}
    >
      {/* `title` 是无障碍补充，屏幕阅读器可读，且在部分环境下会显示悬浮提示。 */}
      <title>{text}</title>
      {/* 外框：模拟印章边框，形成品牌轮廓。 */}
      <path
        d="M10,10 H90 V90 H10 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* 内圆：增强“印章”识别度。 */}
      <circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" strokeWidth="2" />
      {/* 主体笔画：通过几何线条简化“篆刻”视觉。 */}
      <path d="M30,30 L70,30 M50,30 L50,70 M30,70 L70,70" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      {/* 角落噪点：弱化“过于机械”的矢量感，模拟印章肌理。 */}
      <circle cx="20" cy="20" r="1" fill="currentColor" opacity="0.5" />
      <circle cx="80" cy="80" r="2" fill="currentColor" opacity="0.3" />
    </svg>
  );
}
