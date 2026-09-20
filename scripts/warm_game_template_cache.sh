#!/usr/bin/env bash
set -Eeuo pipefail

DATA_ROOT="${INSTANCE_DATA_ROOT:-/srv/ragenodes-data}"
TEMPLATE_ROOT="${TEMPLATE_ROOT:-$DATA_ROOT/templates}"
CACHE_ROOT="${TEMPLATE_CACHE_ROOT:-$DATA_ROOT/.template-cache}"
LOCK_ROOT="${TEMPLATE_LOCK_ROOT:-$TEMPLATE_ROOT/.locks}"
GAMES="${TEMPLATE_WARM_GAMES:-${TEMPLATE_REFRESH_GAMES:-rust palworld cs2 sdtd valheim zomboid ark}}"
RESERVE_GB="${TEMPLATE_CLONE_FREE_RESERVE_GB:-15}"

case "$RESERVE_GB" in
  ''|*[!0-9]*) echo "TEMPLATE_CLONE_FREE_RESERVE_GB debe ser un entero" >&2; exit 2 ;;
esac

mkdir -p "$CACHE_ROOT" "$LOCK_ROOT"
chmod 2775 "$LOCK_ROOT"

fingerprint() {
  local root="$1"
  (cd "$root" && find . -type f -printf '%P\0%s\0%T@\0' | sort -z | sha256sum | cut -d' ' -f1)
}

warm_game() {
  local game="$1" master cache marker lock temp old source_fingerprint current_fingerprint
  local template_bytes available_bytes reserve_bytes now
  case "$game" in
    rust|palworld|cs2|sdtd|valheim|zomboid|ark) ;;
    *) echo "[$game] juego no soportado para precalentamiento" >&2; return 1 ;;
  esac

  master="$TEMPLATE_ROOT/$game-master"
  cache="$CACHE_ROOT/$game-master"
  marker="$cache/.ragenodes-template-fingerprint"
  lock="$LOCK_ROOT/$game.lock"
  now="$(date +%s)"
  temp="$CACHE_ROOT/.$game-master.seed-$now-$$"
  old="$CACHE_ROOT/.$game-master.old-$now-$$"

  if [ ! -s "$master/.ragenodes-template-validated-at" ]; then
    echo "[$game] omitida: la plantilla maestra no tiene validación vigente" >&2
    return 1
  fi

  # Limpia únicamente residuos internos antiguos de ejecuciones interrumpidas.
  find "$CACHE_ROOT" -mindepth 1 -maxdepth 1 -type d \
    \( -name ".$game-master.seed-*" -o -name ".$game-master.old-*" \) \
    -mmin +1440 -exec rm -rf -- {} +

  exec {read_fd}<>"$lock"
  flock -s "$read_fd"
  source_fingerprint="$(fingerprint "$master")"
  current_fingerprint="$(cat "$marker" 2>/dev/null || true)"
  if [ "$current_fingerprint" = "$source_fingerprint" ]; then
    flock -u "$read_fd"
    exec {read_fd}>&-
    echo "[$game] caché local ya está actualizada"
    return 0
  fi

  template_bytes="$(du -sb "$master" | cut -f1)"
  available_bytes="$(df -PB1 "$CACHE_ROOT" | awk 'NR==2 {print $4}')"
  reserve_bytes=$((RESERVE_GB * 1024 * 1024 * 1024))
  if [ "$available_bytes" -lt $((template_bytes + reserve_bytes)) ]; then
    flock -u "$read_fd"
    exec {read_fd}>&-
    echo "[$game] espacio insuficiente para precalentar sin invadir la reserva de ${RESERVE_GB} GiB" >&2
    return 1
  fi

  rm -rf "$temp"
  mkdir -p "$temp"
  echo "[$game] precalentando caché local ($(awk -v n="$template_bytes" 'BEGIN {printf "%.1f", n/1073741824}') GiB)"
  if ! cp --reflink=auto -a "$master/." "$temp/"; then
    rm -rf "$temp"
    flock -u "$read_fd"
    exec {read_fd}>&-
    echo "[$game] falló la copia; la caché activa permanece intacta" >&2
    return 1
  fi
  printf '%s\n' "$source_fingerprint" > "$temp/.ragenodes-template-fingerprint"
  flock -u "$read_fd"
  exec {read_fd}>&-

  # Espera a que terminen clonaciones ya iniciadas y comprueba que la maestra
  # no cambió durante la copia antes de promover la nueva caché.
  exec {write_fd}>"$lock"
  flock -x "$write_fd"
  if [ "$(fingerprint "$master")" != "$source_fingerprint" ]; then
    rm -rf "$temp"
    flock -u "$write_fd"
    exec {write_fd}>&-
    echo "[$game] la plantilla cambió durante el precalentamiento; se reintentará" >&2
    return 1
  fi
  if [ -e "$cache" ]; then mv "$cache" "$old"; fi
  if ! mv "$temp" "$cache"; then
    if [ -e "$old" ]; then mv "$old" "$cache"; fi
    flock -u "$write_fd"
    exec {write_fd}>&-
    return 1
  fi
  rm -rf "$old"
  flock -u "$write_fd"
  exec {write_fd}>&-
  echo "[$game] caché local promovida de forma atómica"
}

failures=0
for game in $GAMES; do
  warm_game "$game" || failures=$((failures + 1))
done

if [ "$failures" -gt 0 ]; then
  echo "$failures caché(s) no pudieron precalentarse; las demás continuaron." >&2
  exit 1
fi
