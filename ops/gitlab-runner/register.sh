#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

: "${GITLAB_URL:=https://gitlab.com/}"
: "${GITLAB_RUNNER_GENERAL_TOKEN:?Falta GITLAB_RUNNER_GENERAL_TOKEN en ops/gitlab-runner/.env}"
: "${GITLAB_RUNNER_RUST_TOKEN:?Falta GITLAB_RUNNER_RUST_TOKEN en ops/gitlab-runner/.env}"

case "$GITLAB_RUNNER_GENERAL_TOKEN:$GITLAB_RUNNER_RUST_TOKEN" in
  glrt-*:glrt-*) ;;
  *) echo "Los dos tokens deben ser tokens de autenticación de runner (glrt-...)." >&2; exit 1 ;;
esac

docker compose -f compose.yml up --no-start runner >/dev/null

if docker compose -f compose.yml run --rm --entrypoint sh runner -c \
  "grep -q '^\[\[runners\]\]' /etc/gitlab-runner/config.toml 2>/dev/null"; then
  echo "Ya existe una configuración de runner. No se crearán registros duplicados."
  echo "Si necesitas reemplazarla, elimina primero el volumen ragenodes-gitlab-runner-config."
  exit 0
fi

register_runner() {
  token="$1"
  description="$2"
  limit="$3"
  cpus="$4"
  memory="$5"

  docker compose -f compose.yml run --rm runner register \
    --non-interactive \
    --url "$GITLAB_URL" \
    --token "$token" \
    --executor docker \
    --description "$description" \
    --limit "$limit" \
    --request-concurrency "$limit" \
    --output-limit 20480 \
    --debug-trace-disabled=true \
    --docker-image alpine:3.22 \
    --docker-pull-policy if-not-present \
    --docker-privileged=false \
    --docker-security-opt no-new-privileges \
    --docker-cpus "$cpus" \
    --docker-memory "$memory" \
    --docker-memory-swap "$memory" \
    --docker-volumes ragenodes-gitlab-runner-cache:/cache
}

register_runner "$GITLAB_RUNNER_GENERAL_TOKEN" "RageNodes Local General" 3 3 4g
register_runner "$GITLAB_RUNNER_RUST_TOKEN" "RageNodes Local Rust" 1 6 8g

docker compose -f compose.yml run --rm --entrypoint sh runner -c \
  "sed -i 's/^concurrent = .*/concurrent = 4/; s/^check_interval = .*/check_interval = 3/' /etc/gitlab-runner/config.toml"

docker compose -f compose.yml up -d runner
docker compose -f compose.yml exec runner gitlab-runner verify

echo "Runner local registrado. El coordinador queda a la escucha; los jobs se crean solo cuando GitLab los necesita."
