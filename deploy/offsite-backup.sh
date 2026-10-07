#!/usr/bin/env bash
# Run as the VDS operator; source the private configuration before invoking.
set -euo pipefail
umask 077
cd /opt/wild-rift-community
: "${WR_BACKUP_KEY:?Encryption key required}"
: "${WR_BACKUP_TARGET:?user@host:/absolute/directory required}"
: "${WR_BACKUP_SSH_KEY_FILE:?SSH key file required}"
: "${WR_BACKUP_KNOWN_HOSTS:?Pinned known_hosts file required}"
[[ "$WR_BACKUP_KEY" =~ ^[a-fA-F0-9]{64}$ ]]
[[ "$WR_BACKUP_TARGET" =~ ^[a-zA-Z0-9_-]+@[a-zA-Z0-9.-]+:/[a-zA-Z0-9/_-]+$ ]]
test -f "$WR_BACKUP_SSH_KEY_FILE" && test -f "$WR_BACKUP_KNOWN_HOSTS"
export WR_BACKUP_KEY
# Serialize operators/timers; no production database replacement or pruning.
exec 9>/opt/wild-rift-community/.offsite-backup.lock
flock -n 9 || { echo 'Another backup is running.'; exit 1; }
work=$(mktemp -d)
file="community-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 8).wrbackup"
cleanup() {
  docker compose exec -T app rm -f "/data/.offsite-$file" >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT
opts=(-i "$WR_BACKUP_SSH_KEY_FILE" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$WR_BACKUP_KNOWN_HOSTS" -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2)
# -e NAME forwards the environment; no key value appears in command arguments.
docker compose exec -T -e WR_BACKUP_KEY app node server/backup-cli.mjs create /data/community.sqlite "/data/.offsite-$file"
container=$(docker compose ps -q app)
test -n "$container"
docker cp "$container:/data/.offsite-$file" "$work/$file"
scp "${opts[@]}" "$work/$file" "$WR_BACKUP_TARGET/$file"
# Retrieve from the independent destination and verify authenticated decryption,
# SQLite integrity, schema and session/code revocation on an isolated copy.
scp "${opts[@]}" "$WR_BACKUP_TARGET/$file" "$work/returned.wrbackup"
cmp "$work/$file" "$work/returned.wrbackup"
image=$(docker inspect --format '{{.Config.Image}}' "$container")
docker run --rm --user 0:0 --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev -e WR_BACKUP_KEY -v "$work/returned.wrbackup:/backup.wrbackup:ro" "$image" node server/backup-cli.mjs restore /backup.wrbackup /tmp/restored.sqlite
printf 'External backup verified: %s\n' "$file"
