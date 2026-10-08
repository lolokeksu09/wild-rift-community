#!/usr/bin/env bash
set -euo pipefail
umask 077
release=__RELEASE_SHA__
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
archive="$script_dir/source.tar.gz"
expected_sha=__SOURCE_SHA256__
echo 'Проверка архива этапа __STAGE__…'
actual_sha=$(sha256sum "$archive")
test "${actual_sha%% *}" = "$expected_sha" || { echo 'Архив повреждён. Скачай ZIP заново.' >&2; exit 1; }
test -f "$archive"
command -v ssh >/dev/null
command -v scp >/dev/null
keydir=$(mktemp -d)
trap 'rm -rf "$keydir"' EXIT
printf '%s\n' '139.100.205.135 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH1pZF1lCdjez9hNRWJ+gpbwvIPvDxaiox1CYZbJ1LVX' > "$keydir/known_hosts"
opts=(-o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$keydir/known_hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
remote=root@139.100.205.135
bundle="/opt/wild-rift-community/releases/$release"
echo 'Передача кода на VDS. При запросе введи пароль SSH сервера.'
ssh "${opts[@]}" "$remote" "set -eu; test -f /opt/wild-rift-community/compose.yaml; test -f /opt/wild-rift-community/Caddyfile; install -d -m 700 $bundle"
scp "${opts[@]}" "$archive" "$remote:$bundle/source.tar.gz"
ssh "${opts[@]}" "$remote" 'bash -s' <<'REMOTE'
set -euo pipefail
umask 077
release=__RELEASE_SHA__
bundle="/opt/wild-rift-community/releases/$release"
test "$(id -u)" = 0
command -v docker >/dev/null
docker compose version
if test -f /opt/wild-rift-community/deployed-release && test "$(cat /opt/wild-rift-community/deployed-release)" = "$release"; then
  echo 'Этот выпуск уже установлен.'
  exit 0
fi
install -d -m 700 "$bundle/source"
tar -xzf "$bundle/source.tar.gz" -C "$bundle/source" --strip-components=1
cd "$bundle/source"
test "$(cat RELEASE_SHA)" = "$release"
echo 'Сборка Docker-образа; работающий сайт пока не переключается.'
docker build -t "wild-rift-community:$release" .
if ! command -v sudo >/dev/null; then
  sudo() { "$@"; }
  export -f sudo
fi
bash deploy/smoke-image.sh "wild-rift-community:$release"
docker save "wild-rift-community:$release" | gzip > "$bundle/image.tar.gz"
install -m 600 deploy/compose.yaml deploy/Caddyfile "$bundle/"
install -m 700 deploy/install.sh deploy/offsite-backup.sh "$bundle/"
echo 'Сохранение копии и переключение сайта штатным установщиком.'
SEED_DEMO_COMMUNITY=0 DEMO_OWNER_HANDLE= bash "$bundle/install.sh" "$release"
REMOTE
