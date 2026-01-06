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

RUN addgroup -S memo && adduser -S memo -G memo
USER memo

CMD ["node", "dist/index.js"]
