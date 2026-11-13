#!/bin/sh
# Back up what can't be rebuilt from the recordings themselves: the database (accounts, studios,
# which chunk and file belongs to which recording, consent records) and this install's .env
# (every secret, including the key that own-storage credentials are encrypted with).
#
#   ./backup.sh                 one backup into /var/backups/tapry, backups older than 14 days removed
#   BACKUP_DIR=/mnt/box KEEP_DAYS=30 ./backup.sh
#
# The recordings' media (the seaweedfs-data volume, or your S3 bucket) is NOT copied here: it is
# large, and a copy on the same disk protects against nothing. Use your provider's server
# backups or bucket replication for it. Recordings are useless without this database, and this
# database is of little use without the recordings: keep both.
#
# Restore the database into a stopped app (docs/self-hosting.md, "Backups"):
#   docker compose stop web worker
#   docker compose exec -T postgres pg_restore -U "$DATA_NAME" -d "$DATA_NAME" --clean --if-exists < db-<time>.dump
#   docker compose start web worker
#
# The files hold personal data and secrets: the folder is readable by root only.
set -eu
cd "$(dirname "$0")"

DIR=${BACKUP_DIR:-/var/backups/tapry}
KEEP=${KEEP_DAYS:-14}
[ -f .env ] || { echo "backup: no .env here ($(pwd))" >&2; exit 1; }
DATA_NAME=$(grep -E '^DATA_NAME=' .env | tail -1 | cut -d= -f2-)
[ -n "$DATA_NAME" ] || { echo "backup: DATA_NAME is missing from .env" >&2; exit 1; }

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
part="$DIR/.db-$stamp.dump.part"
trap 'rm -f "$part"' EXIT

# Custom format: compressed, and restorable table by table.
docker compose exec -T postgres pg_dump -U "$DATA_NAME" -d "$DATA_NAME" -Fc > "$part"
# A dump that can't be read back is not a backup: list its contents before keeping it.
tables=$(docker compose exec -T postgres pg_restore --list < "$part" | grep -c ' TABLE DATA ' || true)
[ "$tables" -gt 0 ] || { echo "backup: the dump has no tables in it, not kept" >&2; exit 1; }
mv "$part" "$DIR/db-$stamp.dump"
cp -p .env "$DIR/env-$stamp"

# Older ones go, but never the last one left.
for kind in 'db-*.dump' 'env-*'; do
  find "$DIR" -maxdepth 1 -type f -name "$kind" -mtime +"$KEEP" | sort | while read -r old; do
    [ "$(find "$DIR" -maxdepth 1 -type f -name "$kind" | wc -l)" -gt 1 ] && rm -f "$old"
  done
done

size=$(du -h "$DIR/db-$stamp.dump" | cut -f1)
echo "backup: $DIR/db-$stamp.dump ($size, $tables tables) and env-$stamp; $(find "$DIR" -maxdepth 1 -name 'db-*.dump' | wc -l | tr -d ' ') database backups kept"
