#!/usr/bin/env bash
set -Eeuo pipefail

TEMPLATE_ROOT="${INSTANCE_DATA_ROOT:-/srv/ragenodes-data}/templates"
BUILD_ROOT="${TEMPLATE_BUILD_ROOT:-${INSTANCE_DATA_ROOT:-/srv/ragenodes-data}/.template-build}"
LOCK_ROOT="${TEMPLATE_LOCK_ROOT:-$TEMPLATE_ROOT/.locks}"
GAMES="${TEMPLATE_REFRESH_GAMES:-rust palworld cs2 sdtd valheim zomboid ark}"
LOCAL_BUILD_GAMES="${TEMPLATE_LOCAL_BUILD_GAMES:-valheim}"
DOCKER_BIN="${TEMPLATE_REFRESH_DOCKER_BIN:-docker}"
STEAMCMD_IMAGE="${TEMPLATE_STEAMCMD_IMAGE:-}"
STEAMCMD_CACHE_ROOT="${TEMPLATE_STEAMCMD_CACHE_ROOT:-${INSTANCE_DATA_ROOT:-/srv/ragenodes-data}/.steamcmd-cache}"
STEAMCMD_ATTEMPTS="${TEMPLATE_STEAMCMD_ATTEMPTS:-5}"
STEAMCMD_CONTAINER_USER="${TEMPLATE_STEAMCMD_CONTAINER_USER:-0:0}"

# Garantiza imágenes fijadas incluso cuando un operador no repite todos los
# valores predeterminados en .env.
# shellcheck source=game_image_defaults.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/game_image_defaults.sh"
apply_game_image_defaults
STEAMCMD_IMAGE="${STEAMCMD_IMAGE:-$CS2_BASE_IMAGE}"

case "$STEAMCMD_ATTEMPTS" in
  ''|*[!0-9]*) echo "TEMPLATE_STEAMCMD_ATTEMPTS debe ser un entero" >&2; exit 2 ;;
esac
[ "$STEAMCMD_ATTEMPTS" -ge 1 ] || { echo "TEMPLATE_STEAMCMD_ATTEMPTS debe ser mayor que cero" >&2; exit 2; }
case "$STEAMCMD_CONTAINER_USER" in
  *[!0-9:]*|''|:*|*:|*:*:*) echo "TEMPLATE_STEAMCMD_CONTAINER_USER debe usar UID:GID numéricos" >&2; exit 2 ;;
esac

mkdir -p "$TEMPLATE_ROOT" "$BUILD_ROOT" "$LOCK_ROOT" "$STEAMCMD_CACHE_ROOT/runtime" "$STEAMCMD_CACHE_ROOT/home"
chmod 2775 "$LOCK_ROOT"

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

validate_game_runtime() {
  local game="$1" root="$2" manifest="$3" manifest_path required
  manifest_path="$root/$manifest"
  if [ ! -s "$manifest_path" ]; then
    manifest_path="$(find "$root" -type f -name "$manifest" -print -quit)"
  fi
  if [ -z "$manifest_path" ] || [ ! -s "$manifest_path" ] || ! grep -Eq '"StateFlags"[[:space:]]+"4"' "$manifest_path"; then
    echo "[$game] manifiesto Steam incompleto" >&2
    return 1
  fi

  case "$game" in
    rust) required='RustDedicated' ;;
    palworld) required='PalServer.sh' ;;
    cs2) required='game/cs2.sh' ;;
    sdtd) required='7dtd/7DaysToDieServer.x86_64' ;;
    valheim) required='data/valheim_server.x86_64' ;;
    zomboid) required=$'serverfiles/start-server.sh\nserverfiles/ProjectZomboid64.json\nserverfiles/ProjectZomboid64' ;;
    ark) required='common/ARK Survival Ascended Dedicated Server/ShooterGame/Binaries/Win64/ArkAscendedServer.exe' ;;
    *) return 1 ;;
  esac

  while IFS= read -r relative_path; do
    if [ ! -s "$root/$relative_path" ]; then
      echo "[$game] archivo de runtime ausente o vacío: $relative_path" >&2
      return 1
    fi
  done <<< "$required"
}

