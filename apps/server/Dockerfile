# Game server image. Build from the repo root: docker build -f apps/server/Dockerfile .
# Only the server and the shared rules are installed; the client ships separately (Vercel).
FROM node:22-slim AS base
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Dependencies first, so source edits don't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN pnpm install --frozen-lockfile --filter @cop/server...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server

ENV NODE_ENV=production PORT=2567
EXPOSE 2567
USER node
WORKDIR /app/apps/server
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:2567/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["/app/node_modules/.bin/tsx", "src/index.ts"]
