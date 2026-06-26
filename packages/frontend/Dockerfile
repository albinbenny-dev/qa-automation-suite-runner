# ── Stage 1: Build ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy manifests only so source changes don't bust the install layer
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/api/package.json ./packages/api/
COPY packages/runner/package.json ./packages/runner/
RUN pnpm install --frozen-lockfile

COPY packages/frontend ./packages/frontend
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm --filter @qaasr/frontend build

# ── Stage 2: Serve ─────────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# Nginx config is mounted via docker-compose (nginx/nginx.conf → /etc/nginx/conf.d/default.conf)

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
