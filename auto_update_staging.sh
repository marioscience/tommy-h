#!/usr/bin/env bash
set -Eeuo pipefail

exec 9>/tmp/ragenodes_staging_update.lock
flock -n 9 || exit 0

PROJECT_DIR="/opt/ragenodes-ultimate"
BRANCH="staging"
LOG_FILE="$PROJECT_DIR/update_staging.log"
FAILED_COMMIT_FILE="$PROJECT_DIR/.git/ragenodes_last_failed_staging_commit"
PENDING_DEPLOY_FILE="$PROJECT_DIR/.git/ragenodes_pending_staging_deploy"
RUNTIME_CONFIG="oxideproxy/game_config/oxide_proxy.yml"
RUNTIME_CONFIG_BACKUP=""
DEPLOY_TIMEOUT_SECS="${RAGENODES_DEPLOY_TIMEOUT_SECS:-1800}"

case "$DEPLOY_TIMEOUT_SECS" in
  ''|*[!0-9]*) echo "RAGENODES_DEPLOY_TIMEOUT_SECS debe ser un entero." >&2; exit 2 ;;
esac
[ "$DEPLOY_TIMEOUT_SECS" -ge 60 ] \
  || { echo "RAGENODES_DEPLOY_TIMEOUT_SECS no puede ser menor de 60 segundos." >&2; exit 2; }

log() { printf '%s: %s\n' "$(date --iso-8601=seconds)" "$1" >> "$LOG_FILE"; }

restore_runtime_config() {
  if [ -n "$RUNTIME_CONFIG_BACKUP" ] && [ -f "$RUNTIME_CONFIG_BACKUP" ]; then
    cp -- "$RUNTIME_CONFIG_BACKUP" "$RUNTIME_CONFIG"
  fi
}

cleanup_runtime_config() {
  restore_runtime_config
  if [ -n "$RUNTIME_CONFIG_BACKUP" ]; then
    rm -f -- "$RUNTIME_CONFIG_BACKUP"
  fi
}

trap cleanup_runtime_config EXIT

run_deploy() {
  timeout --foreground --signal=TERM --kill-after=60 \
    "$DEPLOY_TIMEOUT_SECS" bash ./deploy_staging.sh
}

clear_pending_deploy() {
  rm -f -- "$PENDING_DEPLOY_FILE" "$PENDING_DEPLOY_FILE.tmp"
}

write_pending_deploy() {
  local previous_commit="$1" target_commit="$2"
  printf '%s\n%s\n' "$previous_commit" "$target_commit" > "$PENDING_DEPLOY_FILE.tmp"
  mv -f -- "$PENDING_DEPLOY_FILE.tmp" "$PENDING_DEPLOY_FILE"
}

preserve_runtime_config_if_modified() {
  if ! git diff --quiet -- "$RUNTIME_CONFIG"; then
    RUNTIME_CONFIG_BACKUP="$(mktemp)"
    cp -- "$RUNTIME_CONFIG" "$RUNTIME_CONFIG_BACKUP"
    git restore -- "$RUNTIME_CONFIG"
    log "Configuracion runtime de OxideProxy preservada para la actualizacion."
  fi
}

rollback() {
  local previous_commit="$1" failed_commit="$2"
  log "ERROR: despliegue $failed_commit fallido; volviendo a $previous_commit."
  git reset --hard "$previous_commit" >> "$LOG_FILE" 2>&1
  restore_runtime_config
  if run_deploy >> "$LOG_FILE" 2>&1; then
    log "Rollback de staging completado en $previous_commit."
  else
    log "ERROR CRITICO: tambien fallo el rollback de staging."
  fi
  printf '%s\n' "$failed_commit" > "$FAILED_COMMIT_FILE"
  clear_pending_deploy
}

cd "$PROJECT_DIR"
# Avoid background auto-gc inheriting the deployment lock. A long repack would
# otherwise block every later updater run even after fetch has returned.
git -c gc.auto=0 fetch origin "$BRANCH" >> "$LOG_FILE" 2>&1 \
  || { log "No se pudo consultar origin/$BRANCH."; exit 1; }

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if ! git diff --cached --quiet \
  || ! git diff --quiet -- . ":(exclude)$RUNTIME_CONFIG"; then
  log "Actualizacion cancelada: staging contiene cambios locales rastreados."
  exit 1
fi

# An idle poll must not rewrite the live route file. Even identical content
# wakes OxideProxy's config watcher and interrupts active game sessions.
if [ "$LOCAL" = "$REMOTE" ] && [ ! -f "$PENDING_DEPLOY_FILE" ]; then
  exit 0
fi

preserve_runtime_config_if_modified
restore_runtime_config

if [ -f "$PENDING_DEPLOY_FILE" ]; then
  PENDING_PREVIOUS="$(sed -n '1p' "$PENDING_DEPLOY_FILE")"
  PENDING_TARGET="$(sed -n '2p' "$PENDING_DEPLOY_FILE")"
  if [[ "$PENDING_PREVIOUS" =~ ^[0-9a-f]{40}$ ]] \
    && [[ "$PENDING_TARGET" =~ ^[0-9a-f]{40}$ ]] \
    && [ "$LOCAL" = "$PENDING_TARGET" ]; then
    log "Despliegue interrumpido detectado en $PENDING_TARGET; reanudando verificacion."
    if run_deploy >> "$LOG_FILE" 2>&1; then
      rm -f "$FAILED_COMMIT_FILE"
      clear_pending_deploy
      log "Staging reanudado y verificado en $PENDING_TARGET."
      exit 0
    fi
    rollback "$PENDING_PREVIOUS" "$PENDING_TARGET"
    exit 1
  elif [ "$LOCAL" = "$PENDING_PREVIOUS" ] && [ "$REMOTE" = "$PENDING_TARGET" ]; then
    log "Marcador previo encontrado antes del avance Git; reiniciando la actualizacion."
    clear_pending_deploy
  else
    log "Actualizacion cancelada: marcador de despliegue pendiente inconsistente."
    exit 1
  fi
fi

[ "$LOCAL" != "$REMOTE" ] || exit 0

if [ -f "$FAILED_COMMIT_FILE" ] && [ "$(cat "$FAILED_COMMIT_FILE")" = "$REMOTE" ]; then
  exit 0
fi

git merge-base --is-ancestor "$LOCAL" "$REMOTE" \
  || { log "Actualizacion rechazada: no es avance directo."; printf '%s\n' "$REMOTE" > "$FAILED_COMMIT_FILE"; exit 1; }

# The Oxide control plane persists live routes in this tracked seed file. Keep
# that runtime state across a fast-forward without allowing any other tracked
# change to bypass the clean-worktree guard.
write_pending_deploy "$LOCAL" "$REMOTE"
git merge --ff-only "$REMOTE" >> "$LOG_FILE" 2>&1 \
  || { restore_runtime_config; clear_pending_deploy; log "No se pudo avanzar hasta $REMOTE."; printf '%s\n' "$REMOTE" > "$FAILED_COMMIT_FILE"; exit 1; }

restore_runtime_config

if run_deploy >> "$LOG_FILE" 2>&1; then
  rm -f "$FAILED_COMMIT_FILE"
  clear_pending_deploy
  log "Staging actualizado y verificado en $REMOTE."
else
  rollback "$LOCAL" "$REMOTE"
  exit 1
fi
