#!/bin/sh
set -eu
mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-dcs}" -d "${POSTGRES_DB:-dcs}" --format=custom > "backups/dcs-${stamp}.dump"
echo "Created backups/dcs-${stamp}.dump"
