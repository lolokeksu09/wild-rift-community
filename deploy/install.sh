#!/usr/bin/env bash
set -euo pipefail
umask 077
release=${1:?Release SHA required}
[[ "$release" =~ ^[a-f0-9]{40}$ ]] || exit 1
root=/opt/wild-rift-community
bundle="$root/releases/$release"
cd "$root"
test -f compose.yaml && test -f Caddyfile
test -f "$bundle/image.tar.gz"
# Build and tests run on the runner. The VDS only loads the tested image.
gzip -dc "$bundle/image.tar.gz" | docker load
image="wild-rift-community:$release"
docker run --rm --network none -v "$bundle/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.11.4 caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile --validate </dev/null
backup="$root/backups/$(date -u +%Y%m%dT%H%M%SZ)-$release"
mkdir -p "$backup"
cp -p compose.yaml Caddyfile "$backup/"
if test -f .env; then cp -p .env "$backup/"; fi
had_app=false
if docker compose ps --services | grep -qx app; then
  had_app=true
  docker compose stop app </dev/null
fi
rollback() {
  trap - ERR
  echo 'Deployment failed; restoring previous configuration.'
  docker compose stop app </dev/null || true
  cat "$backup/compose.yaml" > compose.yaml
  cat "$backup/Caddyfile" > Caddyfile
  if test -f "$backup/.env"; then cat "$backup/.env" > .env; else rm -f .env; fi
  docker compose up -d --remove-orphans </dev/null || true
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null || true
  exit 1
}
trap rollback ERR
if test -d data; then
  cp -a data "$backup/data"
  if test -f data/community.sqlite; then
    docker run --rm --network none -v "$root/data:/data:ro" "$image" node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync('/data/community.sqlite',{readOnly:true}); if(d.prepare('PRAGMA user_version').get().user_version!==10) throw Error('Explicit migration required'); d.close();" </dev/null
  fi
else
  install -d -m 700 -o 1000 -g 1000 data
fi
# Write in place: preserve the inode of Caddy's existing bind-mounted file.
cat "$bundle/compose.yaml" > compose.yaml
cat "$bundle/Caddyfile" > Caddyfile
# Preserve moderator IDs if already configured; replace only the release image.
touch .env
sed -i '/^WR_IMAGE=/d' .env
printf 'WR_IMAGE=%s\n' "$image" >> .env
docker compose config --quiet
docker compose up -d --wait --wait-timeout 120 </dev/null
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null
curl --retry 6 --retry-all-errors --retry-delay 2 --fail --silent --show-error --connect-timeout 10 --max-time 20 https://139.100.205.135/api/me
printf '\n'
printf '%s\n' "$release" > deployed-release
trap - ERR
docker compose ps
echo "Deployed $release; configuration backup: $backup"
