#!/usr/bin/env bash
set -Eeuo pipefail

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/warm_game_template_cache.sh"
master="$root/templates/sdtd-master"
cache="$root/cache/sdtd-master"
mkdir -p "$master/7dtd"
printf 'runtime-v1\n' > "$master/7dtd/7DaysToDieServer.x86_64"
printf '%s\n' "$(date +%s)" > "$master/.ragenodes-template-validated-at"

TEMPLATE_ROOT="$root/templates" TEMPLATE_CACHE_ROOT="$root/cache" \
TEMPLATE_LOCK_ROOT="$root/locks" TEMPLATE_WARM_GAMES=sdtd \
TEMPLATE_CLONE_FREE_RESERVE_GB=0 bash "$script"

test "$(cat "$cache/7dtd/7DaysToDieServer.x86_64")" = runtime-v1
test -s "$cache/.ragenodes-template-fingerprint"
first_marker="$(cat "$cache/.ragenodes-template-fingerprint")"

# Una segunda ejecución reutiliza la caché y no cambia su identidad.
TEMPLATE_ROOT="$root/templates" TEMPLATE_CACHE_ROOT="$root/cache" \
TEMPLATE_LOCK_ROOT="$root/locks" TEMPLATE_WARM_GAMES=sdtd \
TEMPLATE_CLONE_FREE_RESERVE_GB=0 bash "$script"
test "$(cat "$cache/.ragenodes-template-fingerprint")" = "$first_marker"

# Una plantilla nueva se promueve completa sin exponer una caché parcial.
sleep 1
printf 'runtime-v2\n' > "$master/7dtd/7DaysToDieServer.x86_64"
TEMPLATE_ROOT="$root/templates" TEMPLATE_CACHE_ROOT="$root/cache" \
TEMPLATE_LOCK_ROOT="$root/locks" TEMPLATE_WARM_GAMES=sdtd \
TEMPLATE_CLONE_FREE_RESERVE_GB=0 bash "$script"
test "$(cat "$cache/7dtd/7DaysToDieServer.x86_64")" = runtime-v2
test "$(cat "$cache/.ragenodes-template-fingerprint")" != "$first_marker"
! find "$root/cache" -mindepth 1 -maxdepth 1 -type d -name '.sdtd-master.*' | grep -q .

echo 'PASS atomic template cache warming'
