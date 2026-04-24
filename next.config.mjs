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
  // better-sqlite3 is a native module — keep it external so webpack doesn't try to bundle it.
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    serverActions: { allowedOrigins },
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

export default nextConfig;
