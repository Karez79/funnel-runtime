# syntax=docker/dockerfile:1
# Multi-stage build on the current Node LTS (CLAUDE.md 2). The server runs straight
# from TypeScript (Node type stripping), so the runtime image keeps the workspace
# layout: @funnel/shared is a symlink outside node_modules, where stripping is allowed.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@11.21.0
WORKDIR /app

# Native build tools only in the install stages, never in the runtime image.
FROM base AS toolchain
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

FROM toolchain AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @funnel/web build

FROM toolchain AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts=false --filter "@funnel/server..."

FROM base AS runtime
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
CMD ["node", "apps/server/src/main.ts"]
