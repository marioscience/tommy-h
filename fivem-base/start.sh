#!/usr/bin/env bash
set -euo pipefail

export FIVEM_PORT="${FIVEM_PORT:-30120}"
export TXADMIN_PORT="${TXADMIN_PORT:-40120}"
export TXHOST_DATA_PATH="${TXHOST_DATA_PATH:-/opt/fivem/txData}"
export TXHOST_TXA_PORT="${TXHOST_TXA_PORT:-${TXADMIN_PORT}}"
export TXHOST_FXS_PORT="${TXHOST_FXS_PORT:-${FIVEM_PORT}}"
export TXHOST_INTERFACE="${TXHOST_INTERFACE:-0.0.0.0}"
export TXHOST_GAME_NAME="${TXHOST_GAME_NAME:-fivem}"
export TXHOST_IGNORE_DEPRECATED_CONFIGS="${TXHOST_IGNORE_DEPRECATED_CONFIGS:-true}"

mkdir -p /data/txData /data/logs "${TXHOST_DATA_PATH}"
chmod -R 777 "${TXHOST_DATA_PATH}" /data/txData 2>/dev/null || true

echo "Buscando archivos server.cfg para corregir puertos y base de datos..."
patch_server_cfg() {
  local cfg="$1"
  local dir
  dir="$(dirname "$cfg")"
  if [ ! -w "$cfg" ] || [ ! -w "$dir" ]; then
    echo "Saltando $cfg: sin permisos de escritura"
    return 0
  fi

  sed \
    -e "s/^[[:space:]]*endpoint_add_tcp.*$/# endpoint_add_tcp disabled - handled by txAdmin/gi" \
    -e "s/^[[:space:]]*endpoint_add_udp.*$/# endpoint_add_udp disabled - handled by txAdmin/gi" \
    -e "s/^[[:space:]]*ensure[[:space:]]\+monitor/# ensure monitor disabled: txAdmin owns this resource/g" \
    -e "s/^[[:space:]]*start[[:space:]]\+monitor/# start monitor disabled: txAdmin owns this resource/g" \
    "$cfg" > "$cfg.tmp" && cat "$cfg.tmp" > "$cfg" && rm -f "$cfg.tmp" || { echo "No se pudo corregir $cfg"; return 0; }

  if [ -n "${DB_NAME:-}" ] && [ -n "${DB_USER:-}" ] && [ -n "${DB_PASS:-}" ]; then
    local mysql_url="mysql://${DB_USER}:${DB_PASS}@mariadb/${DB_NAME}?charset=utf8mb4"
    if grep -q '^set[[:space:]]\+mysql_connection_string' "$cfg"; then
      sed "s|^set[[:space:]]\+mysql_connection_string.*|set mysql_connection_string \"${mysql_url}\"|" "$cfg" > "$cfg.tmp" && cat "$cfg.tmp" > "$cfg" && rm -f "$cfg.tmp" || echo "No se pudo corregir DB en $cfg"
    else
      printf '\nset mysql_connection_string "%s"\n' "$mysql_url" >> "$cfg" || echo "No se pudo añadir DB en $cfg"
    fi
  fi
}

while IFS= read -r cfg; do
  patch_server_cfg "$cfg"
done < <(find /data -name "server.cfg" -type f 2>/dev/null)

echo "Aplicando parches de estabilidad para QBCore..."
find /data -name "main.lua" -path "*/qb-multicharacter/server/*" -type f -exec sed -i "s/(QBCore.Functions.GetIdentifier(src, 'discord'):gsub('discord:', '') or 'unknown')/((QBCore.Functions.GetIdentifier(src, 'discord') or 'discord:unknown'):gsub('discord:', ''))/g" {} + 2>/dev/null || true



patch_txadmin_zap_assets_only() {
  local bundle
  for bundle in /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/panel/index-*.js; do
    [ -f "$bundle" ] || continue
    grep -q "RAGENODES_HIDE_TXADMIN_ZAP_ASSETS_ONLY_V2" "$bundle" 2>/dev/null && continue
    cat >> "$bundle" <<'EOF'

;/* RAGENODES_HIDE_TXADMIN_ZAP_ASSETS_ONLY_V2 */
(() => {
  if (window.__RAGENODES_HIDE_TXADMIN_ZAP_ASSETS_ONLY_V2) return;
  window.__RAGENODES_HIDE_TXADMIN_ZAP_ASSETS_ONLY_V2 = true;
  const scan = () => {
    document.querySelectorAll('a[href*="zap-hosting"], a[href*="zap"], img[src*="zap"]').forEach((el) => {
      const target = el.closest('a') || el;
      if (target instanceof HTMLElement) target.style.setProperty('display', 'none', 'important');
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });
  else scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
EOF
  done
}

patch_txadmin_zap_assets_only

echo "Deshabilitando X-Frame-Options en txAdmin para permitir iframes..."
sed -i 's|X-Frame-Options|X-Frame-Oxxxxxs|gi' /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/core/index.js || true

echo "Preparando directorios para FiveM..."
rm -rf /data/cache/
find / -name "yarn.lock" -type f -delete 2>/dev/null || true
find / -name ".yarn.lock" -type f -delete 2>/dev/null || true
find / -name ".yarn" -type d -exec rm -rf {} + 2>/dev/null || true



sleep 2
cd /data

if [ -n "${LICENSE_KEY:-}" ] && [ "${LICENSE_KEY}" != "hidden" ]; then
  exec bash /opt/fivem/run.sh \
    +set net_port "${FIVEM_PORT}" \
    +set sv_endpoints "${FIVEM_PUBLIC_HOST:-localhost}:${FIVEM_PORT}" \
    +set sv_licenseKey "${LICENSE_KEY}"
else
  exec bash /opt/fivem/run.sh \
    +set net_port "${FIVEM_PORT}" \
    +set sv_endpoints "${FIVEM_PUBLIC_HOST:-localhost}:${FIVEM_PORT}"
fi
sed -i 's|" trust proxy\,\loopback\|\trust proxy\,true|g' /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/core/index.js || true
sed -i 's|\trust proxy\, \loopback\|\trust proxy\, true|g' /opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/core/index.js || true
