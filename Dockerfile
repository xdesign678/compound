FROM node:22.11-alpine3.20 AS base

# Install dependencies only when needed.
# better-sqlite3 is a native module — needs python3/make/g++ to build from source.
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ sqlite
COPY package.json package-lock.json* ./
RUN npm ci

# Build the application
FROM base AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ sqlite
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Runtime: sqlite3 shared library (native binding loads libsqlite3).
RUN apk add --no-cache sqlite-libs

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Next.js standalone output doesn't include native modules listed in
# `serverExternalPackages`; ship them explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Persistent data directory for SQLite (should be backed by a mounted volume in production).
RUN mkdir -p /data && chown -R nextjs:nodejs /data
ENV DATA_DIR=/data

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
