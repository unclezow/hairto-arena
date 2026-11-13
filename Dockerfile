# One image for the three backend processes (api, worker, indexer); compose picks the command and working dir.
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/config packages/config
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/indexer/package.json apps/indexer/
RUN pnpm install --frozen-lockfile --filter @hairto-arena/config --filter @hairto-arena/shared --filter @hairto-arena/api --filter @hairto-arena/indexer

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/indexer apps/indexer
COPY deployments deployments

RUN pnpm --filter @hairto-arena/shared build \
    && DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @hairto-arena/api db:generate \
    && pnpm --filter @hairto-arena/api build \
    && pnpm --filter @hairto-arena/indexer build

ENV NODE_ENV=production
