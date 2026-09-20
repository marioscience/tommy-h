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

        let mut resolved: Vec<_> = lookup_host(&self.target)
            .await
            .map_err(|error| format!("no se pudo resolver {}: {error}", self.target))?
            .collect();
        resolved.sort_unstable();
        resolved.dedup();
        if resolved.is_empty() {
            return Err(format!("{} no resolvió miembros", self.target));
        }

        let mut state = self.state.write().await;
        state.addresses = resolved;
        state.resolved_at = Some(Instant::now());
        let active_addresses = state.addresses.clone();
        state
            .failed_until
            .retain(|address, _| active_addresses.contains(address));
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
}
