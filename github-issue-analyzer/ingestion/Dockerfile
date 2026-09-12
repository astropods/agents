# Ingestion container — shared by startup and schedule triggers
FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json ./
RUN bun install

COPY ingestion ./ingestion
COPY src ./src

# Runtime stage
FROM oven/bun:1-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/ingestion ./ingestion
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

RUN chown -R bun:bun /app
USER bun

# Defaults mirror the startup entry's `inputs` in astropods.yml, which override
# them at runtime. Change both together, so an uninjected run stays bounded.
ARG SYNC_MODE=startup
ARG ISSUE_LIMIT=20
ARG ISSUE_STATE=open

ENV SYNC_MODE=${SYNC_MODE}
ENV ISSUE_LIMIT=${ISSUE_LIMIT}
ENV ISSUE_STATE=${ISSUE_STATE}

# GITHUB_OWNER and GITHUB_REPO are supplied at deploy time via the astropods.yml
# top-level `inputs` (injected as runtime env vars), not baked at build time.

CMD ["bun", "run", "ingestion/index.ts"]
