# Ingestion container — shared by startup and schedule triggers
FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json ./
RUN bun install

COPY ingestion/index.ts ./ingestion/
COPY src ./src

# Runtime stage
FROM oven/bun:1-slim

ARG SYNC_MODE=startup
ARG ISSUE_LIMIT=0

ENV SYNC_MODE=${SYNC_MODE}
ENV ISSUE_LIMIT=${ISSUE_LIMIT}

# GITHUB_OWNER and GITHUB_REPO are supplied at deploy time via the astropods.yml
# top-level `inputs` (injected as runtime env vars), not baked at build time.

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/ingestion ./ingestion
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

RUN chown -R bun:bun /app
USER bun

CMD ["bun", "run", "ingestion/index.ts"]
