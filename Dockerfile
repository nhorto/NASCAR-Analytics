# Production image: the Bun site server + Litestream replication (launch plan
# WS-B, D10). One container runs server.ts with data/ on a mounted volume;
# scripts/docker-entrypoint.sh restores the db from the replica on a fresh
# machine and wraps the server in `litestream replicate -exec`.
FROM litestream/litestream:0.3 AS litestream

FROM oven/bun:1
WORKDIR /app

# Full install (not --production): the in-process refresh spawns the CLI,
# whose deploy leg uses `bunx wrangler` (fetched on demand, cached in the
# machine's writable layer between weekly runs).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream

ENV APP_ENV=production \
    NASCAR_DATA_DIR=/data \
    PORT=8080

EXPOSE 8080
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
