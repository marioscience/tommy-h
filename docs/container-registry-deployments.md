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

## Current safe rollout

This first phase does not change the active deployment scripts. Source builds
remain the default and provide the manual recovery path while the registry path
is tested on `niko-local`. The registry overlays can be validated with:

```bash
set -a
. ./.env
. ./registry-release.env
set +a
docker compose -f docker-compose.yml -f docker-compose.registry.yml config --quiet
docker compose -f docker-compose.staging.yml -f docker-compose.registry.staging.yml config --quiet
```

Do not run `up` with the overlays until the release manifest belongs to a
reviewed commit and the private-registry credentials are installed on the target
host. The normal production data volumes are not stored in the registry.

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
