"use client";

import * as React from "react";

/**
 * =============================================================================
 * 文件定位（主题装饰层 - 星空粒子背景）
 * -----------------------------------------------------------------------------
 * 文件路径：`src/components/theme/decorative/star-dust.tsx`
 *
 * 在 Next.js 架构中的职责：
 * - 这是纯视觉增强用的 Client Component，运行在浏览器 Canvas；
 * - 不参与业务数据读写，不影响路由语义，仅作为主题“xingkong”动态背景层。
 *
 * 为什么必须 `use client`：
 * - 依赖 `window` 尺寸、`requestAnimationFrame`、Canvas 2D API；
 * - 这些能力仅在浏览器可用，无法在 Server Component 中执行。
 *
 * 维护约束：
 * - 这里的参数（星点密度、星云透明度、流星频率）是视觉平衡结果；
 * - 若要调整，请重点验证性能开销和文字可读性，避免“好看但影响前景内容”。
 * =============================================================================
 */

interface StarData {
  /** 星点横坐标（像素）。 */
  x    : number;
  /** 星点纵坐标（像素）。 */
  y    : number;
  /** 星点半径，用于控制亮度主视觉。 */
  r    : number;
  /** 基础透明度，决定该星点“常亮”程度。 */
  baseA: number;
  /** 当前闪烁相位。 */
  phase: number;
  /** 闪烁速度，值越大变化越快。 */
  speed: number;
  /** RGB 通道，主题化星色。 */
  cr   : number;
  cg   : number;
  cb   : number;
}

interface NebulaData {
  /** 星云中心点坐标。 */
  x     : number;
  y     : number;
  /** 星云扩散半径。 */
  radius: number;
  /** 星云颜色。 */
  cr    : number;
  cg    : number;
  cb    : number;
  /** 星云透明度上限。 */
  a     : number;
}

interface MeteorData {
  /** 流星头部起点坐标。 */
  x    : number;
  y    : number;
  /** 轨迹长度。 */
  len  : number;
  /** 飞行角度（弧度）。 */
  angle: number;
  /** 飞行速度。 */
  spd  : number;
  /** 当前透明度。 */
  a    : number;
  /** 当前尾迹长度。 */
  tail : number;
  /** 是否处于激活飞行态。 */
  on   : boolean;
}

/** 星云颜色（RGB 三通道）。 */
interface NebulaColor {
  cr: number;
  cg: number;
  cb: number;
}

const NEBULA_COLORS: readonly NebulaColor[] = [
  { cr: 84, cg: 126, cb: 196 },  // deep blue
  { cr: 102, cg: 96, cb: 182 },  // violet
  { cr: 70, cg: 156, cb: 164 },  // teal
  { cr: 166, cg: 96, cb: 164 }   // soft magenta
];

/** 兜底色：`noUncheckedIndexedAccess` 下数组索引访问可能为 undefined。 */
const DEFAULT_NEBULA_COLOR: NebulaColor = { cr: 84, cg: 126, cb: 196 };

function pickNebulaColor(): NebulaColor {
  return NEBULA_COLORS[Math.floor(Math.random() * NEBULA_COLORS.length)] ?? DEFAULT_NEBULA_COLOR;
}

