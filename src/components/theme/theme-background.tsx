"use client";

import * as React from "react";

import { useHydratedTheme } from "@/hooks/use-hydrated-theme";

interface StarData {
  x    : number;
  y    : number;
  r    : number;
  baseA: number;
  phase: number;
  speed: number;
  cr   : number;
  cg   : number;
  cb   : number;
}

interface NebulaData {
  x     : number;
  y     : number;
  radius: number;
  cr    : number;
  cg    : number;
  cb    : number;
  a     : number;
}

interface MeteorData {
  x    : number;
  y    : number;
  len  : number;
  angle: number;
  spd  : number;
  a    : number;
  tail : number;
  on   : boolean;
}

/** 星云颜色（RGB 三通道）。 */
interface NebulaColor {
  cr: number;
  cg: number;
  cb: number;
}

const NEBULA_COLORS: readonly NebulaColor[] = [
  { cr: 90, cg: 130, cb: 200 },
  { cr: 150, cg: 90, cb: 170 },
  { cr: 70, cg: 150, cb: 150 },
  { cr: 170, cg: 110, cb: 150 },
  { cr: 90, cg: 170, cb: 130 }
];

/** 兜底色：`noUncheckedIndexedAccess` 下数组索引访问可能为 undefined。 */
const DEFAULT_NEBULA_COLOR: NebulaColor = { cr: 90, cg: 130, cb: 200 };

function pickNebulaColor(): NebulaColor {
  return NEBULA_COLORS[Math.floor(Math.random() * NEBULA_COLORS.length)] ?? DEFAULT_NEBULA_COLOR;
}

