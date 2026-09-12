# RageNodes development container

For the quick component workflow run `bash dev setup`, `bash dev doctor`, then
`bash dev up frontend` (mock) or `bash dev up core` (real API and databases).
See [local development](../docs/LOCAL-DEVELOPMENT.md). Forwarded ports are
13010, 18088 and 18089. eBPF setup is now opt-in:
`bash .devcontainer/setup-ebpf.sh`. The full integration workflow below is optional.

This definition provides Node.js 24, Rust, Docker CLI/Compose and an isolated
Docker daemon. It installs the locked root and backend dependencies when the
container is created, but it does not start RageNodes, databases, game servers
or the base-image refresh process.

## First use

1. Open the repository in a tool that supports the Development Container
   Specification.
2. Select **Reopen in Container**.
3. Copy `.env.local.example` to `.env` only when you are ready to run the local
   stack, replace `${HOME}` with the container home path, and keep all values
   development-only.
4. Run tests before starting services:

   ```bash
   npm --prefix backend test
   npm run security:secrets
   npm run security:deployment
   ```

5. Start the complete local stack explicitly when required:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.local.yml build \
     oxide_control_panel oxide_game oxide_web
   docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
   ```

## Component-only development

All commands are run from the repository root. Compose includes the selected
service's required dependencies while leaving unrelated components stopped:

```bash
# Backend API and databases
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build backend

# Web frontend/proxy and its dependencies
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build oxide_web

# OxideProxy management panel and its dependencies
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build oxide_control_panel

# Game proxy/XDP integration stack
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build oxide_game

# Bot, a single worker, or data services
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build bot
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build worker-backups
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d postgres mariadb redis
```

When dependencies are already running, `--no-deps` rebuilds/restarts only the
named service. Do not use it for the first start. Files in `frontend/public` are
bind-mounted into `oxide_web`, so static frontend edits normally require only a
browser refresh. Follow one service with
`docker compose -f docker-compose.yml -f docker-compose.local.yml logs -f <service>`.

The Dev Container supports building and integration-testing `oxide_game`, but
real NIC/XDP attachment must be validated on a suitable native Linux host.

## Security boundary

The development container is privileged so its isolated Docker daemon can run.
The host Docker socket is deliberately not mounted, so this workspace cannot
control host, staging or production containers. Treat it as a trusted developer
environment: do not copy production credentials into it, commit `.env`, or use
it as a public server.

Rebuilding the development container removes its internal Docker state unless
the supporting tool preserves it. Customer data and master-image archives must
never be kept only inside this environment.
