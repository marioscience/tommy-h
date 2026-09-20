# Backend autoscaling runbook

RageNodes can scale its stateless API from two to four replicas without adding
another proxy. OxideProxy discovers every `backend` address through Docker DNS
and distributes HTTP requests using its native round-robin pool.

## Safety model

- Autoscaling is disabled by default and must first be observed in staging.
- The controller changes one replica per evaluation and never exceeds the
  configured minimum or maximum.
- Scale-up requires sustained CPU, HTTP p95, event-loop delay, or reinforced
  error-rate pressure. Scale-down requires a longer sustained idle period.
- Provisioning queue depth is reported but does not scale the API. That queue is
  constrained by deployment workers, node capacity and disk throughput.
- A filesystem lock prevents overlapping evaluations. A stale lock is reclaimed
  after five minutes.
- Every scale operation must finish with the expected number of healthy
  containers before its decision is persisted.
- OxideProxy refreshes Docker DNS every five seconds and retains the last known
  valid backend set through transient resolver failures; an empty initial
  resolution still fails closed with HTTP 503.
- API processes drain HTTP connections and close PostgreSQL/Redis clients on
  `SIGTERM`; scale-down therefore does not abruptly discard normal requests.
- Authentication, administration, ticket and checkout limits use Redis so their
  security budget is shared by all replicas. If Redis is temporarily absent,
  the API stays available with a clearly logged per-process fallback.

## Installation and staged activation

Run the installer on each control-plane host with the local application user:

```bash
sudo ./scripts/deploy/install_backend_autoscaler.sh /opt/ragenodes-ultimate niko
```

Review `/etc/ragenodes/backend-autoscaler.env`. The project name and Docker
socket must identify that environment. Keep `BACKEND_AUTOSCALE_ENABLED=false`
through deployment and smoke tests, then enable it only in staging:

```text
BACKEND_AUTOSCALE_ENABLED=true
BACKEND_AUTOSCALE_MIN=2
BACKEND_AUTOSCALE_MAX=4
```

Inspect decisions with:

```bash
systemctl status ragenodes-backend-autoscaler.timer
journalctl -u ragenodes-backend-autoscaler.service
```

The endpoint `/internal/autoscaling` is reachable only from container loopback.
It is intentionally not exposed through OxideProxy or the public API.

## Promotion gate

Before enabling production, staging must demonstrate all of the following:

1. two consecutive samples scale 2 → 3 during controlled load;
2. the new replica becomes healthy and receives requests through OxideProxy;
3. sustained idle scales 3 → 2 only after the downscale delay;
4. in-flight requests complete during scale-down;
5. rate-limit counters remain shared while traffic alternates replicas;
6. PostgreSQL `waiting` remains zero and its aggregate connection budget stays
   below the database limit;
7. disabling the feature leaves the configured replica count unchanged.

The isolated Docker integration check can be repeated with:

```bash
bash scripts/deploy/backend_autoscaler.integration.sh
```

It creates a uniquely named temporary Compose project, verifies a healthy 1 → 2
scale operation, and removes that project on exit. It never addresses the
RageNodes production Compose project.

The Redis sharing contract is exercised by the integration suite when
`RUN_REDIS_INTEGRATION=1` and `REDIS_URL` points to its isolated test Redis.

Rollback is immediate: set `BACKEND_AUTOSCALE_ENABLED=false`, stop the timer,
and apply the desired fixed count with Docker Compose. No schema migration or
frontend rollback is involved.