function StarfieldCanvas() {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const raf = React.useRef(0);

  React.useEffect(() => {
    const canvasNode = ref.current;
    if (!canvasNode) {
      return;
    }
    const canvasElement: HTMLCanvasElement = canvasNode;

    const contextNode = canvasElement.getContext("2d");
    if (!contextNode) {
      return;
    }
    const context2d: CanvasRenderingContext2D = contextNode;

    let width = 0;
    let height = 0;
    let stars: StarData[] = [];
    let nebulae: NebulaData[] = [];
    const meteors: MeteorData[] = [];
    let meteorCooldown = 0;

    function init() {
      const count = Math.floor((width * height) / 3000);
      stars = [];

      for (let index = 0; index < count; index += 1) {
        const bright = Math.random() < 0.045;
        const depth = Math.random();
        const radius = bright
          ? Math.random() * 1.1 + 0.85
          : depth > 0.7
            ? Math.random() * 0.7 + 0.3
            : Math.random() * 0.4 + 0.1;
        const baseAlpha = bright ? Math.random() * 0.16 + 0.34 : depth * 0.24 + Math.random() * 0.12;

        const roll = Math.random();
        let cr: number;
        let cg: number;
        let cb: number;

        if (roll < 0.35) {
          cr = 180 + Math.random() * 40;
          cg = 210 + Math.random() * 30;
          cb = 255;
        } else if (roll < 0.55) {
          cr = 255;
          cg = 248 + Math.random() * 7;
          cb = 240 + Math.random() * 15;
        } else if (roll < 0.75) {
          cr = 255;
          cg = 230 + Math.random() * 20;
          cb = 190 + Math.random() * 40;
        } else if (roll < 0.9) {
          cr = 255;
          cg = 200 + Math.random() * 30;
          cb = 140 + Math.random() * 30;
        } else {
          cr = 255;
          cg = 160 + Math.random() * 30;
          cb = 120 + Math.random() * 30;
        }

        stars.push({
          x    : Math.random() * width,
          y    : Math.random() * height,
          r    : radius,
          baseA: baseAlpha,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.015 + 0.004,
          cr,
          cg,
          cb
        });
      }

      nebulae = [];
      const scatterCount = Math.floor(width / 220);

      for (let index = 0; index < scatterCount; index += 1) {
        nebulae.push({
          x     : Math.random() * width,
          y     : Math.random() * height,
          radius: Math.random() * 280 + 120,
          ...pickNebulaColor(),
          a     : Math.random() * 0.006 + 0.002
        });
      }

      const bandCount = Math.floor(width / 90);

      for (let index = 0; index < bandCount; index += 1) {
        const progress = index / bandCount;

        nebulae.push({
          x     : width * progress + (Math.random() - 0.5) * 150,
          y     : height * 0.3 + height * 0.4 * progress + (Math.random() - 0.5) * 180,
          radius: Math.random() * 200 + 80,
          ...pickNebulaColor(),
          a     : Math.random() * 0.008 + 0.003
        });
      }

      meteors.length = 0;
      for (let index = 0; index < 4; index += 1) {
        meteors.push({ x: 0, y: 0, len: 0, angle: 0, spd: 0, a: 0, tail: 0, on: false });
      }
    }

    function resize() {
      width = canvasElement.width = window.innerWidth;
      height = canvasElement.height = window.innerHeight;
      init();
    }

    function spawnMeteor(meteor: MeteorData) {
      meteor.x = Math.random() * width * 0.8;
      meteor.y = Math.random() * height * 0.3;
      meteor.len = Math.random() * 200 + 100;
      meteor.angle = (15 + Math.random() * 25) * Math.PI / 180;
      meteor.spd = Math.random() * 7 + 4;
      meteor.a = 0;
      meteor.tail = 0;
      meteor.on = true;
    }

    function tick() {
      context2d.clearRect(0, 0, width, height);

      for (const nebula of nebulae) {
        const gradient = context2d.createRadialGradient(
          nebula.x,
          nebula.y,
          0,
          nebula.x,
          nebula.y,
          nebula.radius
        );

        gradient.addColorStop(0, `rgba(${nebula.cr}, ${nebula.cg}, ${nebula.cb}, ${nebula.a})`);
        gradient.addColorStop(0.5, `rgba(${nebula.cr}, ${nebula.cg}, ${nebula.cb}, ${nebula.a * 0.4})`);
        gradient.addColorStop(1, "rgba(0,0,0,0)");

        context2d.beginPath();
        context2d.arc(nebula.x, nebula.y, nebula.radius, 0, Math.PI * 2);
        context2d.fillStyle = gradient;
        context2d.fill();
      }

      for (const star of stars) {
        star.phase += star.speed;
        const twinkle = Math.sin(star.phase) * 0.3 + 0.7;
        const alpha = star.baseA * twinkle;

        if (star.r > 0.8) {
          const gradient = context2d.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.r * 4);
          gradient.addColorStop(0, `rgba(${star.cr}, ${star.cg}, ${star.cb}, ${alpha * 0.16})`);
          gradient.addColorStop(0.4, `rgba(${star.cr}, ${star.cg}, ${star.cb}, ${alpha * 0.05})`);
          gradient.addColorStop(1, "rgba(0,0,0,0)");

          context2d.beginPath();
          context2d.arc(star.x, star.y, star.r * 4, 0, Math.PI * 2);
          context2d.fillStyle = gradient;
          context2d.fill();
        }

        context2d.beginPath();
        context2d.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        context2d.fillStyle = `rgba(${star.cr}, ${star.cg}, ${star.cb}, ${alpha})`;
        context2d.fill();

        if (star.r > 1.5 && alpha > 0.55) {
          context2d.save();
          context2d.globalAlpha = alpha * 0.10;
          context2d.strokeStyle = `rgb(${star.cr}, ${star.cg}, ${star.cb})`;
          context2d.lineWidth = 0.5;

          const arm = star.r * 9;
          context2d.beginPath();
          context2d.moveTo(star.x - arm, star.y);
          context2d.lineTo(star.x + arm, star.y);
          context2d.stroke();

          context2d.beginPath();
          context2d.moveTo(star.x, star.y - arm);
          context2d.lineTo(star.x, star.y + arm);
          context2d.stroke();
          context2d.restore();
        }
      }

      meteorCooldown += 1;

      if (meteorCooldown > 200 && Math.random() < 0.015) {
        const idle = meteors.find((meteor) => !meteor.on);
        if (idle) {
          spawnMeteor(idle);
          meteorCooldown = 0;
        }
      }

      for (const meteor of meteors) {
        if (!meteor.on) {
          continue;
        }

        meteor.tail = Math.min(meteor.tail + meteor.spd * 2.5, meteor.len);
        meteor.x += Math.cos(meteor.angle) * meteor.spd;
        meteor.y += Math.sin(meteor.angle) * meteor.spd;
        meteor.a = meteor.tail < meteor.len * 0.25
          ? Math.min(1, meteor.a + 0.08)
          : meteor.tail > meteor.len * 0.7
            ? Math.max(0, meteor.a - 0.04)
            : meteor.a;

        if (meteor.a <= 0 && meteor.tail >= meteor.len) {
          meteor.on = false;
          continue;
        }

        const endX = meteor.x + Math.cos(meteor.angle) * meteor.tail;
        const endY = meteor.y + Math.sin(meteor.angle) * meteor.tail;
        const gradient = context2d.createLinearGradient(meteor.x, meteor.y, endX, endY);

        gradient.addColorStop(0, "rgba(255,255,255,0)");
        gradient.addColorStop(0.3, `rgba(200,230,255,${meteor.a * 0.12})`);
        gradient.addColorStop(1, `rgba(255,255,255,${meteor.a * 0.36})`);

        context2d.beginPath();
        context2d.moveTo(meteor.x, meteor.y);
        context2d.lineTo(endX, endY);
        context2d.strokeStyle = gradient;
        context2d.lineWidth = 1.8;
        context2d.lineCap = "round";
        context2d.stroke();

        context2d.beginPath();
        context2d.arc(endX, endY, 1.5, 0, Math.PI * 2);
        context2d.fillStyle = `rgba(255,255,255,${meteor.a})`;
        context2d.fill();
      }

      raf.current = requestAnimationFrame(tick);
    }

    resize();
    window.addEventListener("resize", resize);
    raf.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="theme-background-canvas fixed inset-0 z-0 pointer-events-none"
      style={{ background: "linear-gradient(to bottom, #000103 0%, #02040a 48%, #000208 100%)" }}
      aria-hidden="true"
    />
  );
}

