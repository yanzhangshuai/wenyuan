import type { Metadata } from "next";
import localFont from "next/font/local";

import { ClientThemeBackground, ThemeProvider } from "@/components/theme";
import { Toaster } from "@/components/ui/sonner";
import { THEME_IDS } from "@/theme";

import "./globals.css";

/**
 * 等宽字体（JetBrains Mono），仅用于代码与数据展示区域。
 * 走 next/font/local 以获得自动 preload 与体积优化。
 */
const monoFont = localFont({
  src     : "../assets/fonts/jetbrains-mono/JetBrainsMono-Variable.woff2",
  variable: "--font-jetbrains-mono",
  display : "swap",
  fallback: ["monospace"]
});

export const metadata: Metadata = {
  title: {
    default : "文渊 — AI 小说人物关系图谱",
    template: "%s — 文渊"
  },
  description: "上传小说，自动解析人物与关系，生成可交互的人物关系图谱",
  openGraph  : {
    title      : "文渊 — AI 小说人物关系图谱",
    description: "上传小说，自动解析人物与关系，生成可交互的人物关系图谱",
    siteName   : "文渊",
    type       : "website"
  }
};

/**
 * 应用根布局。
 *
 * 约束：
 * - 本文件是 Server Component，不得添加 "use client"；
 * - 全局 provider 已封装在客户端壳 `ThemeProvider` 内，此处只做组装。
 */
export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={monoFont.variable}
    >
      <body className="font-serif antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="danqing"
          themes={[...THEME_IDS]}
          enableSystem={false}
          storageKey="wenyuan-v3-theme"
        >
          <Toaster position="top-right" richColors closeButton />
          {children}
          <ClientThemeBackground />
        </ThemeProvider>
      </body>
    </html>
  );
}
