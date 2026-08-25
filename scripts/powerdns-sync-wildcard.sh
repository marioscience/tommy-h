#!/usr/bin/env sh
set -eu

: "${PDNS_API_KEY:?PDNS_API_KEY es obligatorio}"
: "${POWERDNS_ZONE:?POWERDNS_ZONE es obligatorio}"
: "${POWERDNS_EDGE_IPV4:?POWERDNS_EDGE_IPV4 es obligatorio}"

PDNS_API_URL="${PDNS_API_URL:-http://127.0.0.1:8081/api/v1}"
PDNS_SERVER_ID="${PDNS_SERVER_ID:-localhost}"
zone="$(printf '%s' "$POWERDNS_ZONE" | tr '[:upper:]' '[:lower:]' | sed 's/\.$//')"

case "$zone" in
  *[!a-z0-9.-]*|.*|*..*|*.-*|*-.*|*-) echo "POWERDNS_ZONE no es válido" >&2; exit 1 ;;
esac

old_ifs="$IFS"
IFS=.
set -- $POWERDNS_EDGE_IPV4
IFS="$old_ifs"
if [ "$#" -ne 4 ]; then
  echo "POWERDNS_EDGE_IPV4 debe ser una IPv4" >&2
  exit 1
fi
for octet in "$@"; do
  case "$octet" in *[!0-9]*|'') echo "POWERDNS_EDGE_IPV4 debe ser una IPv4" >&2; exit 1;; esac
  if [ "$octet" -gt 255 ]; then
    echo "POWERDNS_EDGE_IPV4 debe ser una IPv4" >&2
    exit 1
  fi
done

zone_id="${zone}."
zone_url="${PDNS_API_URL}/servers/${PDNS_SERVER_ID}/zones/${zone_id}"

# Se niega a crear o tomar control de una zona. Primero debe existir y estar
# delegada conscientemente por el operador en el registrador.
curl --fail --silent --show-error \
  --header "X-API-Key: ${PDNS_API_KEY}" \
  "$zone_url" >/dev/null

curl --fail --silent --show-error \
  --request PATCH \
  --header "X-API-Key: ${PDNS_API_KEY}" \
  --header "Content-Type: application/json" \
  --data "{\"rrsets\":[{\"name\":\"*.${zone_id}\",\"type\":\"A\",\"ttl\":60,\"changetype\":\"REPLACE\",\"records\":[{\"content\":\"${POWERDNS_EDGE_IPV4}\",\"disabled\":false}]}]}" \
  "$zone_url" >/dev/null

echo "Wildcard *.${zone} sincronizado con ${POWERDNS_EDGE_IPV4}."
