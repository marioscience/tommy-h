#!/usr/bin/env bash
set -Eeuo pipefail

: "${POWERDNS_ZONE:=edge.ragenodes.app}"
: "${EDGE_TLS_CERT_VOLUME:=ragenodes_edge_tls_certificates}"

docker volume create "$EDGE_TLS_CERT_VOLUME" >/dev/null
certificate="/var/lib/lego/certificates/$POWERDNS_ZONE.crt"
private_key="/var/lib/lego/certificates/$POWERDNS_ZONE.key"
inspector_image="alpine:3.22.1@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1"
: "${OXIDE_RUNTIME_GID:=65532}"

normalize_certificate_permissions() {
  docker run --rm --network none --read-only --cap-drop ALL \
    --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
    -v "$EDGE_TLS_CERT_VOLUME:/var/lib/lego" "$inspector_image" \
    sh -c 'find /var/lib/lego/certificates -type d -exec chmod 0750 {} + && find /var/lib/lego/certificates -type f -exec chmod 0640 {} + && chown -R "0:$1" /var/lib/lego/certificates' \
    -- "$OXIDE_RUNTIME_GID"
}

certificate_exists() {
  docker run --rm --network none --read-only --cap-drop ALL \
    -v "$EDGE_TLS_CERT_VOLUME:/var/lib/lego:ro" "$inspector_image" \
    sh -c 'test -s "$1" && test -s "$2"' -- "$certificate" "$private_key"
}

if certificate_exists; then
  echo "==> Verificando y renovando el certificado wildcard de $POWERDNS_ZONE si corresponde..."
else
  echo "==> Emitiendo el certificado wildcard inicial de $POWERDNS_ZONE..."
fi
# Keep lego as the owner while granting OxideProxy's unprivileged group read
# access. This also repairs permissions left by an interrupted prior run.
normalize_certificate_permissions
LEGO_ACTION=run "${COMPOSE[@]}" --profile edge-certificate run --rm oxide_edge_certificate

# lego writes certificates as root with mode 0600. OxideProxy intentionally
# runs unprivileged, so grant only its runtime identity read access.
normalize_certificate_permissions

certificate_exists || {
  echo "ERROR: lego no produjo el certificado wildcard esperado." >&2
  exit 1
}
