#!/bin/sh
set -eu

: "${CI_REGISTRY:?Set CI_REGISTRY}"
: "${CI_REGISTRY_IMAGE:?Set CI_REGISTRY_IMAGE}"
: "${CI_REGISTRY_USER:?Set CI_REGISTRY_USER}"
: "${CI_REGISTRY_PASSWORD:?Set CI_REGISTRY_PASSWORD}"
: "${CI_COMMIT_SHA:?Set CI_COMMIT_SHA}"
: "${CI_PROJECT_DIR:?Set CI_PROJECT_DIR}"
: "${COMPONENT:?Set COMPONENT}"
: "${BUILD_CONTEXT:?Set BUILD_CONTEXT}"
: "${IMAGE_ENV_VAR:?Set IMAGE_ENV_VAR}"

case "$CI_COMMIT_SHA" in
  latest|dev|staging|main|niko-local|"")
    echo "CI_COMMIT_SHA must be an immutable commit identifier." >&2
    exit 2
    ;;
esac

case "$COMPONENT" in
  backend|bot|oxideproxy|oxide-control-panel) ;;
  *) echo "Unsupported registry component: $COMPONENT" >&2; exit 2 ;;
esac

docker_config_dir="/kaniko/.docker"
output_dir="$CI_PROJECT_DIR/registry-images"
digest_file="$output_dir/$COMPONENT.digest"
env_file="$output_dir/$COMPONENT.env"
image_ref="$CI_REGISTRY_IMAGE/$COMPONENT:$CI_COMMIT_SHA"
cache_ref="$CI_REGISTRY_IMAGE/$COMPONENT/cache"
kaniko_network_retries="${KANIKO_NETWORK_RETRIES:-3}"
cache_free_attempts="${KANIKO_CACHE_FREE_ATTEMPTS:-3}"

case "$kaniko_network_retries:$cache_free_attempts" in
  [1-5]:[1-5]) ;;
  *) echo "Kaniko retry limits must be integers between 1 and 5." >&2; exit 2 ;;
esac

mkdir -p "$docker_config_dir" "$output_dir"
registry_auth="$(printf '%s:%s' "$CI_REGISTRY_USER" "$CI_REGISTRY_PASSWORD" | base64 | tr -d '\n')"
printf '{"auths":{"%s":{"auth":"%s"}}}\n' "$CI_REGISTRY" "$registry_auth" > "$docker_config_dir/config.json"
chmod 600 "$docker_config_dir/config.json"

run_kaniko() {
  cache_enabled="$1"
  if [ "$cache_enabled" = "true" ]; then
    /kaniko/executor \
      --context "$CI_PROJECT_DIR/$BUILD_CONTEXT" \
      --dockerfile "$CI_PROJECT_DIR/$BUILD_CONTEXT/Dockerfile" \
      --destination "$image_ref" \
      --cache=true \
      --cache-repo "$cache_ref" \
      --image-download-retry "$kaniko_network_retries" \
      --image-fs-extract-retry "$kaniko_network_retries" \
      --push-retry "$kaniko_network_retries" \
      --digest-file "$digest_file" \
      --label "org.opencontainers.image.revision=$CI_COMMIT_SHA" \
      --label "org.opencontainers.image.source=${CI_PROJECT_URL:-local}"
  else
    /kaniko/executor \
      --context "$CI_PROJECT_DIR/$BUILD_CONTEXT" \
      --dockerfile "$CI_PROJECT_DIR/$BUILD_CONTEXT/Dockerfile" \
      --destination "$image_ref" \
      --cache=false \
      --image-download-retry "$kaniko_network_retries" \
      --image-fs-extract-retry "$kaniko_network_retries" \
      --push-retry "$kaniko_network_retries" \
      --digest-file "$digest_file" \
      --label "org.opencontainers.image.revision=$CI_COMMIT_SHA" \
      --label "org.opencontainers.image.source=${CI_PROJECT_URL:-local}"
  fi
}

reset_kaniko_workspace() {
  # A failed executor run can leave extracted stages behind. Reusing that
  # workspace makes the cache-free retry fail on files and symlinks that were
  # already created by the first attempt (for example node_modules/.bin).
  # Keep /kaniko/.docker and the executor itself; only discard build state.
  rm -rf /kaniko/0 /kaniko/stages
}

if ! run_kaniko true; then
  echo "Kaniko cache build failed; switching to clean cache-free attempts." >&2
  attempt=1
  while :; do
    rm -f "$digest_file"
    reset_kaniko_workspace
    if run_kaniko false; then
      break
    fi
    if [ "$attempt" -ge "$cache_free_attempts" ]; then
      echo "Kaniko failed after $cache_free_attempts cache-free attempts." >&2
      exit 1
    fi
    delay=$((attempt * 15))
    echo "Kaniko cache-free attempt $attempt failed; retrying in ${delay}s." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
fi

digest="$(tr -d '\r\n' < "$digest_file")"
case "$digest" in
  sha256:*) ;;
  *) echo "Kaniko did not return an immutable digest for $COMPONENT." >&2; exit 3 ;;
esac

printf '%s=%s/%s@%s\n' "$IMAGE_ENV_VAR" "$CI_REGISTRY_IMAGE" "$COMPONENT" "$digest" > "$env_file"
echo "Published $COMPONENT as an immutable image."
