# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

# Build
FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL

# Sentry. NEXT_PUBLIC_* are inlined into the bundles at BUILD time (they are not
# read from .env.local at runtime), so they must arrive as build args or the
# deployed image reports to nothing. SENTRY_ORG/PROJECT are only used by the
# source-map uploader and are not secrets.
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ARG NEXT_PUBLIC_SENTRY_RELEASE
ARG SENTRY_ORG
ARG SENTRY_PROJECT
# Advanced filters kill switch (docs/ADVANCED-FILTERS-BRIEF.md Phase 3.5). Same
# inlined-at-build-time rule as the rest of this block — undefined here means
# the deployed bundle renders the legacy toolbar regardless of runtime env.
ARG NEXT_PUBLIC_ADVANCED_FILTERS

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_PUBLIC_SENTRY_RELEASE=$NEXT_PUBLIC_SENTRY_RELEASE
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
ENV NEXT_PUBLIC_ADVANCED_FILTERS=$NEXT_PUBLIC_ADVANCED_FILTERS
ENV NODE_OPTIONS="--max-old-space-size=6144"

# SENTRY_AUTH_TOKEN is a real credential, so it rides a BuildKit secret mount
# rather than an ARG — an ARG would be baked into the image layer metadata and
# shipped to the registry with every push. Absent token => build still succeeds,
# it just skips source-map upload.
RUN --mount=type=cache,target=/app/.next/cache \
    --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    npm run build

# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
