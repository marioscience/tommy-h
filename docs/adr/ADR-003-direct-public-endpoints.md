# ADR-003: Direct Public Endpoints through OxideProxy

## Status

Accepted. Supersedes the previous Cloudflare tunnel namespace design.

## Context

The application previously created DNS records, synchronized tunnel ingress rules, and periodically deleted orphaned Cloudflare routes. That coupled server lifecycle operations to an external provider and allowed a provider outage or invalid token to create noisy failures unrelated to game-server health.

## Decision

- OxideProxy binds directly to the host address configured by `PROXY_BIND_IP`.
- Game and management ports are published directly by their containers.
- Public management URLs use `PUBLIC_ENDPOINT_HOST` and `PUBLIC_ENDPOINT_SCHEME` plus the assigned port.
- DNS, TLS termination, firewall rules, and router/NAT forwarding are managed by deployment infrastructure, outside the application.
- Backend workers do not create DNS records, synchronize tunnel ingress, or clean orphaned tunnels.

## Consequences

- Local development works without third-party credentials or network tunnels.
- Provider failures cannot interrupt server creation, repair, deletion, or maintenance.
- Deployments must explicitly configure firewall exposure, DNS, and TLS before production traffic is enabled.