run_steamcmd() {
  local game="$1" staging="$2" install_rel="$3" app_id="$4" image="$5" attempt
  if [ -n "${TEMPLATE_REFRESH_RUNNER:-}" ]; then
    "$TEMPLATE_REFRESH_RUNNER" "$game" "$staging" "$install_rel" "$app_id" "$image"
    return
  fi

  local platform_args=()
  [ "$game" = ark ] && platform_args=(+@sSteamCmdForcePlatformType windows)
  # Steam puede devolver transitoriamente "Missing configuration" mientras
  # actualiza su catálogo. Reintenta sobre el mismo staging; nunca modifica la
  # plantilla activa y ShutdownOnFailedCommand evita falsos positivos.
  # En Docker rootless, UID 0 del contenedor se mapea al usuario dueño del
  # daemon (nunca a root del host). Un UID distinto se mapearía a un subuid sin
  # acceso al bind mount.
  # Todas las plantillas comparten un SteamCMD fijado y persistente. Así una
  # imagen de juego sin SteamCMD (Rust/Palworld) no bloquea actualizaciones y
  # el cliente de Valve no vuelve a descargar sus 40 MiB en cada reintento.
  for attempt in $(seq 1 "$STEAMCMD_ATTEMPTS"); do
    if "$DOCKER_BIN" run --rm --network host \
      --user "$STEAMCMD_CONTAINER_USER" \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      -e HOME=/steamcmd-home \
      -v "$staging:/template" \
      -v "$STEAMCMD_CACHE_ROOT/runtime:/steamcmd-cache" \
      -v "$STEAMCMD_CACHE_ROOT/home:/steamcmd-home" \
      --entrypoint /bin/sh "$STEAMCMD_IMAGE" -ec '
      mkdir -p "$HOME"
      if [ ! -x /steamcmd-cache/steamcmd.sh ]; then
        steamcmd=""
        for candidate in \
          /home/steam/steamcmd/steamcmd.sh \
          /home/root/.local/steamcmd/steamcmd.sh \
          /root/.local/share/Steam/steamcmd/steamcmd.sh \
          /steamcmd/steamcmd.sh \
          /opt/steamcmd/steamcmd.sh; do
          [ -r "$candidate" ] && steamcmd="$candidate" && break
        done
        [ -n "$steamcmd" ] || { echo "SteamCMD no esta disponible en la imagen compartida" >&2; exit 70; }
        cp -R "$(dirname "$steamcmd")/." /steamcmd-cache/
        chmod -R u+rwX /steamcmd-cache
      fi
      exec /bin/bash /steamcmd-cache/steamcmd.sh "$@"
    ' sh "${platform_args[@]}" +@ShutdownOnFailedCommand 1 +force_install_dir "/template/$install_rel" +login anonymous +app_update "$app_id" validate +quit; then
      return 0
    fi
    echo "[$game] SteamCMD falló (intento $attempt/$STEAMCMD_ATTEMPTS)" >&2
    [ "$attempt" -eq "$STEAMCMD_ATTEMPTS" ] || sleep $((attempt * 10))
  done
  return 1
}

