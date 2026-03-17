# Ingestion container — startup
FROM oven/bun:1 AS builder

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN bun install

# Copy source
COPY ingestion/startup ./ingestion/startup
COPY src ./src

# Runtime stage
FROM oven/bun:1-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/ingestion/startup ./ingestion/startup
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

RUN chown -R bun:bun /app
USER bun

CMD ["bun", "run", "ingestion/startup/index.ts"]
