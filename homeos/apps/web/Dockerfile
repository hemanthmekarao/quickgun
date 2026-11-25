# Build from the homeos/ directory:  docker build -f apps/web/Dockerfile -t homeos-web .
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm install --no-audit --no-fund --workspace @homeos/shared --workspace @homeos/web --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
# API_URL is read at build time for the /api proxy rule; override with --build-arg.
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
RUN npm run build -w @homeos/shared && npm run build -w @homeos/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN useradd --system --uid 10001 --create-home homeos
COPY --from=build /app /app
USER homeos
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
