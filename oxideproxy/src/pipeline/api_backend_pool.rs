use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::net::lookup_host;
use tokio::sync::RwLock;

#[derive(Debug)]
pub struct ApiBackendPool {
    target: String,
    dns_ttl: Duration,
    failure_cooldown: Duration,
    cursor: AtomicUsize,
    state: RwLock<PoolState>,
}

#[derive(Debug, Default)]
struct PoolState {
    addresses: Vec<SocketAddr>,
    resolved_at: Option<Instant>,
    failed_until: HashMap<SocketAddr, Instant>,
}

impl ApiBackendPool {
    pub fn from_env() -> Self {
        Self::new(
            std::env::var("OXIDE_API_BACKEND").unwrap_or_else(|_| "backend:3006".into()),
            env_duration("OXIDE_API_DNS_TTL_SECONDS", 5),
            env_duration("OXIDE_API_FAILURE_COOLDOWN_SECONDS", 5),
        )
    }

    fn new(target: String, dns_ttl: Duration, failure_cooldown: Duration) -> Self {
        Self {
            target,
            dns_ttl,
            failure_cooldown,
            cursor: AtomicUsize::new(0),
            state: RwLock::new(PoolState::default()),
        }
    }

    pub async fn select(&self) -> Result<SocketAddr, String> {
        self.refresh_if_needed().await?;
        let now = Instant::now();
        let state = self.state.read().await;
        let healthy: Vec<_> = state
            .addresses
            .iter()
            .copied()
            .filter(|address| {
                state
                    .failed_until
                    .get(address)
                    .map_or(true, |until| *until <= now)
            })
            .collect();
        let candidates = if healthy.is_empty() {
            &state.addresses
        } else {
            &healthy
        };
        if candidates.is_empty() {
            return Err(format!("{} no resolvió miembros", self.target));
        }
        let index = self.cursor.fetch_add(1, Ordering::Relaxed) % candidates.len();
        Ok(candidates[index])
    }

    pub async fn mark_failed(&self, address: SocketAddr) {
        self.state
            .write()
            .await
            .failed_until
            .insert(address, Instant::now() + self.failure_cooldown);
    }

    pub async fn mark_healthy(&self, address: SocketAddr) {
        self.state.write().await.failed_until.remove(&address);
    }

    async fn refresh_if_needed(&self) -> Result<(), String> {
        let should_refresh = {
            let state = self.state.read().await;
            state.addresses.is_empty()
                || state
                    .resolved_at
                    .map_or(true, |resolved| resolved.elapsed() >= self.dns_ttl)
        };
        if !should_refresh {
            return Ok(());
        }

        let lookup = lookup_host(&self.target)
            .await
            .map(|addresses| addresses.collect::<Vec<_>>())
            .map_err(|error| format!("no se pudo resolver {}: {error}", self.target));
        self.apply_resolution(lookup).await
    }

    async fn apply_resolution(
        &self,
        lookup: Result<Vec<SocketAddr>, String>,
    ) -> Result<(), String> {
        let mut resolved = match lookup {
            Ok(addresses) if !addresses.is_empty() => addresses,
            Ok(_) => {
                return self
                    .keep_stale_or_fail(format!("{} no resolvió miembros", self.target))
                    .await
            }
            Err(error) => return self.keep_stale_or_fail(error).await,
        };
        resolved.sort_unstable();
        resolved.dedup();

        let mut state = self.state.write().await;
        state.addresses = resolved;
        state.resolved_at = Some(Instant::now());
        let active_addresses = state.addresses.clone();
        state
            .failed_until
            .retain(|address, _| active_addresses.contains(address));
        Ok(())
    }

    async fn keep_stale_or_fail(&self, error: String) -> Result<(), String> {
        let mut state = self.state.write().await;
        if state.addresses.is_empty() {
            return Err(error);
        }
        state.resolved_at = Some(Instant::now());
        tracing::warn!(
            target = %self.target,
            error = %error,
            "Docker DNS falló; conservando el último conjunto de réplicas API válido"
        );
        Ok(())
    }
}

fn env_duration(name: &str, default_seconds: u64) -> Duration {
    Duration::from_secs(
        std::env::var(name)
            .ok()
            .and_then(|value| value.parse().ok())
            .filter(|value| *value > 0)
            .unwrap_or(default_seconds),
    )
}

pub fn shared_api_backend_pool() -> Arc<ApiBackendPool> {
    static POOL: OnceLock<Arc<ApiBackendPool>> = OnceLock::new();
    Arc::clone(POOL.get_or_init(|| Arc::new(ApiBackendPool::from_env())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rotates_and_temporarily_suppresses_failed_members() {
        let first: SocketAddr = "127.0.0.1:3006".parse().unwrap();
        let second: SocketAddr = "127.0.0.2:3006".parse().unwrap();
        let pool = ApiBackendPool::new(
            "unused:3006".into(),
            Duration::from_secs(60),
            Duration::from_secs(60),
        );
        {
            let mut state = pool.state.write().await;
            state.addresses = vec![first, second];
            state.resolved_at = Some(Instant::now());
        }

        assert_eq!(pool.select().await.unwrap(), first);
        assert_eq!(pool.select().await.unwrap(), second);
        pool.mark_failed(first).await;
        assert_eq!(pool.select().await.unwrap(), second);
        pool.mark_healthy(first).await;
        assert_eq!(pool.select().await.unwrap(), second);
        assert_eq!(pool.select().await.unwrap(), first);
    }

    #[tokio::test]
    async fn retains_last_known_members_during_a_transient_dns_failure() {
        let address: SocketAddr = "127.0.0.1:3006".parse().unwrap();
        let pool = ApiBackendPool::new(
            "backend:3006".into(),
            Duration::from_secs(5),
            Duration::from_secs(5),
        );
        pool.apply_resolution(Ok(vec![address])).await.unwrap();
        pool.apply_resolution(Err("temporary DNS failure".into()))
            .await
            .unwrap();

        let state = pool.state.read().await;
        assert_eq!(state.addresses, vec![address]);
        assert!(state.resolved_at.is_some());
    }

    #[tokio::test]
    async fn fails_closed_when_dns_has_never_produced_a_member() {
        let pool = ApiBackendPool::new(
            "backend:3006".into(),
            Duration::from_secs(5),
            Duration::from_secs(5),
        );
        assert!(pool
            .apply_resolution(Err("DNS unavailable".into()))
            .await
            .is_err());
    }
}
