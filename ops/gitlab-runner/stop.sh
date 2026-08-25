#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
docker compose -f compose.yml stop runner
