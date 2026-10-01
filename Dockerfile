# syntax=docker/dockerfile:1
# Multi-stage build on the current Node LTS (CLAUDE.md 2). The server runs straight
# from TypeScript (Node type stripping), so the runtime image keeps the workspace
# layout: @funnel/shared is a symlink outside node_modules, where stripping is allowed.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm version comes only from package.json#packageManager.
RUN npm install -g corepack@latest && corepack enable
WORKDIR /app

# Manifests first so dependency layers are cached across source-only changes.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @funnel/web build

FROM manifests AS prod-deps
ARG TARGETARCH
RUN pnpm install --frozen-lockfile --prod --filter "@funnel/server..."
# better-sqlite3 ships prebuilds for 8 platforms plus the SQLite sources (~27 MB);
# keep only the glibc binary for this image's architecture.
RUN arch="$([ "$TARGETARCH" = "arm64" ] && echo arm64 || echo x64)" \
  && for pkg in node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3; do \
       rm -rf "$pkg/deps" "$pkg/src" "$pkg/binding.gyp" \
       && find "$pkg/prebuilds" -type f ! -name "linux-$arch.node" -delete; \
     done \
  && test -n "$(ls node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/prebuilds/linux-$arch.node)"

# Runs as root on purpose: Railway mounts the volume root-owned (RAILWAY_RUN_UID=0 is
# set as a belt-and-braces default, see docs/DECISIONS.md).
# Starts from the plain Node image: no pnpm, corepack or npm at runtime.
FROM node:24-slim AS runtime
WORKDIR /app
# tini as PID 1: forwards SIGTERM and lets the default action kill node even before
# node has registered its own handlers (a bare PID 1 ignores unhandled SIGTERM).
RUN apt-get update && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules /usr/local/include \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/funnel.db \
    WEB_DIST=/app/apps/web/dist
COPY --from=prod-deps /app ./
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
COPY apps/server/drizzle apps/server/drizzle
COPY configs configs
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/src/main.ts"]