refresh_game() {
  local game="$1" app_id install_rel manifest image_var image master staging work previous lock now local_build
  IFS=$'\t' read -r app_id install_rel manifest image_var < <(game_config "$game")
  image="${!image_var:-}"
  master="$TEMPLATE_ROOT/$game-master"
  lock="$LOCK_ROOT/$game.lock"
  now="$(date +%s)"
  staging="$TEMPLATE_ROOT/.$game-master.updating-$now-$$"
  work="$staging"
  local_build=0
  case " $LOCAL_BUILD_GAMES " in
    *" $game "*) work="$BUILD_ROOT/.$game-master.build-$now-$$"; local_build=1 ;;
  esac
  previous="$TEMPLATE_ROOT/.$game-master.previous-$now-$$"

  # Recuperación tras apagados inesperados: nunca conserva residuos de otras
  # ejecuciones más de un día. La plantilla activa no coincide con el patrón.
  find "$TEMPLATE_ROOT" -mindepth 1 -maxdepth 1 -type d \
    \( -name ".$game-master.updating-*" -o -name ".$game-master.previous-*" \) \
    -mmin +1440 -exec rm -rf -- {} +
  find "$BUILD_ROOT" -mindepth 1 -maxdepth 1 -type d \
    -name ".$game-master.build-*" -mmin +1440 -exec rm -rf -- {} +

  if [ -z "$image" ]; then
    echo "[$game] omitida: $image_var no esta configurada" >&2
    return 1
  fi
  if [ ! -d "$master" ]; then
    echo "[$game] omitida: no existe $master" >&2
    return 1
  fi

  rm -rf "$staging" "$work" "$previous"
  mkdir -p "$work"
  # La copia inicial reduce la descarga a deltas y nunca modifica la maestra.
  cp --reflink=auto -a "$master/." "$work/"
  # Valheim prepara su runtime en almacenamiento local: SteamCMD no puede
  # instalar de forma fiable directamente sobre algunos NFS. La promoción
  # final sigue ocurriendo dentro del filesystem de plantillas.
  if ! run_steamcmd "$game" "$work" "$install_rel" "$app_id" "$image"; then
    rm -rf "$work" "$staging"
    echo "[$game] SteamCMD fallo; la plantilla activa permanece intacta" >&2
    return 1
  fi

  if ! validate_game_runtime "$game" "$work" "$manifest"; then
    rm -rf "$work" "$staging"
    echo "[$game] validacion incompleta; la plantilla activa permanece intacta" >&2
    return 1
  fi
  if ! printf '%s\n' "$now" > "$work/.ragenodes-template-validated-at"; then
    rm -rf "$work" "$staging"
    echo "[$game] no se pudo escribir el sello de validación; la plantilla activa permanece intacta" >&2
    return 1
  fi
  if [ "$local_build" -eq 1 ]; then
    mkdir -p "$staging"
    if ! cp --reflink=auto -a "$work/." "$staging/"; then
      rm -rf "$work" "$staging"
      echo "[$game] no se pudo transferir la compilación local; la plantilla activa permanece intacta" >&2
      return 1
    fi
    rm -rf "$work"
  fi

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
  if ! rm -rf "$previous"; then
    # Una plantilla heredada puede contener archivos con propietarios NFS que
    # este nodo no puede eliminar. Ya está fuera de la ruta activa; se conserva
    # en cuarentena para que mantenimiento del almacenamiento la retire.
    echo "[$game] plantilla anterior en cuarentena pendiente de limpieza: $previous" >&2
  fi
  flock -u "$lock_fd"
  exec {lock_fd}>&-
  echo "[$game] plantilla promovida de forma atomica"
}

validate_existing_game() {
  local game="$1" app_id install_rel manifest image_var master now
  IFS=$'\t' read -r app_id install_rel manifest image_var < <(game_config "$game")
  master="$TEMPLATE_ROOT/$game-master"
  now="$(date +%s)"
  if [ ! -d "$master" ] || ! validate_game_runtime "$game" "$master" "$manifest"; then
    echo "[$game] plantilla existente no válida; no se sellará" >&2
    return 1
  fi
  if ! printf '%s\n' "$now" > "$master/.ragenodes-template-validated-at"; then
    echo "[$game] no se pudo escribir el sello de validación" >&2
    return 1
  fi
  echo "[$game] plantilla existente validada"
}

failures=0
for game in $GAMES; do
  if ! game_config "$game" >/dev/null; then
    echo "Juego de plantilla no soportado: $game" >&2
    failures=$((failures + 1))
    continue
  fi
  if [ "${TEMPLATE_VALIDATE_EXISTING_ONLY:-0}" = 1 ]; then
    validate_existing_game "$game" || failures=$((failures + 1))
  else
    refresh_game "$game" || failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "$failures plantilla(s) no pudieron actualizarse; las demas continuaron." >&2
  exit 1
fi
