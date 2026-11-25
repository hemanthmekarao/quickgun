# Build from the homeos/ directory:  docker build -f apps/api/Dockerfile -t homeos-api .
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund --workspace @homeos/shared --workspace @homeos/api --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @homeos/shared \
 && npm run prisma:generate -w @homeos/api \
 && npm run build -w @homeos/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --create-home homeos
COPY --from=build /app /app
RUN mkdir -p /app/apps/api/storage && chown -R homeos:homeos /app/apps/api/storage
USER homeos
WORKDIR /app/apps/api
EXPOSE 4000
# Applies the schema, then starts the API. See docs/DEPLOYMENT.md before using `db push` on a database with data.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/main.js"]
