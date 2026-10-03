import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Serif_SC } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* 展示宋体：品牌大字与仪式字（胜/负/和）专用；CJK 字体按 unicode-range 分片加载，关闭 preload */
const notoSerifSC = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  preload: false,
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "五子 · 极简联机五子棋",
  description: "极简画风的联机五子棋，创建房间把链接或二维码发给微信好友，即可立刻对弈。",
  keywords: ["五子棋", "联机对弈", "微信好友", "Gomoku", "极简"],
  icons: {
    icon: [
      { url: "/gomoku-icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icon-512.png",
  },
  appleWebApp: {
    capable: true,
    title: "五子",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "五子 · 极简联机五子棋",
    description: "创建房间，把链接发给微信好友，即刻对弈。",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#191715" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoSerifSC.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
