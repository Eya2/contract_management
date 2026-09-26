# syntax=docker/dockerfile:1
# Contract Hub web app, served by nginx. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t contract-hub-web .

# --- 1. Build the Angular app ---------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @cms/web --workspace @cms/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @cms/shared && npm run build -w @cms/web

# --- 2. Serve it -------------------------------------------------------------------------
FROM nginx:1.29-alpine AS runtime
# API_UPSTREAM: where nginx forwards /api (the API container in docker compose).
ENV API_UPSTREAM=http://api:3000
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