function DanqingBackground() {
  return (
    <div
      className="theme-background-layer theme-background-layer-danqing fixed inset-0 z-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      <div
        className="absolute -top-32 -right-32 h-[600px] w-[600px] rounded-full opacity-[0.07]"
        style={{
          background: "radial-gradient(circle, oklch(0.55 0.18 25) 0%, transparent 70%)",
          filter    : "blur(60px)"
        }}
      />
      <div
        className="absolute -bottom-40 -left-20 h-[500px] w-[500px] rounded-full opacity-[0.05]"
        style={{
          background: "radial-gradient(circle, oklch(0.45 0.12 35) 0%, transparent 70%)",
          filter    : "blur(80px)"
        }}
      />
      <div
        className="absolute top-1/3 left-1/2 h-[400px] w-[800px] -translate-x-1/2 -translate-y-1/2 opacity-[0.03]"
        style={{
          background: "radial-gradient(ellipse, oklch(0.55 0.18 25) 0%, transparent 60%)",
          filter    : "blur(120px)"
        }}
      />
      <svg className="absolute inset-0 h-full w-full opacity-[0.025]" xmlns="http://www.w3.org/2000/svg">
        <filter id="ink-t">
          <feTurbulence type="turbulence" baseFrequency="0.012 0.008" numOctaves="6" seed="3" result="n" />
          <feColorMatrix type="saturate" values="0" in="n" result="g" />
          <feBlend in="SourceGraphic" in2="g" mode="multiply" />
        </filter>
        <rect width="100%" height="100%" filter="url(#ink-t)" fill="oklch(0.55 0.18 25)" />
      </svg>
    </div>
  );
}

function SuyaBackground() {
  return (
    <div
      className="theme-background-layer theme-background-layer-suya fixed inset-0 z-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      <svg className="absolute inset-0 h-full w-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
        <filter id="pg">
          <feTurbulence type="fractalNoise" baseFrequency="0.65 0.45" numOctaves="4" seed="8" result="n" />
          <feColorMatrix type="saturate" values="0" in="n" />
        </filter>
        <rect width="100%" height="100%" filter="url(#pg)" fill="oklch(0.45 0.10 160)" />
      </svg>
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: "repeating-linear-gradient(168deg, oklch(0.45 0.10 160) 0px, transparent 1px, transparent 80px)"
        }}
      />
      <div
        className="absolute -top-10 -right-10 h-[600px] w-[400px] opacity-[0.06]"
        style={{
          background: "radial-gradient(ellipse at top right, oklch(0.55 0.10 160) 0%, transparent 70%)",
          filter    : "blur(50px)"
        }}
      />
    </div>
  );
}

function DiancangBackground() {
  return (
    <div
      className="theme-background-layer theme-background-layer-diancang fixed inset-0 z-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      <div
        className="absolute top-0 right-0 h-[700px] w-[700px] opacity-[0.06]"
        style={{
          background: "radial-gradient(circle at 80% 10%, oklch(0.72 0.12 85) 0%, transparent 60%)",
          filter    : "blur(70px)"
        }}
      />
      <div
        className="absolute bottom-0 left-0 h-[500px] w-[600px] opacity-[0.05]"
        style={{
          background: "radial-gradient(ellipse at 0% 100%, oklch(0.60 0.10 70) 0%, transparent 60%)",
          filter    : "blur(90px)"
        }}
      />
      <svg className="absolute inset-0 h-full w-full opacity-[0.025]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="fret" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="40" height="40" fill="none" />
            <path d="M4,4 h8 v8 h-4 v-4 h4" stroke="oklch(0.72 0.12 85)" strokeWidth="0.8" fill="none" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#fret)" />
      </svg>
    </div>
  );
}

export function ThemeBackground() {
  const { selectedTheme } = useHydratedTheme();

  return (
    <>
      {selectedTheme === "xingkong" && <StarfieldCanvas />}
      {selectedTheme === "danqing" && <DanqingBackground />}
      {selectedTheme === "suya" && <SuyaBackground />}
      {selectedTheme === "diancang" && <DiancangBackground />}
    </>
  );
}
