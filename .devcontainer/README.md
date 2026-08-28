# RageNodes development container

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

5. Start the local stack explicitly when required:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
   ```

## Security boundary

The development container is privileged so its isolated Docker daemon can run.
The host Docker socket is deliberately not mounted, so this workspace cannot
control host, staging or production containers. Treat it as a trusted developer
environment: do not copy production credentials into it, commit `.env`, or use
it as a public server.

Rebuilding the development container removes its internal Docker state unless
the supporting tool preserves it. Customer data and master-image archives must
never be kept only inside this environment.
