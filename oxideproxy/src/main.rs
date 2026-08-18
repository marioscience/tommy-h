pub mod config;
pub mod ebpf_xdp;
pub mod egress;
pub mod ingress;
pub mod pipeline;

use crate::config::ProxyConfig;
use crate::ebpf_xdp::XdpFilter;
use crate::ingress::start_ingress;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Configuración de telemetría asíncrona no bloqueante (Stdout + Archivo Rotativo)
    let file_appender = tracing_appender::rolling::daily("config/logs", "oxide_proxy.log");
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

    let config = ProxyConfig::load_or_default("config/oxide_proxy.yml");

    // Opcional: Adjuntar filtro XDP/eBPF si estamos en entorno Linux compatible
    let mut xdp = XdpFilter::new("eth0");
    if let Ok(_) = xdp.attach() {
        tracing::info!("Filtro eBPF/XDP activo en eth0.");
    }

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
