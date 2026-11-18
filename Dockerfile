# syntax=docker/dockerfile:1.4
# ==============================================================================
# Production Multi-Stage Dockerfile for GS-ClientFlow
# Optimized for Bun build & Node.js 22 LTS standalone execution
# ==============================================================================

# Stage 1: Dependency resolution with frozen lockfile
FROM oven/bun:1.4.4-alpine AS deps
WORKDIR /app

# Install build tools if needed
RUN apk add --no-cache libc6-compat

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# Stage 2: Application compilation & standalone output generation
FROM oven/bun:1.4.4-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Generate Prisma Client for database bindings
RUN bun run db:generate

# Build Next.js standalone application
RUN bun run build

# Stage 3: Minimal production runtime
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Non-root unprivileged service account
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy static assets and standalone server package
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/db/migrations ./src/db/migrations

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/auth/me || exit 1

CMD ["node", "server.js"]
