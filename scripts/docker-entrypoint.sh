#!/bin/sh
# Container entrypoint (WS-B). With LITESTREAM_REPLICA_URL set: restore the db
# if this machine has none (fresh volume), then run the server under
# `litestream replicate -exec` so every write streams to the replica. Without
# it (local docker run, or before the bucket exists): serve unreplicated, loudly.
set -eu

DATA_DIR="${NASCAR_DATA_DIR:-/data}"
DB_PATH="$DATA_DIR/nascar.db"
SERVE="bun src/app/index.ts serve --port ${PORT:-8080}"

mkdir -p "$DATA_DIR"

if [ -n "${LITESTREAM_REPLICA_URL:-}" ]; then
  litestream restore -if-db-not-exists -if-replica-exists -o "$DB_PATH" "$LITESTREAM_REPLICA_URL"
  exec litestream replicate -exec "$SERVE" "$DB_PATH" "$LITESTREAM_REPLICA_URL"
else
  echo "{\"level\":\"warn\",\"msg\":\"LITESTREAM_REPLICA_URL not set — serving WITHOUT replication\"}"
  exec $SERVE
fi
