#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lab_dir="$(mktemp -d "${TMPDIR:-/tmp}/ragenodes-autoscaler.XXXXXX")"
project="ragenodes-autoscaler-test-$$"

cleanup() {
  if [[ "$lab_dir" == "${TMPDIR:-/tmp}/ragenodes-autoscaler."* ]]; then
    docker compose -p "$project" -f "$lab_dir/compose.yml" down --remove-orphans --volumes >/dev/null 2>&1 || true
    rm -rf -- "$lab_dir"
  fi
}
trap cleanup EXIT

cat >"$lab_dir/compose.yml" <<'YAML'
services:
  backend:
    image: node:24-alpine
    environment:
      LAB_P95_MS: ${LAB_P95_MS:-450}
    command:
      - node
      - -e
      - |
        require('http').createServer((req,res) => {
          if (req.url.startsWith('/internal/autoscaling')) {
            res.setHeader('content-type', 'application/json');
            const latency = Number(process.env.LAB_P95_MS || 450);
            return res.end(JSON.stringify({requests:600,errors_5xx:0,requests_per_second:10,latency_p95_ms:latency,latency_p99_ms:latency,event_loop_p99_ms:5,database_pool:{waiting:0},deployment_queue:[]}));
          }
          res.end('OK');
        }).listen(3006, '127.0.0.1');
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3006/internal/autoscaling').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 1s
      timeout: 1s
      retries: 20
YAML

docker compose -p "$project" -f "$lab_dir/compose.yml" up -d --wait backend >/dev/null

BACKEND_AUTOSCALE_ENABLED=true \
BACKEND_AUTOSCALE_MIN=1 \
BACKEND_AUTOSCALE_MAX=2 \
BACKEND_AUTOSCALE_UP_SAMPLES=1 \
BACKEND_AUTOSCALE_UP_COOLDOWN_SECONDS=0 \
BACKEND_AUTOSCALE_UP_P95_MS=100 \
BACKEND_AUTOSCALE_STATE_PATH="$lab_dir/state.json" \
RAGENODES_PROJECT_DIR="$lab_dir" \
COMPOSE_PROJECT_NAME="$project" \
node "$root_dir/scripts/deploy/backend_autoscaler.mjs" >"$lab_dir/report.json"

replicas="$(docker ps --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=backend --format '{{.ID}}' | wc -l | tr -d ' ')"
[[ "$replicas" == "2" ]] || { echo "Expected 2 healthy replicas, found $replicas" >&2; exit 1; }
grep -q '"desired":2' "$lab_dir/report.json"

LAB_P95_MS=20 docker compose -p "$project" -f "$lab_dir/compose.yml" up -d --no-deps --scale backend=2 backend >/dev/null
docker compose -p "$project" -f "$lab_dir/compose.yml" up -d --wait >/dev/null
BACKEND_AUTOSCALE_ENABLED=true \
BACKEND_AUTOSCALE_MIN=1 \
BACKEND_AUTOSCALE_MAX=2 \
BACKEND_AUTOSCALE_DOWN_SAMPLES=1 \
BACKEND_AUTOSCALE_DOWN_COOLDOWN_SECONDS=0 \
BACKEND_AUTOSCALE_DOWN_CPU_PERCENT=100 \
BACKEND_AUTOSCALE_DOWN_P95_MS=100 \
BACKEND_AUTOSCALE_DOWN_RPS_PER_REPLICA=100 \
BACKEND_AUTOSCALE_STATE_PATH="$lab_dir/state.json" \
RAGENODES_PROJECT_DIR="$lab_dir" \
COMPOSE_PROJECT_NAME="$project" \
node "$root_dir/scripts/deploy/backend_autoscaler.mjs" >"$lab_dir/down-report.json"

replicas="$(docker ps --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=backend --format '{{.ID}}' | wc -l | tr -d ' ')"
[[ "$replicas" == "1" ]] || { echo "Expected 1 healthy replica after downscale, found $replicas" >&2; exit 1; }
grep -q '"desired":1' "$lab_dir/down-report.json"
echo "PASS autoscaler scales 1 -> 2 -> 1 with health confirmation and project isolation"
