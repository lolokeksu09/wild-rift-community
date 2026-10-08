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
gzip -dc "$bundle/image.tar.gz" | docker load
image="wild-rift-community:$release"
docker run --rm --network none -v "$bundle/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.11.4 caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile --validate </dev/null
backup="$root/backups/$(date -u +%Y%m%dT%H%M%SZ)-$release"
mkdir -p "$backup"
cp -p compose.yaml Caddyfile "$backup/"
if test -f .env; then cp -p .env "$backup/"; fi
migration=false
published=false
had_data=false
rollback() {
  trap - ERR
  if "$published"; then
    # Requests may already have created records. Never replace their database.
    echo 'Release was exposed; preserving new data and configuration. Inspect health/logs before recovery.'
    exit 1
  fi
  echo 'Deployment failed before publication; restoring previous configuration and cold database.'
  docker compose stop app </dev/null || true
  if "$migration" && "$had_data"; then
    # Quarantine the failed migrated copy; do not delete potential evidence.
    mv data "$backup/failed-data"
    cp -a "$backup/data" data
  fi
  cat "$backup/compose.yaml" > compose.yaml
  cat "$backup/Caddyfile" > Caddyfile
  if test -f "$backup/.env"; then cat "$backup/.env" > .env; else rm -f .env; fi
  docker compose up -d --remove-orphans </dev/null || true
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null || true
  exit 1
}
trap rollback ERR
# Keep the public endpoint in maintenance until migration and health checks pass.
# Write in place so the existing bind-mounted Caddyfile sees the change.
cat > Caddyfile <<'CADDY'
{
  default_sni 139.100.205.135
}
139.100.205.135 {
  tls {
    issuer acme {
      dir https://acme-v02.api.letsencrypt.org/directory
      profile shortlived
    }
  }
  respond "Обновляем сообщество. Попробуй через минуту." 503
}
CADDY
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null
docker compose stop app </dev/null
if test -d data; then
  cp -a data "$backup/data"
  had_data=true
  if test -f data/community.sqlite; then
    # Check/migrate an isolated copy first. WAL can require writable SHM sidecars.
    schema=$(docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev -v "$backup/data:/backup:ro" "$image" node --input-type=module -e "import {cpSync} from 'node:fs'; import {DatabaseSync} from 'node:sqlite'; import {openDatabase} from './server/database.mjs'; cpSync('/backup','/tmp/check',{recursive:true}); const old=new DatabaseSync('/tmp/check/community.sqlite',{readOnly:true}); const v=old.prepare('PRAGMA user_version').get().user_version; old.close(); if(![10,11,12,13,14,15,16].includes(v))throw Error('Unsupported deployment migration'); const d=openDatabase('/tmp/check/community.sqlite'); if(d.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||d.prepare('PRAGMA foreign_key_check').all().length)throw Error('Invalid migrated backup'); d.close(); console.log(v);" </dev/null)
    [[ "$schema" == 10 || "$schema" == 11 || "$schema" == 12 || "$schema" == 13 || "$schema" == 14 || "$schema" == 15 || "$schema" == 16 ]]
    if [[ "$schema" != 16 ]]; then
      migration=true
      docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev -v "$root/data:/data" "$image" node --input-type=module -e "import {openDatabase} from './server/database.mjs'; const d=openDatabase('/data/community.sqlite'); if(d.prepare('PRAGMA user_version').get().user_version!==16||d.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||d.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migration check failed'); d.close();" </dev/null
    fi
  fi
else
  install -d -m 700 -o 1000 -g 1000 data
fi
cat "$bundle/compose.yaml" > compose.yaml
# Leave Caddy serving maintenance during app startup.
touch .env
sed -i '/^WR_IMAGE=/d' .env
printf 'WR_IMAGE=%s\n' "$image" >> .env
docker compose config --quiet
docker compose up -d --wait --wait-timeout 120 </dev/null
# Health test uses direct app transport while public traffic is still blocked.
docker compose exec -T app node --input-type=module -e "import {get} from 'node:http'; get('http://127.0.0.1:3000/api/me',{headers:{Host:'139.100.205.135'}},r=>{let b='';r.on('data',x=>b+=x);r.on('end',()=>{if(r.statusCode!==200||JSON.parse(b).user!==null)process.exit(1)});}).on('error',()=>process.exit(1));" </dev/null
cat "$bundle/Caddyfile" > Caddyfile
# From this point onward avoid automatic DB rollback: public writes may occur.
published=true
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null
curl --retry 6 --retry-all-errors --retry-delay 2 --fail --silent --show-error --connect-timeout 10 --max-time 20 https://139.100.205.135/api/me
printf '\n'
printf '%s\n' "$release" > deployed-release
trap - ERR
docker compose ps
echo "Deployed $release; configuration and SQLite backup: $backup"
