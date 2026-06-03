FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
RUN chown -R bun:bun /app
USER bun
CMD ["bun", "run", "agent/index.ts"]
