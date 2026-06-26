FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && \
    apk add --no-cache curl openssl openssl-dev tzdata

WORKDIR /app

# Copy workspace files for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/api/package.json ./packages/api/
RUN pnpm install --no-frozen-lockfile

# Copy Prisma schema and generate client
COPY packages/api/prisma ./packages/api/prisma
RUN cd packages/api && ./node_modules/.bin/prisma generate

# Copy source
COPY packages/api/src ./packages/api/src
COPY packages/api/tsconfig.json ./packages/api/

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

CMD sh -c "cd packages/api && ./node_modules/.bin/prisma db push --accept-data-loss && cd /app && pnpm --filter @qaasr/api dev"
