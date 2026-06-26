# ── Stage 1: Build ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps standalone (no pnpm workspace needed for frontend)
COPY packages/frontend/package.json ./package.json
RUN npm install --legacy-peer-deps

# Copy source and build
COPY packages/frontend ./
RUN NODE_OPTIONS="--max-old-space-size=4096" npm run build

# ── Stage 2: Serve ─────────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config is mounted via docker-compose
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
