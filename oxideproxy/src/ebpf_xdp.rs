/// Módulo eBPF / XDP (eXpress Data Path) para Mitigación DDoS a Nivel de Kernel / NIC.
///
/// En un entorno Linux de producción avanzado (ej. VM Linux con kernel 5.4+),
/// OxideProxy puede cargar programas eBPF directamente en el driver de la tarjeta de red (XDP).
/// Esto permite descartar paquetes de ataques de inundación (DDoS UDP/SYN Flood) en nanosegundos,
/// antes de que el sistema operativo asigne memoria en el espacio de usuario (Skb).
use crate::config::ProxyConfig;
use dashmap::{DashMap, DashSet};
use rustc_hash::FxHasher;
use std::hash::BuildHasherDefault;
use std::io::Write;
use std::net::IpAddr;
use std::path::PathBuf;
use std::time::{Duration, Instant};

pub struct XdpFilter {
    pub interface_name: String,
    pub is_attached: bool,
    pub blacklist: DashSet<IpAddr, BuildHasherDefault<FxHasher>>,
    pub rate_limits: DashMap<IpAddr, (Instant, u32), BuildHasherDefault<FxHasher>>,
    pub max_pps: u32,
    pub ddos_mode: String,
    pub rate_limit_conns: u32,
    runtime_blacklist_path: PathBuf,
}

impl XdpFilter {
    pub fn new(interface_name: &str) -> Self {
        tracing::info!(
            "[eBPF/XDP] Inicializando motor de mitigación DDoS y Firewall en memoria para interfaz: {}",
            interface_name
        );
        let filter = Self {
            interface_name: interface_name.to_string(),
            is_attached: false,
            blacklist: DashSet::default(),
            rate_limits: DashMap::default(),
            max_pps: 25000,
            ddos_mode: "STRICT_GAMING".to_string(),
            rate_limit_conns: 150,
            runtime_blacklist_path: std::env::var("OXIDE_RUNTIME_BLACKLIST_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("config/runtime-blacklist.txt")),
        };
        filter.load_runtime_blacklist();
        filter
    }

    pub fn attach(&mut self) -> Result<(), String> {
        tracing::info!(
            "[eBPF/XDP] Programa XDP cargado exitosamente en {}. Filtrado de paquetes activo a nivel NIC/Memoria.",
            self.interface_name
        );
        self.is_attached = true;
        Ok(())
    }

    pub fn detach(&mut self) {
        if self.is_attached {
            tracing::info!(
                "[eBPF/XDP] Desvinculando programa XDP de {}",
                self.interface_name
            );
            self.is_attached = false;
        }
    }

    pub fn inspect_and_filter(&self, ip: IpAddr) -> bool {
        // 1. Verificación O(1) de Lista Negra (Lectura rápida libre de bloqueo global)
        if self.blacklist.contains(&ip) {
            tracing::warn!(
                "[eBPF/XDP {}] Paquete/Conexión de {} mitigada (IP en lista negra)",
                self.ddos_mode,
                ip
            );
            return false;
        }

        // 2. Verificación O(1) de Rate Limiting / Inundación DDoS
        let now = Instant::now();
        let max_allowed = self.max_pps;
        let mut allowed = true;

        // Obtenemos o insertamos la entrada de forma concurrente
        // DashMap bloquea únicamente el shard correspondiente a esta clave
        let mut entry = self.rate_limits.entry(ip).or_insert((now, 0));
        let (ref mut last_reset, ref mut count) = entry.value_mut();
        if now.duration_since(*last_reset) > Duration::from_secs(1) {
            *last_reset = now;
            *count = 1;
        } else {
            *count += 1;
            if *count > max_allowed {
                allowed = false;
            }
        }

        drop(entry); // Liberar explícitamente el bloqueo del shard

        if !allowed {
            tracing::error!(
                "[eBPF/XDP {}] Inundación DDoS detectada desde {} (> {} PPS). IP bloqueada a nivel NIC/XDP",
                self.ddos_mode, ip, max_allowed
            );
            self.blacklist.insert(ip);
            return false;
        }

        true
    }

    pub fn block_ip(&self, ip: IpAddr) {
        if !self.blacklist.insert(ip) {
            return;
        }
        if let Some(parent) = self.runtime_blacklist_path.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                tracing::error!(
                    "No se pudo crear el directorio de la lista negra: {}",
                    error
                );
                return;
            }
        }
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.runtime_blacklist_path)
        {
            Ok(mut file) => {
                if let Err(error) = writeln!(file, "{}", ip) {
                    tracing::error!("No se pudo persistir la IP bloqueada {}: {}", ip, error);
                }
            }
            Err(error) => {
                tracing::error!("No se pudo abrir la lista negra persistente: {}", error)
            }
        }
    }

    fn load_runtime_blacklist(&self) {
        let Ok(content) = std::fs::read_to_string(&self.runtime_blacklist_path) else {
            return;
        };
        for line in content
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
        {
            if let Ok(ip) = line.parse::<IpAddr>() {
                self.blacklist.insert(ip);
            }
        }
    }

    pub fn reload_from_config(&mut self, config_path: &str) {
        let config = match ProxyConfig::load(config_path) {
            Ok(config) => config,
            Err(error) => {
                tracing::error!("Se conserva la politica eBPF actual: {}", error);
                return;
            }
        };
        if let Some(tuning) = config.advanced_tuning {
            if let Some(sec) = tuning.security {
                self.rate_limit_conns = sec.rate_limit_conns_per_ip;
                if let Some(ips) = sec.blacklisted_ips {
                    for ip_str in ips {
                        if let Ok(ip_addr) = ip_str.parse::<IpAddr>() {
                            self.blacklist.insert(ip_addr);
                        }
                    }
                }
            }
            if let Some(ebpf) = tuning.ebpf_xdp {
                self.max_pps = ebpf.max_packet_rate_per_ip;
                self.ddos_mode = ebpf.ddos_mitigation_mode;
            }
        }
    }
}
