# Build stage
FROM oven/bun:1 AS builder

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN bun install

# Copy source
COPY . .

# Runtime stage
FROM oven/bun:1-slim

WORKDIR /app

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun

CMD ["bun", "run", "agent/index.ts"]
