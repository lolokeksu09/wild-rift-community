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
seeded=false
owner_assigned=false
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
    schema=$(docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev -v "$backup/data:/backup:ro" "$image" node --input-type=module -e "import {cpSync} from 'node:fs'; import {DatabaseSync} from 'node:sqlite'; import {openDatabase} from './server/database.mjs'; cpSync('/backup','/tmp/check',{recursive:true}); const old=new DatabaseSync('/tmp/check/community.sqlite',{readOnly:true}); const v=old.prepare('PRAGMA user_version').get().user_version; old.close(); if(![10,11,12,13,14,15,16,17,18,19,20,21,22,23,24].includes(v))throw Error('Unsupported deployment migration'); const d=openDatabase('/tmp/check/community.sqlite'); if(d.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||d.prepare('PRAGMA foreign_key_check').all().length)throw Error('Invalid migrated backup'); d.close(); console.log(v);" </dev/null)
    [[ "$schema" == 10 || "$schema" == 11 || "$schema" == 12 || "$schema" == 13 || "$schema" == 14 || "$schema" == 15 || "$schema" == 16 || "$schema" == 17 || "$schema" == 18 || "$schema" == 19 || "$schema" == 20 || "$schema" == 21 || "$schema" == 22 || "$schema" == 23 || "$schema" == 24 ]]
    if [[ "$schema" != 24 ]]; then
      migration=true
      docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev -v "$root/data:/data" "$image" node --input-type=module -e "import {openDatabase} from './server/database.mjs'; const d=openDatabase('/data/community.sqlite'); if(d.prepare('PRAGMA user_version').get().user_version!==24||d.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||d.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migration check failed'); d.close();" </dev/null
    fi
  fi
else
  install -d -m 700 -o 1000 -g 1000 data
fi
if [[ "${SEED_DEMO_COMMUNITY:-0}" == 1 ]] && ! test -f "$root/demo-seeded-v1"; then
  # The cold backup above also covers this additive, operator-authorized seed.
  # Before public traffic, a failure restores the entire previous database.
  migration=true
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev -v "$root/data:/data" "$image" node server/demo-seed-cli.mjs /data/community.sqlite </dev/null
  seeded=true
fi
if test -n "${DEMO_OWNER_HANDLE:-}" && ! test -f "$root/demo-owner-assigned-v1"; then
  [[ "$DEMO_OWNER_HANDLE" =~ ^[a-zA-Z0-9_]{3,24}$ ]]
  test -f "$root/data/community.sqlite"
  "$had_data"
  # Validate on a migrated isolated cold copy before changing live ownership.
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev -v "$backup/data:/backup:ro" "$image" node --input-type=module -e "import {cpSync} from 'node:fs';import {openDatabase} from './server/database.mjs';import {demoOwnershipPlan} from './server/demo-ownership.mjs';cpSync('/backup','/tmp/check',{recursive:true});const d=openDatabase('/tmp/check/community.sqlite');try{const p=demoOwnershipPlan(d,process.argv[1]);console.log(JSON.stringify({owner:p.target.handle,clubs:p.clubs.length}));}finally{d.close();}" "$DEMO_OWNER_HANDLE" </dev/null
  migration=true
  ownership_copy="before-demo-ownership-$(date -u +%Y%m%dT%H%M%S%N).sqlite"
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev -v "$root/data:/data" "$image" node server/demo-ownership-cli.mjs /data/community.sqlite "$DEMO_OWNER_HANDLE" --apply "/data/$ownership_copy" </dev/null
  mv "$root/data/$ownership_copy" "$backup/$ownership_copy"
  # Verify only the release that assigns ownership; the owner may transfer clubs later.
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev -v "$root/data:/data" "$image" node server/demo-ownership-cli.mjs /data/community.sqlite "$DEMO_OWNER_HANDLE" --check </dev/null
  owner_assigned=true
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
if "$seeded"; then printf '%s\n' "$release" > demo-seeded-v1; fi
if "$owner_assigned"; then printf '%s\n' "$DEMO_OWNER_HANDLE" > demo-owner-assigned-v1; fi
install -m 700 "$bundle/offsite-backup.sh" "$root/offsite-backup.sh"
trap - ERR
docker compose ps
echo "Deployed $release; configuration and SQLite backup: $backup"
