import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSentryConfig } from '@sentry/nextjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';

// Comma-separated list in env takes precedence. Fall back to safe defaults for
// local dev + the canonical zeabur deployment so first-run still works.
const allowedOrigins = (process.env.COMPOUND_ALLOWED_ORIGINS || 'localhost:8080,zhishiku.zeabur.app')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const connectSrc = isDev
  ? "connect-src 'self' ws: wss:"
  : "connect-src 'self'";

const csp = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  connectSrc,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  // Production source maps are required for Sentry to symbolicate stack
  // traces. The Sentry plugin (withSentryConfig) automatically uploads and
  // then deletes them from the public bundle when an auth token is present.
  productionBrowserSourceMaps: true,
  // Native / Rust-binding modules — keep external so webpack doesn't try to
  // bundle their `.node` artifacts.
  serverExternalPackages: ['better-sqlite3', '@node-rs/jieba'],
  experimental: {
    serverActions: { allowedOrigins },
    // Tree-shake & on-demand compile imports from large icon/util packages so
    // the client bundle only pulls the symbols actually referenced. Docs:
    // https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports
    optimizePackageImports: ['lucide-react', 'dexie', 'dexie-react-hooks', 'zustand'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

// Sentry build-time integration: uploads source maps so production stack
// traces are mapped back to the original TypeScript, tunnels client-side
// requests through `/monitoring` to dodge ad-blockers, and tree-shakes the
// SDK logger in production.
//
// All options are intentionally inert when the matching env vars are absent
// (no SENTRY_AUTH_TOKEN -> no upload, no DSN -> SDK is a no-op), so the
// repository continues to build cleanly without Sentry credentials.
const sentryWebpackPluginOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Only upload source maps when we have an auth token; otherwise the plugin
  // would emit noisy warnings on every build.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
  tunnelRoute: '/monitoring',
  automaticVercelMonitors: false,
};

export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);