export function StarDust() {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const raf = React.useRef(0);

  React.useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let stars: StarData[] = [];
    let nebulae: NebulaData[] = [];
    const meteors: MeteorData[] = [];
    let meteorCD = 0;

    function resize() {
      if (!cvs) return;
      W = cvs.width = window.innerWidth;
      H = cvs.height = window.innerHeight;
      // 尺寸变化后重建粒子，避免拉伸导致噪点密度异常。
      init();
    }

    function init() {
      // 星点密度按屏幕面积线性增长，保持不同设备观感接近。
      const count = Math.floor((W * H) / 5600);
      stars = [];

      for (let i = 0; i < count; i++) {
        // 少量高亮星点用于制造层次，避免全体同亮度造成“噪点墙”。
        const bright = Math.random() < 0.05;
        const z = Math.random();

        const r = bright
          ? Math.random() * 1.08 + 0.86
          : z > 0.7
            ? Math.random() * 0.56 + 0.22
            : Math.random() * 0.30 + 0.08;

        const baseA = bright
          ? Math.random() * 0.2 + 0.34
          : z * 0.18 + Math.random() * 0.12;

        const roll = Math.random();
        let cr: number;
        let cg: number;
        let cb: number;

        if (roll < 0.56) {
          cr = 188 + Math.random() * 26;
          cg = 212 + Math.random() * 22;
          cb = 255;
        } else if (roll < 0.82) {
          cr = 148 + Math.random() * 28;
          cg = 196 + Math.random() * 28;
          cb = 255;
        } else if (roll < 0.94) {
          cr = 206 + Math.random() * 18;
          cg = 166 + Math.random() * 16;
          cb = 246 + Math.random() * 8;
        } else {
          cr = 232 + Math.random() * 10;
          cg = 194 + Math.random() * 14;
          cb = 160 + Math.random() * 14;
        }

        stars.push({
          x    : Math.random() * W,
          y    : Math.random() * H,
          r,
          baseA,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.015 + 0.004,
          cr,
          cg,
          cb
        });
      }

      nebulae = [];
      // 第一层：随机散点星云，提供弱背景氛围。
      const scatterCount = Math.floor(W / 380);
      for (let i = 0; i < scatterCount; i++) {
        nebulae.push({
          x     : Math.random() * W,
          y     : Math.random() * H,
          radius: Math.random() * 220 + 120,
          ...pickNebulaColor(),
          a     : Math.random() * 0.013 + 0.006
        });
      }

      // 第二层：斜向带状星云，增强“银河”方向感。
      const bandCount = Math.floor(W / 200);
      for (let i = 0; i < bandCount; i++) {
        const t = i / bandCount;
        nebulae.push({
          x     : W * t + (Math.random() - 0.5) * 110,
          y     : H * 0.3 + H * 0.4 * t + (Math.random() - 0.5) * 130,
          radius: Math.random() * 142 + 70,
          ...pickNebulaColor(),
          a     : Math.random() * 0.014 + 0.007
        });
      }

      // 流星数量固定为低频少量，避免喧宾夺主。
      meteors.length = 0;
      for (let i = 0; i < 2; i++) {
        meteors.push({
          x    : 0,
          y    : 0,
          len  : 0,
          angle: 0,
          spd  : 0,
          a    : 0,
          tail : 0,
          on   : false
        });
      }
    }

    function spawnMeteor(m: MeteorData) {
      m.x = Math.random() * W * 0.8;
      m.y = Math.random() * H * 0.3;
      m.len = Math.random() * 180 + 90;
      m.angle = (15 + Math.random() * 25) * Math.PI / 180;
      m.spd = Math.random() * 6 + 3.6;
      m.a = 0;
      m.tail = 0;
      m.on = true;
    }

    function tick() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);

      for (const n of nebulae) {
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.radius);
        g.addColorStop(0, `rgba(${n.cr}, ${n.cg}, ${n.cb}, ${n.a})`);
        g.addColorStop(0.5, `rgba(${n.cr}, ${n.cg}, ${n.cb}, ${n.a * 0.4})`);
        g.addColorStop(1, "rgba(0,0,0,0)");

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }

      for (const s of stars) {
        s.phase += s.speed;
        const twinkle = Math.sin(s.phase) * 0.2 + 0.68;
        const a = s.baseA * twinkle;

        if (s.r > 0.8) {
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4);
          g.addColorStop(0, `rgba(${s.cr}, ${s.cg}, ${s.cb}, ${a * 0.24})`);
          g.addColorStop(0.4, `rgba(${s.cr}, ${s.cg}, ${s.cb}, ${a * 0.08})`);
          g.addColorStop(1, "rgba(0,0,0,0)");

          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.cr}, ${s.cg}, ${s.cb}, ${a})`;
        ctx.fill();
      }

      meteorCD++;
      if (meteorCD > 360 && Math.random() < 0.007) {
        const idle = meteors.find((meteor) => !meteor.on);
        if (idle) {
          spawnMeteor(idle);
          meteorCD = 0;
        }
      }

      for (const m of meteors) {
        if (!m.on) continue;

        m.tail = Math.min(m.tail + m.spd * 2.5, m.len);
        m.x += Math.cos(m.angle) * m.spd;
        m.y += Math.sin(m.angle) * m.spd;
        m.a = m.tail < m.len * 0.25
          ? Math.min(1, m.a + 0.08)
          : m.tail > m.len * 0.7
            ? Math.max(0, m.a - 0.04)
            : m.a;

        if (m.a <= 0 && m.tail >= m.len) {
          m.on = false;
          continue;
        }

        const ex = m.x + Math.cos(m.angle) * m.tail;
        const ey = m.y + Math.sin(m.angle) * m.tail;
        const g = ctx.createLinearGradient(m.x, m.y, ex, ey);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.3, `rgba(178, 206, 246, ${m.a * 0.2})`);
        g.addColorStop(1, `rgba(238, 244, 255, ${m.a * 0.58})`);

        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.1;
        ctx.lineCap = "round";
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(ex, ey, 1.35, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${m.a})`;
        ctx.fill();
      }

      raf.current = requestAnimationFrame(tick);
    }

    resize();
    window.addEventListener("resize", resize);
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); window.removeEventListener("resize", resize); };
  }, []);

  return (
    <canvas
      ref={ref}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ background: "linear-gradient(to bottom, #030508 0%, #090c16 50%, #040710 100%)" }}
      aria-hidden="true"
    />
  );
}
