use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, ToSocketAddrs};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProxyConfig {
    pub ingress: IngressConfig,
    pub routing: RoutingConfig,
    pub tls: TlsConfig,
    pub runtime: RuntimeConfig,
    pub advanced_tuning: Option<AdvancedTuningConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AdvancedTuningConfig {
    pub ebpf_xdp: Option<EbpfXdpConfig>,
    pub tcp_settings: Option<TcpSettingsConfig>,
    pub security: Option<SecurityConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EbpfXdpConfig {
    pub enabled: bool,
    pub interface: String,
    pub ddos_mitigation_mode: String,
    pub max_packet_rate_per_ip: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TcpSettingsConfig {
    pub tcp_nodelay: bool,
    pub keepalive_interval_secs: u64,
    pub congestion_control: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SecurityConfig {
    pub rate_limit_conns_per_ip: u32,
    pub blacklist_enabled: bool,
    pub handshake_timeout_ms: u64,
    pub blacklisted_ips: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IngressConfig {
    pub tcp_listen_addr: SocketAddr,
    pub udp_listen_addr: SocketAddr,
    pub max_concurrent_connections: usize,
    pub initial_buffer_size: usize,
}

fn default_socket_addr() -> SocketAddr {
    "0.0.0.0:0".parse().unwrap()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RoutingConfig {
    pub default_web_backend: String,
    #[serde(skip, default = "default_socket_addr")]
    pub default_web_backend_addr: SocketAddr,
    pub game_servers: Vec<GameServerRoute>,
    #[serde(skip)]
    pub game_servers_map: FxHashMap<u16, String>, // Mapa O(1) con host:puerto; se resuelve en cada conexion
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GameServerRoute {
    pub game_id: u16,
    pub backend_addr: String,
    pub description: String,
    pub port_range: Option<String>,
    pub name: Option<String>,
    pub protocol: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TlsConfig {
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuntimeConfig {
    pub worker_threads: Option<usize>,
    pub enable_core_pinning: bool,
}

fn detect_core_pinning() -> bool {
    if let Ok(val) = std::env::var("OXIDE_CORE_PINNING") {
        return val.eq_ignore_ascii_case("true") || val == "1";
    }
    // AutodetecciÃ³n: comprobar si es un entorno virtualizado
    if let Ok(vendor) = std::fs::read_to_string("/sys/class/dmi/id/sys_vendor") {
        let v = vendor.to_lowercase();
        if v.contains("qemu")
            || v.contains("digitalocean")
            || v.contains("amazon")
            || v.contains("google")
            || v.contains("vmware")
            || v.contains("microsoft")
        {
            tracing::debug!("AutodetecciÃ³n: Entorno virtualizado/VPS ({}) detectado. Desactivando Core Pinning por defecto para evitar contenciÃ³n de hilos.", vendor.trim());
            return false;
        }
    }
    tracing::debug!("AutodetecciÃ³n: Entorno Bare-metal detectado. Activando Core Pinning para mÃ¡ximo rendimiento.");
    true
}

impl Default for ProxyConfig {
    fn default() -> Self {
        // Mapeo directo a las IPs fijas de los contenedores mock en la red de laboratorio (10.5.0.0/16)
        let game_servers = vec![
            GameServerRoute {
                game_id: 1001,
                backend_addr: "10.5.0.10:9001".to_string(),
                description: "Mock MMORPG Realm (Python UDP en 10.5.0.10)".to_string(),
                port_range: Some("9001".to_string()),
                name: Some("Mock MMORPG Realm".to_string()),
                protocol: Some("UDP".to_string()),
            },
            GameServerRoute {
                game_id: 1002,
                backend_addr: "10.5.0.11:9002".to_string(),
                description: "Mock FPS Arena (Python UDP en 10.5.0.11)".to_string(),
                port_range: Some("9002".to_string()),
                name: Some("Mock FPS Arena".to_string()),
                protocol: Some("UDP".to_string()),
            },
        ];

        let mut game_servers_map = FxHashMap::default();
        for route in &game_servers {
            game_servers_map.insert(route.game_id, route.backend_addr.clone());
        }

        let default_web_backend = "10.5.0.12:80".to_string();
        let default_web_backend_addr = default_web_backend
            .to_socket_addrs()
            .ok()
            .and_then(|mut a| a.next())
            .unwrap_or_else(|| "10.5.0.12:80".parse().unwrap());

        Self {
            ingress: IngressConfig {
                tcp_listen_addr: "0.0.0.0:8443".parse().unwrap(),
                udp_listen_addr: "0.0.0.0:8080".parse().unwrap(),
                max_concurrent_connections: 1_000_000,
                initial_buffer_size: 4096,
            },
            routing: RoutingConfig {
                default_web_backend,
                default_web_backend_addr,
                game_servers,
                game_servers_map,
            },
            tls: TlsConfig {
                cert_path: PathBuf::from("config/certs/cert.pem"),
                key_path: PathBuf::from("config/certs/key.pem"),
            },
            runtime: RuntimeConfig {
                worker_threads: None, // Auto-detect physical cores
                enable_core_pinning: detect_core_pinning(),
            },
            advanced_tuning: Some(AdvancedTuningConfig {
                ebpf_xdp: Some(EbpfXdpConfig {
                    enabled: true,
                    interface: "eth0".to_string(),
                    ddos_mitigation_mode: "STRICT_GAMING".to_string(),
                    max_packet_rate_per_ip: 25000,
                }),
                tcp_settings: Some(TcpSettingsConfig {
                    tcp_nodelay: true,
                    keepalive_interval_secs: 30,
                    congestion_control: "bbr".to_string(),
                }),
                security: Some(SecurityConfig {
                    rate_limit_conns_per_ip: 150,
                    blacklist_enabled: true,
                    handshake_timeout_ms: 1500,
                    blacklisted_ips: Some(Vec::new()),
                }),
            }),
        }
    }
}

impl ProxyConfig {
    pub fn load_or_default(path: &str) -> Self {
        match std::fs::read_to_string(path) {
            Ok(content) => match serde_yaml::from_str::<ProxyConfig>(&content) {
                Ok(mut config) => {
                    let mut map = FxHashMap::default();
                    for route in &config.routing.game_servers {
                        map.insert(route.game_id, route.backend_addr.clone());
                    }
                    config.routing.game_servers_map = map;

                    let default_web_addr = config
                        .routing
                        .default_web_backend
                        .to_socket_addrs()
                        .ok()
                        .and_then(|mut a| a.next())
                        .unwrap_or_else(|| "127.0.0.1:80".parse().unwrap());
                    config.routing.default_web_backend_addr = default_web_addr;

                    config.runtime.enable_core_pinning = detect_core_pinning();

                    tracing::debug!(
                        "ConfiguraciÃ³n y tabla de ruteo O(1) cargadas exitosamente desde {}",
                        path
                    );
                    config
                }

                Err(e) => {
                    tracing::error!(
                        "Error al parsear {}, usando configuraciÃ³n por defecto: {}",
                        path,
                        e
                    );
                    Self::default()
                }
            },
            Err(_) => {
                tracing::warn!("Archivo de configuraciÃ³n {} no encontrado. Generando configuraciÃ³n por defecto.", path);
                let default_config = Self::default();
                if let Ok(yaml) = serde_yaml::to_string(&default_config) {
                    if let Some(prefix) = std::path::Path::new(path).parent() {
                        let _ = std::fs::create_dir_all(prefix);
                    }
                    let _ = std::fs::write(path, yaml);
                }
                default_config
            }
        }
    }
}
