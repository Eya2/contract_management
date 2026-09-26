# syntax=docker/dockerfile:1
# Contract Hub API. Build from the repository root (npm workspaces):
#   docker build -f apps/api/Dockerfile -t contract-hub-api .

# --- 1. Build: install everything, generate the Prisma client, compile ------------
FROM node:24-slim AS build
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @cms/api --workspace @cms/shared --include-workspace-root

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @cms/shared
# `prisma generate` reads prisma.config.ts, which needs a DATABASE_URL to exist (it isn't used).
RUN cd apps/api && DATABASE_URL=postgresql://build@localhost/build npx prisma generate && npm run build

# --- 2. Production dependencies only -------------------------------------------------
FROM node:24-slim AS deps
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# `prisma` (a dev dependency) is kept: the container applies migrations on start.
RUN npm ci --workspace @cms/api --workspace @cms/shared --omit=dev \
 && npm install --no-save --workspace @cms/api prisma@$(node -p "require('./apps/api/package.json').devDependencies.prisma")

# --- 3. Runtime -------------------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_LOCAL_ROOT=/data/storage
# npm workspaces hoist every dependency to the root node_modules.
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Uploaded documents and signatures live on a volume, owned by the unprivileged user.
RUN mkdir -p /data/storage && chown -R node:node /data \
 && chmod +x /usr/local/bin/docker-entrypoint.sh
USER node
WORKDIR /app/apps/api
VOLUME ["/data/storage"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
