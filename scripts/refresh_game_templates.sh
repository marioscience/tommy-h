#!/usr/bin/env bash
set -Eeuo pipefail

TEMPLATE_ROOT="${INSTANCE_DATA_ROOT:-/srv/ragenodes-data}/templates"
LOCK_ROOT="${TEMPLATE_LOCK_ROOT:-$TEMPLATE_ROOT/.locks}"
GAMES="${TEMPLATE_REFRESH_GAMES:-rust palworld cs2 sdtd valheim zomboid ark}"
DOCKER_BIN="${TEMPLATE_REFRESH_DOCKER_BIN:-docker}"

mkdir -p "$TEMPLATE_ROOT" "$LOCK_ROOT"

game_config() {
  case "$1" in
    rust)     printf '%s\t%s\t%s\t%s\n' 258550 .       appmanifest_258550.acf  RUST_BASE_IMAGE ;;
    palworld) printf '%s\t%s\t%s\t%s\n' 2394010 .      appmanifest_2394010.acf PALWORLD_BASE_IMAGE ;;
    cs2)      printf '%s\t%s\t%s\t%s\n' 730 .          appmanifest_730.acf     CS2_BASE_IMAGE ;;
    sdtd)     printf '%s\t%s\t%s\t%s\n' 294420 7dtd    appmanifest_294420.acf  SDTD_BASE_IMAGE ;;
    valheim)  printf '%s\t%s\t%s\t%s\n' 896660 data    appmanifest_896660.acf  VALHEIM_BASE_IMAGE ;;
    zomboid)  printf '%s\t%s\t%s\t%s\n' 380870 serverfiles appmanifest_380870.acf ZOMBOID_BASE_IMAGE ;;
    ark)      printf '%s\t%s\t%s\t%s\n' 2430930 'common/ARK Survival Ascended Dedicated Server' appmanifest_2430930.acf ARK_BASE_IMAGE ;;
    *) return 1 ;;
  esac
}

run_steamcmd() {
  local game="$1" staging="$2" install_rel="$3" app_id="$4" image="$5"
  if [ -n "${TEMPLATE_REFRESH_RUNNER:-}" ]; then
    "$TEMPLATE_REFRESH_RUNNER" "$game" "$staging" "$install_rel" "$app_id" "$image"
    return
  fi

  local platform_args=()
  [ "$game" = ark ] && platform_args=(+@sSteamCmdForcePlatformType windows)
  "$DOCKER_BIN" run --rm --network host \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp/ragenodes-home \
    -v "$staging:/template" \
    --entrypoint /bin/sh "$image" -ec '
      mkdir -p "$HOME"
      steamcmd=""
      for candidate in \
        /home/steam/steamcmd/steamcmd.sh \
        /home/root/.local/steamcmd/steamcmd.sh \
        /root/.local/share/Steam/steamcmd/steamcmd.sh \
        /steamcmd/steamcmd.sh \
        /opt/steamcmd/steamcmd.sh; do
        [ -r "$candidate" ] && steamcmd="$candidate" && break
      done
      [ -n "$steamcmd" ] || { echo "SteamCMD no esta disponible en la imagen" >&2; exit 70; }
      # Algunas imágenes conservan SteamCMD bajo un home de root con binarios
      # 0744. Se copia su pequeño runtime a /tmp para ejecutarlo con el UID
      # aislado, sin modificar la imagen ni elevar privilegios.
      rm -rf /tmp/ragenodes-steamcmd
      cp -R "$(dirname "$steamcmd")" /tmp/ragenodes-steamcmd
      chmod -R u+rwX /tmp/ragenodes-steamcmd
      exec /bin/bash /tmp/ragenodes-steamcmd/steamcmd.sh "$@"
    ' sh "${platform_args[@]}" +force_install_dir "/template/$install_rel" +login anonymous +app_update "$app_id" validate +quit
}

refresh_game() {
  local game="$1" app_id install_rel manifest image_var image master staging previous lock now
  IFS=$'\t' read -r app_id install_rel manifest image_var < <(game_config "$game")
  image="${!image_var:-}"
  master="$TEMPLATE_ROOT/$game-master"
  lock="$LOCK_ROOT/$game.lock"
  now="$(date +%s)"
  staging="$TEMPLATE_ROOT/.$game-master.updating-$now-$$"
  previous="$TEMPLATE_ROOT/.$game-master.previous-$now-$$"

  # Recuperación tras apagados inesperados: nunca conserva residuos de otras
  # ejecuciones más de un día. La plantilla activa no coincide con el patrón.
  find "$TEMPLATE_ROOT" -mindepth 1 -maxdepth 1 -type d \
    \( -name ".$game-master.updating-*" -o -name ".$game-master.previous-*" \) \
    -mmin +1440 -exec rm -rf -- {} +

  if [ -z "$image" ]; then
    echo "[$game] omitida: $image_var no esta configurada" >&2
    return 1
  fi
  if [ ! -d "$master" ]; then
    echo "[$game] omitida: no existe $master" >&2
    return 1
  fi

  rm -rf "$staging" "$previous"
  mkdir -p "$staging"
  # La copia inicial reduce la descarga a deltas y nunca modifica la maestra.
  cp --reflink=auto -a "$master/." "$staging/"
  if ! run_steamcmd "$game" "$staging" "$install_rel" "$app_id" "$image"; then
    rm -rf "$staging"
    echo "[$game] SteamCMD fallo; la plantilla activa permanece intacta" >&2
    return 1
  fi

  local manifest_path="$staging/$manifest"
  if [ ! -s "$manifest_path" ]; then
    manifest_path="$(find "$staging" -type f -name "$manifest" -print -quit)"
  fi
  if [ -z "$manifest_path" ] || [ ! -s "$manifest_path" ] || ! grep -Eq '"StateFlags"[[:space:]]+"4"' "$manifest_path"; then
    rm -rf "$staging"
    echo "[$game] validacion incompleta; la plantilla activa permanece intacta" >&2
    return 1
  fi
  printf '%s\n' "$now" > "$staging/.ragenodes-template-validated-at"

  # El bloqueo exclusivo solo cubre el renombrado; SteamCMD nunca bloquea despliegues.
  exec {lock_fd}>"$lock"
  flock -x "$lock_fd"
  mv "$master" "$previous"
  if ! mv "$staging" "$master"; then
    mv "$previous" "$master"
    flock -u "$lock_fd"
    exec {lock_fd}>&-
    return 1
  fi
  rm -rf "$previous"
  flock -u "$lock_fd"
  exec {lock_fd}>&-
  echo "[$game] plantilla promovida de forma atomica"
}

failures=0
for game in $GAMES; do
  if ! game_config "$game" >/dev/null; then
    echo "Juego de plantilla no soportado: $game" >&2
    failures=$((failures + 1))
    continue
  fi
  refresh_game "$game" || failures=$((failures + 1))
done

if [ "$failures" -gt 0 ]; then
  echo "$failures plantilla(s) no pudieron actualizarse; las demas continuaron." >&2
  exit 1
fi
