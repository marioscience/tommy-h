# GitLab Container Registry deployments

RageNodes uses a build-once deployment path for its application containers. A
successful pipeline on `niko-local` builds the backend/workers, bot,
OxideProxy and OxideProxy control-panel images once, pushes them to the private
GitLab Container Registry and emits `registry-release.env` with digest-pinned
references.

CI uses four isolated daemonless Kaniko jobs. They receive neither the host
Docker socket nor privileged mode. Layer caches live in the private registry
alongside each component, and the four application images build in parallel.

Digest references are mandatory. Mutable tags such as `latest`, `main` or
`staging` are not deployment inputs. The same digest can therefore be promoted
through development, staging and production without recompilation or image
drift.

## Active rollout

`deploy.sh` and `deploy_staging.sh` load the reviewed
`deploy/registry-release.lock`, download every application image by immutable
digest and apply the corresponding Compose overlay. Existing databases,
customer volumes and game containers are not replaced. A source build remains
available only as a recovery path when `RAGENODES_REGISTRY_REQUIRED=false`.

The registry overlays can be validated with:

```bash
set -a
. ./.env
. ./registry-release.env
set +a
docker compose -f docker-compose.yml -f docker-compose.registry.yml config --quiet
docker compose -f docker-compose.staging.yml -f docker-compose.registry.staging.yml config --quiet
```

Set `RAGENODES_REGISTRY_REQUIRED=true` after read-only private-registry
credentials have been installed on a target to prevent silent source-build
fallback. The normal production data volumes are not stored in the registry.

For every application release, promote the `registry-release.env` artifact
created by the successful `niko-local` package pipeline to
`deploy/registry-release.lock` in the reviewed merge request. Never edit a
digest by hand or point this lock at mutable tags. Staging and production then
consume the same four digests, preserving build-once semantics.

## Master game images

FiveM and Blender masters and the digest-pinned upstream images for the other
deployable services remain managed by the version-aware local master-image
cache. They have different update lifecycles from the application containers
and are intentionally not rebuilt by every source commit.

## Important transition boundary

The current Compose model still bind-mounts selected source and frontend paths
for operational compatibility. The registry images eliminate repeated build
work, but a later reviewed phase must move those development mounts to a local
overlay before production can be described as fully immutable. Until then,
the source checkout and image manifest must refer to the same reviewed commit.
