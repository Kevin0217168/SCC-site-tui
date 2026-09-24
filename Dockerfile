# ---- Build Stage ----
FROM oven/bun:1 AS builder

WORKDIR /app

# Install dependencies first (better layer caching)
# 注意：Bun 1.2+ 的锁文件是文本格式的 bun.lock，不再是 bun.lockb
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source and build
COPY tsconfig.json build.ts ./
COPY src/ ./src/
RUN bun run build

# ---- Runtime Stage ----
FROM oven/bun:1-slim

WORKDIR /app

# Copy built output and dependencies
COPY --from=builder /app/dist/ ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/package.json ./

# Generate host key directory (will be overridden by volume in compose)
RUN mkdir -p .keys

EXPOSE 2222

ENV PORT=2222

CMD ["bun", "run", "index.js"]
