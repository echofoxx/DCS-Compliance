#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo "Usage: $0 backups/dcs-TIMESTAMP.dump"; exit 2; fi
test -f "$1"
docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-dcs}" -d "${POSTGRES_DB:-dcs}" --clean --if-exists < "$1"
echo "Restored $1"
