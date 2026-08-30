use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("no se pudo leer {path}: {source}")]
    Read {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("YAML invalido en {path}: {source}")]
    Parse {
        path: String,
        #[source]
        source: serde_yaml::Error,
    },
    #[error("configuracion invalida: {0}")]
    Invalid(String),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProxyConfig {
    pub ingress: IngressConfig,
    pub routing: RoutingConfig,
    pub tls: TlsConfig,
    pub runtime: RuntimeConfig,
    #[serde(default)]
    pub browser_security: BrowserSecurityConfig,
    pub advanced_tuning: Option<AdvancedTuningConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrowserSecurityConfig {
    #[serde(default = "default_allowed_frame_origins")]
    pub allowed_frame_origins: Vec<String>,
}

impl Default for BrowserSecurityConfig {
    fn default() -> Self {
        Self {
            allowed_frame_origins: default_allowed_frame_origins(),
        }
    }
}

fn default_allowed_frame_origins() -> Vec<String> {
    vec!["https://idms.fivem.net".to_string()]
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
    #[serde(default)]
    pub game_listen_ip: Option<IpAddr>,
    #[serde(default = "default_http_listen_addrs")]
    pub http_listen_addrs: Vec<SocketAddr>,
    pub max_concurrent_connections: usize,
    pub initial_buffer_size: usize,
}

fn default_http_listen_addrs() -> Vec<SocketAddr> {
    vec!["0.0.0.0:80".parse().unwrap(), "0.0.0.0:8088".parse().unwrap()]
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
        // Un valor por defecto nunca debe crear rutas de laboratorio. Los mocks
        // pertenecen exclusivamente al perfil `lab` y a su fichero de ejemplo.
        let game_servers = Vec::new();
        let game_servers_map = FxHashMap::default();
        let default_web_backend = "127.0.0.1:80".to_string();
        let default_web_backend_addr = "127.0.0.1:80".parse().unwrap();

        Self {
            ingress: IngressConfig {
                tcp_listen_addr: "0.0.0.0:8443".parse().unwrap(),
                udp_listen_addr: "0.0.0.0:8080".parse().unwrap(),
                game_listen_ip: None,
                http_listen_addrs: default_http_listen_addrs(),
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
            browser_security: BrowserSecurityConfig::default(),
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
    pub fn load(path: &str) -> Result<Self, ConfigError> {
        let content = std::fs::read_to_string(path).map_err(|source| ConfigError::Read {
            path: path.to_owned(),
            source,
        })?;
        let config =
            serde_yaml::from_str::<ProxyConfig>(&content).map_err(|source| ConfigError::Parse {
                path: path.to_owned(),
                source,
            })?;
        config.validate_and_hydrate()
    }

    fn validate_and_hydrate(mut self) -> Result<Self, ConfigError> {
        if self.browser_security.allowed_frame_origins.len() > 32 {
            return Err(ConfigError::Invalid(
                "browser_security.allowed_frame_origins admite un maximo de 32 origenes".into(),
            ));
        }
        let mut normalized_origins = Vec::new();
        for value in &self.browser_security.allowed_frame_origins {
            let parsed = url::Url::parse(value).map_err(|_| {
                ConfigError::Invalid(format!("origen web invalido: {value}"))
            })?;
            if parsed.scheme() != "https"
                || parsed.host_str().is_none()
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || parsed.query().is_some()
                || parsed.fragment().is_some()
                || parsed.path() != "/"
            {
                return Err(ConfigError::Invalid(format!(
                    "el origen web debe ser HTTPS y no incluir ruta, credenciales, consulta ni fragmento: {value}"
                )));
            }
            let origin = parsed.origin().ascii_serialization();
            if !normalized_origins.contains(&origin) {
                normalized_origins.push(origin);
            }
        }
        self.browser_security.allowed_frame_origins = normalized_origins;

        let default_web_addr = self
            .routing
            .default_web_backend
            .to_socket_addrs()
            .map_err(|e| {
                ConfigError::Invalid(format!(
                    "default_web_backend no se puede resolver ({}): {}",
                    self.routing.default_web_backend, e
                ))
            })?
            .next()
            .ok_or_else(|| {
                ConfigError::Invalid("default_web_backend no resolvio ninguna direccion".into())
            })?;

        let mut map = FxHashMap::default();
        let mut listen_ports = std::collections::HashMap::<u16, u8>::new();
        for route in &self.routing.game_servers {
            if route.game_id == 0 {
                return Err(ConfigError::Invalid("game_id 0 no esta permitido".into()));
            }
            let backend_addr = route
                .backend_addr
                .to_socket_addrs()
                .map_err(|e| {
                    ConfigError::Invalid(format!(
                        "backend_addr invalido para game_id {}: {}",
                        route.game_id, e
                    ))
                })?
                .next()
                .ok_or_else(|| {
                    ConfigError::Invalid(format!(
                        "backend_addr sin direccion para game_id {}",
                        route.game_id
                    ))
                })?;
            let protocol = route
                .protocol
                .as_deref()
                .unwrap_or("DUAL")
                .to_ascii_uppercase();
            if !matches!(protocol.as_str(), "TCP" | "UDP" | "DUAL") {
                return Err(ConfigError::Invalid(format!(
                    "protocolo no admitido para game_id {}",
                    route.game_id
                )));
            }
            let listen_port = match route.port_range.as_deref() {
                Some(port) => port.parse::<u16>().map_err(|_| {
                    ConfigError::Invalid(format!(
                        "port_range debe ser un unico puerto valido para game_id {}",
                        route.game_id
                    ))
                })?,
                None => backend_addr.port(),
            };
            if listen_port == 0
                || listen_port == self.ingress.tcp_listen_addr.port()
                || listen_port == self.ingress.udp_listen_addr.port()
            {
                return Err(ConfigError::Invalid(format!(
                    "puerto de escucha invalido o duplicado para game_id {}",
                    route.game_id
                )));
            }
            let mask = match protocol.as_str() {
                "TCP" => 0b01,
                "UDP" => 0b10,
                _ => 0b11,
            };
            let used = listen_ports.entry(listen_port).or_default();
            if *used & mask != 0 {
                return Err(ConfigError::Invalid(format!(
                    "puerto de escucha invalido o duplicado para game_id {}",
                    route.game_id
                )));
            }
            *used |= mask;
            if map
                .insert(route.game_id, route.backend_addr.clone())
                .is_some()
            {
                return Err(ConfigError::Invalid(format!(
                    "game_id duplicado: {}",
                    route.game_id
                )));
            }
        }

        self.routing.default_web_backend_addr = default_web_addr;
        self.routing.game_servers_map = map;
        // El valor persistido en YAML es la fuente de verdad. Solo una variable
        // de entorno explicita puede sustituirlo para operaciones de emergencia.
        if let Ok(value) = std::env::var("OXIDE_CORE_PINNING") {
            self.runtime.enable_core_pinning =
                value.eq_ignore_ascii_case("true") || value == "1";
        }
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_do_not_expose_lab_routes() {
        let config = ProxyConfig::default();
        assert!(config.routing.game_servers.is_empty());
        assert!(config.routing.game_servers_map.is_empty());
    }

    #[test]
    fn duplicate_game_ids_fail_closed() {
        let mut config = ProxyConfig::default();
        let route = GameServerRoute {
            game_id: 25565,
            backend_addr: "127.0.0.1:25565".into(),
            description: "test".into(),
            port_range: Some("35565".into()),
            name: None,
            protocol: Some("TCP".into()),
        };
        config.routing.game_servers = vec![route.clone(), route];
        assert!(config.validate_and_hydrate().is_err());
    }

    #[test]
    fn invalid_protocol_fails_closed() {
        let mut config = ProxyConfig::default();
        config.routing.game_servers.push(GameServerRoute {
            game_id: 30120,
            backend_addr: "127.0.0.1:30120".into(),
            description: "test".into(),
            port_range: Some("30120".into()),
            name: None,
            protocol: Some("SCTP".into()),
        });
        assert!(config.validate_and_hydrate().is_err());
    }

    #[test]
    fn persisted_core_pinning_is_not_overwritten_during_hydration() {
        std::env::remove_var("OXIDE_CORE_PINNING");
        let mut enabled = ProxyConfig::default();
        enabled.runtime.enable_core_pinning = true;
        assert!(enabled.validate_and_hydrate().unwrap().runtime.enable_core_pinning);

        let mut disabled = ProxyConfig::default();
        disabled.runtime.enable_core_pinning = false;
        assert!(!disabled.validate_and_hydrate().unwrap().runtime.enable_core_pinning);
    }

    #[test]
    fn browser_frame_origins_require_exact_https_origins() {
        let mut config = ProxyConfig::default();
        config.browser_security.allowed_frame_origins = vec![
            "http://idms.fivem.net".into(),
            "https://example.com/path".into(),
        ];
        assert!(config.validate_and_hydrate().is_err());
    }

    #[test]
    fn browser_frame_origins_are_normalized_and_deduplicated() {
        let mut config = ProxyConfig::default();
        config.browser_security.allowed_frame_origins = vec![
            "https://idms.fivem.net".into(),
            "https://idms.fivem.net:443".into(),
        ];
        let hydrated = config.validate_and_hydrate().unwrap();
        assert_eq!(
            hydrated.browser_security.allowed_frame_origins,
            vec!["https://idms.fivem.net"]
        );
    }
}
