#!/usr/bin/env bash
set -Eeuo pipefail

fixture="$(mktemp)"
trap 'rm -f "$fixture"' EXIT

printf 'SIMPLE=value\r\nSPACED=https://one.invalid https://two.invalid\r\nQUOTED="hello world"\r\nLITERAL=cost$5\r\nCOMMENTED=enabled  # comentario\r\n' > "$fixture"

# shellcheck disable=SC1091
source ./scripts/load_env.sh
load_env_file "$fixture"

[ "$SIMPLE" = 'value' ]
[ "$SPACED" = 'https://one.invalid https://two.invalid' ]
[ "$QUOTED" = 'hello world' ]
[ "$LITERAL" = 'cost$5' ]
[ "$COMMENTED" = 'enabled' ]

echo 'Dotenv loader contract: OK'
