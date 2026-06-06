import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Lora } from 'next/font/google';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import './globals.css';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { ViewportObserver } from '@/components/ViewportObserver';
import { GlobalToast } from '@/components/GlobalToast';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  preload: false,
});

const geistMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
  preload: false,
});

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-lora',
  display: 'optional',
  preload: false,
});

// Noto Serif SC removed: was generating ~120 woff2 subsets (6.5 MB) + 208 KB @font-face CSS
// while `subsets: ['latin']` was ineffective for CJK. Now relying on system CJK serif
// fallbacks ('Songti SC', 'STSong', 'SimSun', 'Noto Serif SC' if locally installed)
// in the --font-reading stack — zero woff2 downloads for CJK serif.

const criticalCss = readFileSync(path.join(process.cwd(), 'app/globals-critical.css'), 'utf8');

const IOS_STARTUP_IMAGES = [
  {
    url: '/icons/splash-640x1136.png',
    media:
      '(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
  },
  {
    url: '/icons/splash-750x1334.png',
    media:
      '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
  },
  {
    url: '/icons/splash-828x1792.png',
    media:
      '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
  },
  {
    url: '/icons/splash-1125x2436.png',
    media:
      '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)',
  },
  {
    url: '/icons/splash-1170x2532.png',
    media:
      '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)',
  },
  {
    url: '/icons/splash-1179x2556.png',
    media:
      '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)',
  },
  {
    url: '/icons/splash-1284x2778.png',
    media:
      '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)',
  },
  {
    url: '/icons/splash-1290x2796.png',
    media:
      '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)',
  },
  {
    url: '/icons/splash-1536x2048.png',
    media:
      '(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
  },
  {
    url: '/icons/splash-1668x2224.png',
    media:
      '(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
  },
  {
    url: '/icons/splash-1668x2388.png',
    media:
      '(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
  },
  {
    url: '/icons/splash-2048x2732.png',
    media:
      '(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
  },
];

export const metadata: Metadata = {
  title: 'Compound · 让 AI 维护你的知识库',
  description:
    '基于 LLM Wiki 理念的笔记应用 — 你只管喂资料，AI 在后台当编辑，把原文编译成一部相互链接、持续生长的知识 Wiki。',
  applicationName: 'Compound',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Compound',
    startupImage: IOS_STARTUP_IMAGES,
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/favicon-32x32.png',
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#c96442',
    'msapplication-TileImage': '/icons/icon-144x144.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f5' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1a18' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} ${lora.variable}`}
    >
      <head>
        <style data-compound-critical-css="" dangerouslySetInnerHTML={{ __html: criticalCss }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
  try {
    var theme = localStorage.getItem('compound_theme');
    if (theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
    var fs = localStorage.getItem('compound_font_size');
    var fsMap = {xs:14,sm:15,md:16,lg:18,xl:20};
    if (fs && fsMap[fs]) {
      document.documentElement.style.setProperty('--prose-font-size', fsMap[fs] + 'px');
    }
    var lh = localStorage.getItem('compound_line_height');
    var lhMap = {compact:1.5,standard:1.7,relaxed:1.9};
    if (lh && lhMap[lh]) {
      document.documentElement.style.setProperty('--prose-line-height', String(lhMap[lh]));
    }
  } catch(e) {}
`,
          }}
        />
      </head>
      <body>
        {children}
        <GlobalToast />
        <ViewportObserver />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
