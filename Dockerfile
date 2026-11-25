# syntax=docker/dockerfile:1

# --- shared base: pnpm + manifests ---
FROM node:26.13.1-alpine AS base
RUN npm install -g pnpm@12.23.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# --- build: full install + compile to dist ---
FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY ./src ./src
RUN pnpm build

# --- prod-deps: production-only node_modules ---
FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile

# --- runtime: slim, non-root, no toolchain or source ---
FROM node:26.13.1-alpine AS runtime
ENV NODE_ENV=production \
    MEMO_SPOOL_DIR=/data/blackbook-spool
WORKDIR /app
# Fixed ids, since the volume at /data belongs to them.
RUN addgroup -S -g 101 memo && adduser -S -u 100 memo -G memo && \
    mkdir -p /data/blackbook-spool && chown -R memo:memo /data
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER memo
CMD ["node", "./dist/index.js"]
