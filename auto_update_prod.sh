#!/usr/bin/env bash
set -Eeuo pipefail

# Script de auto-actualización para el entorno de Producción
exec 9>/tmp/ragenodes_prod_update.lock
if ! flock -n 9; then
    exit 0
fi

PROJECT_DIR="/opt/ragenodes-ultimate"
BRANCH="main"
LOG_FILE="/opt/ragenodes-ultimate/update.log"
FAILED_COMMIT_FILE="$PROJECT_DIR/.git/ragenodes_last_failed_prod_commit"
PENDING_DEPLOY_FILE="$PROJECT_DIR/.git/ragenodes_pending_prod_deploy"
RUNTIME_CONFIG="oxideproxy/game_config/oxide_proxy.yml"
RUNTIME_CONFIG_BACKUP=""
DEPLOY_TIMEOUT_SECS="${RAGENODES_DEPLOY_TIMEOUT_SECS:-1800}"

case "$DEPLOY_TIMEOUT_SECS" in
    ''|*[!0-9]*) echo "RAGENODES_DEPLOY_TIMEOUT_SECS debe ser un entero." >&2; exit 2 ;;
esac
if [ "$DEPLOY_TIMEOUT_SECS" -lt 60 ]; then
    echo "RAGENODES_DEPLOY_TIMEOUT_SECS no puede ser menor de 60 segundos." >&2
    exit 2
fi

log() {
    printf '%s: %s\n' "$(date --iso-8601=seconds)" "$1" >> "$LOG_FILE"
}

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
        "$DEPLOY_TIMEOUT_SECS" bash ./deploy.sh
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
        log "Configuración runtime de OxideProxy preservada para la actualización."
    fi
}

rollback() {
    local previous_commit="$1"
    local failed_commit="$2"

    log "ERROR: el despliegue de $failed_commit falló; iniciando rollback a $previous_commit."
    git reset --hard "$previous_commit" >> "$LOG_FILE" 2>&1
    restore_runtime_config
    if run_deploy >> "$LOG_FILE" 2>&1; then
        log "Rollback completado; producción volvió a $previous_commit."
    else
        log "ERROR CRÍTICO: también falló el despliegue de rollback a $previous_commit."
    fi
    printf '%s\n' "$failed_commit" > "$FAILED_COMMIT_FILE"
    clear_pending_deploy
}

cd "$PROJECT_DIR"

if ! git fetch origin "$BRANCH" >> "$LOG_FILE" 2>&1; then
    log "No se pudo consultar origin/$BRANCH; se conserva la versión activa."
    exit 1
fi

LOCAL="$(git rev-parse HEAD 2>/dev/null)"
REMOTE="$(git rev-parse origin/"$BRANCH" 2>/dev/null)"

if [ -z "$REMOTE" ]; then
    exit 0
fi

if ! git diff --cached --quiet \
    || ! git diff --quiet -- . ":(exclude)$RUNTIME_CONFIG"; then
    log "Actualización cancelada: existen cambios locales rastreados en producción."
    exit 1
fi

preserve_runtime_config_if_modified
restore_runtime_config

# A power loss or killed updater may leave Git advanced while Compose is only
# partially applied. The durable two-commit marker makes the next timer run
# resume the idempotent deployment instead of treating HEAD == origin as done.
if [ -f "$PENDING_DEPLOY_FILE" ]; then
    PENDING_PREVIOUS="$(sed -n '1p' "$PENDING_DEPLOY_FILE")"
    PENDING_TARGET="$(sed -n '2p' "$PENDING_DEPLOY_FILE")"
    if [[ "$PENDING_PREVIOUS" =~ ^[0-9a-f]{40}$ ]] \
        && [[ "$PENDING_TARGET" =~ ^[0-9a-f]{40}$ ]] \
        && [ "$LOCAL" = "$PENDING_TARGET" ]; then
        log "Despliegue interrumpido detectado en $PENDING_TARGET; reanudando verificación."
        if run_deploy >> "$LOG_FILE" 2>&1; then
            rm -f "$FAILED_COMMIT_FILE"
            clear_pending_deploy
            log "Actualización de producción reanudada y verificada en $PENDING_TARGET."
            exit 0
        fi
        rollback "$PENDING_PREVIOUS" "$PENDING_TARGET"
        exit 1
    elif [ "$LOCAL" = "$PENDING_PREVIOUS" ] && [ "$REMOTE" = "$PENDING_TARGET" ]; then
        log "Marcador previo encontrado antes del avance Git; reiniciando la actualización."
        clear_pending_deploy
    else
        log "Actualización cancelada: marcador de despliegue pendiente inconsistente."
        exit 1
    fi
fi

if [ "$LOCAL" = "$REMOTE" ]; then
    exit 0
fi

if [ -f "$FAILED_COMMIT_FILE" ] && [ "$(cat "$FAILED_COMMIT_FILE")" = "$REMOTE" ]; then
    exit 0
fi

if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
    log "Actualización rechazada: origin/$BRANCH no es avance directo desde $LOCAL."
    printf '%s\n' "$REMOTE" > "$FAILED_COMMIT_FILE"
    exit 1
fi

# El plano de control persiste las rutas vivas en este archivo rastreado. Se
# conserva durante el avance y el rollback sin permitir que ningún otro cambio
# local evada la protección del árbol limpio.
log "Nuevo commit $REMOTE detectado en $BRANCH; iniciando actualización incremental."
write_pending_deploy "$LOCAL" "$REMOTE"
if ! git merge --ff-only "$REMOTE" >> "$LOG_FILE" 2>&1; then
    restore_runtime_config
    clear_pending_deploy
    log "No se pudo avanzar el repositorio hasta $REMOTE."
    printf '%s\n' "$REMOTE" > "$FAILED_COMMIT_FILE"
    exit 1
fi

restore_runtime_config

if run_deploy >> "$LOG_FILE" 2>&1; then
    rm -f "$FAILED_COMMIT_FILE"
    clear_pending_deploy
    log "Actualización de producción completada y verificada en $REMOTE."
else
    rollback "$LOCAL" "$REMOTE"
    exit 1
fi
