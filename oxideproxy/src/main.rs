pub mod access_gate;
pub mod config;
pub mod ebpf_xdp;
pub mod egress;
pub mod ingress;
pub mod metrics;
pub mod pipeline;

use crate::config::ProxyConfig;
use crate::ingress::start_ingress;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

const DEFAULT_CONFIG_RELOAD_DEBOUNCE_MS: u64 = 30_000;

fn config_reload_debounce() -> std::time::Duration {
    let millis = std::env::var("OXIDE_CONFIG_RELOAD_DEBOUNCE_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value >= 2_000)
        .unwrap_or(DEFAULT_CONFIG_RELOAD_DEBOUNCE_MS);
    std::time::Duration::from_millis(millis)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Configuración de telemetría asíncrona no bloqueante (Stdout + Archivo Rotativo)
    let log_dir = std::env::var("OXIDE_LOG_DIR").unwrap_or_else(|_| "/app/runtime/logs".into());
    std::fs::create_dir_all(&log_dir)?;
    let file_appender = tracing_appender::rolling::daily(log_dir, "oxide_proxy.log");
    let (non_blocking_file, _guard_file) = tracing_appender::non_blocking(file_appender);
    let (non_blocking_stdout, _guard_stdout) = tracing_appender::non_blocking(std::io::stdout());

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "warn,oxide_proxy=info".into()),
        ))
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking_stdout))
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(non_blocking_file)
                .with_ansi(false),
        )
        .init();

    tracing::info!("=== Arrancando OxideProxy (Motor L4/L7 Asíncrono Ultra-Optimizado) ===");

    access_gate::initialize()?;

    // Fallar de forma cerrada: una configuracion ausente o invalida nunca debe
    // activar rutas de laboratorio ni un backend alternativo silencioso.
    let config_path = std::env::var("OXIDE_CONFIG_PATH")
        .unwrap_or_else(|_| "config/oxide_proxy.yml".into());
    let config = ProxyConfig::load(&config_path)?;

    let worker_threads = config.runtime.worker_threads.unwrap_or_else(|| {
        let cores = num_cpus();
        tracing::info!(
            "Auto-detectados {} núcleos físicos para el pool de Tokio.",
            cores
        );
        cores
    });

    tracing::info!(
        "Inicializando runtime de Tokio con {} hilos de trabajo (Core Pinning: {})...",
        worker_threads,
        config.runtime.enable_core_pinning
    );

    let enable_pinning = config.runtime.enable_core_pinning;
    let available_cores = if enable_pinning {
        eligible_cpu_ids()
    } else {
        Vec::new()
    };
    if enable_pinning && available_cores.is_empty() {
        tracing::warn!("Core Pinning solicitado, pero el contenedor no expone núcleos elegibles.");
    }
    let available_cores = Arc::new(available_cores);
    let next_core = Arc::new(AtomicUsize::new(0));
    let thread_cores = Arc::clone(&available_cores);
    let thread_index = Arc::clone(&next_core);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_threads)
        .enable_all()
        .on_thread_start(move || {
            if enable_pinning && !thread_cores.is_empty() {
                let index = thread_index.fetch_add(1, Ordering::Relaxed) % thread_cores.len();
                let core = thread_cores[index];
                if pin_current_thread(core) {
                    tracing::debug!("Hilo de Tokio fijado al núcleo {}.", core);
                } else {
                    tracing::warn!("No se pudo fijar un hilo de Tokio al núcleo {}.", core);
                }
            } else {
                tracing::debug!("Hilo de trabajo de Tokio iniciado sin Core Pinning.");
            }
        })
        .build()?;

    runtime.block_on(async {
        if std::env::var("OXIDE_EXIT_ON_CONFIG_CHANGE")
            .is_ok_and(|value| value.eq_ignore_ascii_case("true") || value == "1")
        {
            let watched_path = config_path.clone();
            tokio::spawn(async move {
                let mut last_seen = std::fs::metadata(&watched_path)
                    .and_then(|metadata| metadata.modified())
                    .ok();
                let mut last_change = None;
                let debounce = config_reload_debounce();
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    let current = std::fs::metadata(&watched_path)
                        .and_then(|metadata| metadata.modified())
                        .ok();
                    if current.is_some() && current != last_seen {
                        last_seen = current;
                        last_change = Some(tokio::time::Instant::now());
                        tracing::info!(
                            "Configuración de rutas modificada; esperando {:?} de estabilidad antes de recargar.",
                            debounce
                        );
                    }
                    if last_change.is_some_and(|changed| changed.elapsed() >= debounce) {
                        tracing::info!("Configuración de rutas modificada; reinicio controlado solicitado.");
                        std::process::exit(75);
                    }
                }
            });
        }
        let metrics_path = std::env::var("OXIDE_METRICS_PATH")
            .unwrap_or_else(|_| "/app/runtime/game_metrics.json".into());
        tokio::spawn(metrics::write_snapshots(metrics_path));
        if let Err(e) = start_ingress(config, worker_threads, config_path).await {
            tracing::error!("Error crítico en el bucle principal de Ingress: {}", e);
        }
    });

    Ok(())
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|p| p.get())
        .unwrap_or(4)
}

#[cfg(target_os = "linux")]
const CPU_SET_WORDS: usize = 16;

#[cfg(target_os = "linux")]
type CpuSet = [u64; CPU_SET_WORDS];

#[cfg(target_os = "linux")]
unsafe extern "C" {
    fn sched_getaffinity(pid: i32, cpusetsize: usize, mask: *mut CpuSet) -> i32;
    fn sched_setaffinity(pid: i32, cpusetsize: usize, mask: *const CpuSet) -> i32;
}

#[cfg(target_os = "linux")]
fn eligible_cpu_ids() -> Vec<usize> {
    let mut mask: CpuSet = [0; CPU_SET_WORDS];
    let result = unsafe {
        sched_getaffinity(0, std::mem::size_of::<CpuSet>(), &mut mask)
    };
    if result != 0 {
        return (0..num_cpus()).collect();
    }
    mask.iter()
        .enumerate()
        .flat_map(|(word, bits)| {
            (0..64).filter_map(move |bit| {
                (bits & (1_u64 << bit) != 0).then_some(word * 64 + bit)
            })
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn pin_current_thread(cpu: usize) -> bool {
    if cpu >= CPU_SET_WORDS * 64 {
        return false;
    }
    let mut mask: CpuSet = [0; CPU_SET_WORDS];
    mask[cpu / 64] |= 1_u64 << (cpu % 64);
    unsafe { sched_setaffinity(0, std::mem::size_of::<CpuSet>(), &mask) == 0 }
}

#[cfg(not(target_os = "linux"))]
fn eligible_cpu_ids() -> Vec<usize> {
    (0..num_cpus()).collect()
}

#[cfg(not(target_os = "linux"))]
fn pin_current_thread(_cpu: usize) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::DEFAULT_CONFIG_RELOAD_DEBOUNCE_MS;

    #[test]
    fn route_reload_debounce_is_longer_than_the_reconciliation_poll() {
        assert!(DEFAULT_CONFIG_RELOAD_DEBOUNCE_MS >= 30_000);
    }
}
