#!/usr/bin/env bash
set -uo pipefail

target_dir="${1:-.}"
max_attempts="${NPM_AUDIT_MAX_ATTEMPTS:-3}"
retry_delay="${NPM_AUDIT_RETRY_DELAY_SECONDS:-10}"

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  output_file="$(mktemp)"
  if (cd "$target_dir" && npm audit --omit=dev --audit-level=high) 2>&1 | tee "$output_file"; then
    rm -f "$output_file"
    exit 0
  fi

  status=${PIPESTATUS[0]}
  if ! grep -Eqi '503|service unavailable|audit endpoint returned an error|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up' "$output_file"; then
    rm -f "$output_file"
    exit "$status"
  fi
  rm -f "$output_file"

  if ((attempt == max_attempts)); then
    echo "npm audit siguio indisponible despues de ${max_attempts} intentos." >&2
    exit "$status"
  fi
  echo "npm audit no esta disponible (intento ${attempt}/${max_attempts}); reintentando en ${retry_delay}s..." >&2
  sleep "$retry_delay"
done
