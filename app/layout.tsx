import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Lora, Noto_Serif_SC } from 'next/font/google';
import './globals.css';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { ViewportObserver } from '@/components/ViewportObserver';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const geistMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-lora',
  display: 'swap',
});

const notoSerifSC = Noto_Serif_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-serif-sc',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Compound · 让 AI 维护你的知识库',
  description:
    '基于 LLM Wiki 理念的笔记应用 — 你只管喂资料，AI 在后台当编辑，把原文编译成一部相互链接、持续生长的知识 Wiki。',
  applicationName: 'Compound',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Compound',
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
      className={`${inter.variable} ${geistMono.variable} ${lora.variable} ${notoSerifSC.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
  try {
    var theme = localStorage.getItem('compound_theme');
    if (theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch(e) {}
`,
          }}
        />
      </head>
      <body>
        {children}
        <ViewportObserver />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
