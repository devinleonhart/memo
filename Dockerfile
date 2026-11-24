FROM node:24.8.0-alpine3.21 AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile

COPY src ./src
RUN pnpm build

FROM node:24.8.0-alpine3.21 AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/dist ./dist

# Fixed ids, since the volume at /data belongs to them.
RUN addgroup -S -g 101 memo && adduser -S -u 100 memo -G memo && \
    mkdir -p /data/blackbook-spool && chown -R memo:memo /data
ENV MEMO_SPOOL_DIR=/data/blackbook-spool
USER memo

CMD ["node", "dist/index.js"]
