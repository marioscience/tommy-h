pub mod access_gate;
pub mod config;
pub mod ebpf_xdp;
pub mod egress;
pub mod ingress;
pub mod metrics;
pub mod pipeline;

use crate::config::ProxyConfig;
use crate::ingress::start_ingress;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

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
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_threads)
        .enable_all()
        .on_thread_start(move || {
            if enable_pinning {
                // Aquí se configuraría la afinidad de CPU (Core Pinning) mediante core_affinity o APIs del SO.
                tracing::debug!("Hilo de trabajo de Tokio iniciado con Core Pinning activo.");
            } else {
                tracing::debug!("Hilo de trabajo de Tokio iniciado (Core Pinning desactivado por entorno virtualizado).");
            }
        })
        .build()?;

    runtime.block_on(async {
        if std::env::var("OXIDE_EXIT_ON_CONFIG_CHANGE")
            .is_ok_and(|value| value.eq_ignore_ascii_case("true") || value == "1")
        {
            let watched_path = config_path.clone();
            tokio::spawn(async move {
                let initial = std::fs::metadata(&watched_path)
                    .and_then(|metadata| metadata.modified())
                    .ok();
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    let current = std::fs::metadata(&watched_path)
                        .and_then(|metadata| metadata.modified())
                        .ok();
                    if initial.is_some() && current.is_some() && current != initial {
                        tracing::info!("Configuración de rutas modificada; reinicio controlado solicitado.");
                        std::process::exit(75);
                    }
                }
            });
        }
        let metrics_path = std::env::var("OXIDE_METRICS_PATH")
            .unwrap_or_else(|_| "/app/runtime/game_metrics.json".into());
        tokio::spawn(metrics::write_snapshots(metrics_path));
        if let Err(e) = start_ingress(config, worker_threads).await {
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
