#!/usr/bin/env bash
set -Eeuo pipefail

: "${POWERDNS_ZONE:=edge.ragenodes.app}"
: "${EDGE_TLS_CERT_VOLUME:=ragenodes_edge_tls_certificates}"

docker volume create "$EDGE_TLS_CERT_VOLUME" >/dev/null
certificate="/certificates/$POWERDNS_ZONE.crt"
private_key="/certificates/$POWERDNS_ZONE.key"
inspector_image="alpine:3.22.1@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1"

certificate_exists() {
  docker run --rm --network none --read-only --cap-drop ALL \
    -v "$EDGE_TLS_CERT_VOLUME:/certificates:ro" "$inspector_image" \
    sh -c 'test -s "$1" && test -s "$2"' -- "$certificate" "$private_key"
}

if certificate_exists; then
  echo "==> Renovando el certificado wildcard de $POWERDNS_ZONE si corresponde..."
  LEGO_ACTION=renew "${COMPOSE[@]}" --profile edge-certificate run --rm oxide_edge_certificate
else
  echo "==> Emitiendo el certificado wildcard inicial de $POWERDNS_ZONE..."
  LEGO_ACTION=run "${COMPOSE[@]}" --profile edge-certificate run --rm oxide_edge_certificate
fi

certificate_exists || {
  echo "ERROR: lego no produjo el certificado wildcard esperado." >&2
  exit 1
}
