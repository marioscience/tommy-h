use crate::config::ProxyConfig;
use aya::{maps::{Array, HashMap as BpfHashMap, PerCpuArray}, programs::{Xdp, XdpFlags}, Ebpf, Pod};
use dashmap::{DashMap, DashSet};
use rustc_hash::FxHasher;
use std::hash::BuildHasherDefault;
use std::io::Write;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use std::time::{Duration, Instant};

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
struct PolicyConfig { window_ns: u64, max_pps: u32, enabled: u32, _reserved: [u32; 2] }

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct XdpStats {
    pub packets_seen: u64,
    pub packets_passed: u64,
    pub packets_dropped: u64,
    pub blacklist_drops: u64,
    pub rate_limit_drops: u64,
    pub parse_errors: u64,
}

unsafe impl Pod for PolicyConfig {}
unsafe impl Pod for XdpStats {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum XdpAttachMode { Driver, Generic, Memory, Disabled }

impl XdpAttachMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Driver => "xdp-driver",
            Self::Generic => "xdp-generic",
            Self::Memory => "memory",
            Self::Disabled => "disabled",
        }
    }
}

struct KernelXdp { ebpf: Ebpf, mode: XdpAttachMode }

pub struct XdpFilter {
    pub interface_name: String,
    pub blacklist: DashSet<IpAddr, BuildHasherDefault<FxHasher>>,
    pub rate_limits: DashMap<IpAddr, (Instant, u32), BuildHasherDefault<FxHasher>>,
    pub max_pps: u32,
    pub ddos_mode: String,
    pub rate_limit_conns: u32,
    runtime_blacklist_path: PathBuf,
    object_path: PathBuf,
    kernel: Option<KernelXdp>,
    enabled: bool,
    config_loaded: bool,
    config_modified: Option<SystemTime>,
}

impl XdpFilter {
    pub fn new(interface_name: &str) -> Self {
        let filter = Self {
            interface_name: interface_name.to_string(),
            blacklist: DashSet::default(),
            rate_limits: DashMap::default(),
            max_pps: 25_000,
            ddos_mode: "STRICT_GAMING".to_string(),
            rate_limit_conns: 150,
            runtime_blacklist_path: std::env::var("OXIDE_RUNTIME_BLACKLIST_PATH").map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("config/runtime-blacklist.txt")),
            object_path: std::env::var("OXIDE_EBPF_OBJECT_PATH").map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("/app/oxide-ebpf.o")),
            kernel: None,
            enabled: false,
            config_loaded: false,
            config_modified: None,
        };
        filter.load_runtime_blacklist();
        filter
    }

    pub fn attach(&mut self) -> Result<XdpAttachMode, String> {
        if !self.enabled { return Ok(XdpAttachMode::Disabled); }
        if !Path::new(&self.object_path).is_file() {
            return Err(format!("bytecode XDP ausente en {}", self.object_path.display()));
        }
        let mut ebpf = Ebpf::load_file(&self.object_path)
            .map_err(|error| format!("no se pudo cargar el objeto eBPF: {error}"))?;
        self.configure_kernel_policy(&mut ebpf)?;
        self.sync_kernel_blacklist(&mut ebpf)?;
        let program: &mut Xdp = ebpf.program_mut("oxide_xdp")
            .ok_or_else(|| "el objeto eBPF no contiene oxide_xdp".to_string())?
            .try_into().map_err(|error| format!("oxide_xdp no es XDP válido: {error}"))?;
        program.load().map_err(|error| format!("el verificador rechazó oxide_xdp: {error}"))?;

        let requested = std::env::var("OXIDE_XDP_MODE").unwrap_or_else(|_| "auto".into()).to_ascii_lowercase();
        let mode = match requested.as_str() {
            "driver" | "native" => {
                program.attach(&self.interface_name, XdpFlags::DRV_MODE)
                    .map_err(|error| format!("no se pudo adjuntar XDP nativo: {error}"))?;
                XdpAttachMode::Driver
            }
            "generic" | "skb" => {
                program.attach(&self.interface_name, XdpFlags::SKB_MODE)
                    .map_err(|error| format!("no se pudo adjuntar XDP genérico: {error}"))?;
                XdpAttachMode::Generic
            }
            "auto" => match program.attach(&self.interface_name, XdpFlags::DRV_MODE) {
                Ok(_) => XdpAttachMode::Driver,
                Err(driver_error) => {
                    tracing::warn!("XDP nativo no disponible: {}. Probando genérico.", driver_error);
                    program.attach(&self.interface_name, XdpFlags::SKB_MODE)
                        .map_err(|generic_error| format!("XDP nativo falló ({driver_error}); genérico falló ({generic_error})"))?;
                    XdpAttachMode::Generic
                }
            },
            other => return Err(format!("OXIDE_XDP_MODE inválido: {other}")),
        };
        tracing::info!("eBPF/XDP real adjuntado a {} en modo {}.", self.interface_name, mode.as_str());
        self.kernel = Some(KernelXdp { ebpf, mode });
        Ok(mode)
    }

    pub fn detach(&mut self) {
        if let Some(kernel) = self.kernel.take() {
            tracing::info!("Desadjuntando {} de {}.", kernel.mode.as_str(), self.interface_name);
            drop(kernel);
        }
    }

    pub fn attach_mode(&self) -> XdpAttachMode {
        self.kernel.as_ref().map(|kernel| kernel.mode).unwrap_or(if self.enabled { XdpAttachMode::Memory } else { XdpAttachMode::Disabled })
    }

    pub fn inspect_and_filter(&self, ip: IpAddr) -> bool {
        if self.kernel.is_some() || !self.enabled { return true; }
        if self.blacklist.contains(&ip) {
            crate::metrics::l4_drop();
            return false;
        }
        let now = Instant::now();
        let mut allowed = true;
        let mut entry = self.rate_limits.entry(ip).or_insert((now, 0));
        let (last_reset, count) = entry.value_mut();
        if now.duration_since(*last_reset) > Duration::from_secs(1) {
            *last_reset = now; *count = 1;
        } else {
            *count = count.saturating_add(1);
            if *count > self.max_pps { allowed = false; }
        }
        drop(entry);
        if !allowed {
            self.blacklist.insert(ip);
            crate::metrics::l4_drop();
            crate::metrics::set_blocked_ips(self.blacklist.len() as u64);
        }
        allowed
    }

    pub fn block_ip(&mut self, ip: IpAddr) {
        let inserted = self.blacklist.insert(ip);
        if let Some(kernel) = self.kernel.as_mut() {
            if let Err(error) = Self::insert_kernel_blacklist(&mut kernel.ebpf, ip) {
                tracing::error!("No se pudo sincronizar {} con XDP: {}", ip, error);
            }
        }
        if !inserted { return; }
        crate::metrics::set_blocked_ips(self.blacklist.len() as u64);
        if let Some(parent) = self.runtime_blacklist_path.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                tracing::error!("No se pudo crear el directorio de blacklist: {}", error); return;
            }
        }
        match std::fs::OpenOptions::new().create(true).append(true).open(&self.runtime_blacklist_path) {
            Ok(mut file) => if let Err(error) = writeln!(file, "{}", ip) {
                tracing::error!("No se pudo persistir {}: {}", ip, error);
            },
            Err(error) => tracing::error!("No se pudo abrir blacklist: {}", error),
        }
    }

    pub fn kernel_stats(&self) -> Result<XdpStats, String> {
        let Some(kernel) = self.kernel.as_ref() else { return Ok(XdpStats::default()); };
        let map = kernel.ebpf.map("STATS").ok_or_else(|| "mapa STATS ausente".to_string())?;
        let stats = PerCpuArray::<_, XdpStats>::try_from(map)
            .map_err(|error| format!("STATS inválido: {error}"))?
            .get(&0, 0).map_err(|error| format!("no se pudo leer STATS: {error}"))?;
        Ok(stats.iter().fold(XdpStats::default(), |mut total, cpu| {
            total.packets_seen = total.packets_seen.saturating_add(cpu.packets_seen);
            total.packets_passed = total.packets_passed.saturating_add(cpu.packets_passed);
            total.packets_dropped = total.packets_dropped.saturating_add(cpu.packets_dropped);
            total.blacklist_drops = total.blacklist_drops.saturating_add(cpu.blacklist_drops);
            total.rate_limit_drops = total.rate_limit_drops.saturating_add(cpu.rate_limit_drops);
            total.parse_errors = total.parse_errors.saturating_add(cpu.parse_errors);
            total
        }))
    }

    pub fn reload_from_config(&mut self, config_path: &str) {
        let modified = std::fs::metadata(config_path).and_then(|metadata| metadata.modified()).ok();
        if self.config_loaded && modified == self.config_modified {
            return;
        }
        let config = match ProxyConfig::load(config_path) {
            Ok(config) => config,
            Err(error) => { tracing::error!("Se conserva la política XDP: {}", error); return; }
        };
        self.config_loaded = true;
        self.config_modified = modified;
        let previous_enabled = self.enabled;
        let previous_max_pps = self.max_pps;
        let mut new_ips = Vec::new();
        if let Some(tuning) = config.advanced_tuning {
            if let Some(sec) = tuning.security {
                self.rate_limit_conns = sec.rate_limit_conns_per_ip;
                if let Some(ips) = sec.blacklisted_ips {
                    for value in ips {
                        if let Ok(ip) = value.parse::<IpAddr>() {
                            if self.blacklist.insert(ip) { new_ips.push(ip); }
                        }
                    }
                }
            }
            if let Some(xdp) = tuning.ebpf_xdp {
                self.enabled = xdp.enabled;
                self.max_pps = xdp.max_packet_rate_per_ip;
                self.ddos_mode = xdp.ddos_mitigation_mode;
            }
        }
        if let Some(kernel) = self.kernel.as_mut() {
            if previous_enabled != self.enabled || previous_max_pps != self.max_pps {
                let policy = Self::policy(self.enabled, self.max_pps);
                if let Err(error) = Self::write_kernel_policy(&mut kernel.ebpf, policy) {
                    tracing::error!("No se pudo actualizar POLICY: {}", error);
                }
            }
            for ip in new_ips { let _ = Self::insert_kernel_blacklist(&mut kernel.ebpf, ip); }
        }
    }

    fn policy(enabled: bool, max_pps: u32) -> PolicyConfig {
        PolicyConfig { window_ns: 1_000_000_000, max_pps: max_pps.max(1), enabled: u32::from(enabled), _reserved: [0; 2] }
    }

    fn configure_kernel_policy(&self, ebpf: &mut Ebpf) -> Result<(), String> {
        Self::write_kernel_policy(ebpf, Self::policy(self.enabled, self.max_pps))
    }

    fn write_kernel_policy(ebpf: &mut Ebpf, policy: PolicyConfig) -> Result<(), String> {
        let map = ebpf.map_mut("POLICY").ok_or_else(|| "mapa POLICY ausente".to_string())?;
        Array::<_, PolicyConfig>::try_from(map).map_err(|e| format!("POLICY inválido: {e}"))?
            .set(0, policy, 0).map_err(|e| format!("no se pudo escribir POLICY: {e}"))
    }

    fn sync_kernel_blacklist(&self, ebpf: &mut Ebpf) -> Result<(), String> {
        for ip in self.blacklist.iter().map(|entry| *entry.key()) { Self::insert_kernel_blacklist(ebpf, ip)?; }
        Ok(())
    }

    fn insert_kernel_blacklist(ebpf: &mut Ebpf, ip: IpAddr) -> Result<(), String> {
        match ip {
            IpAddr::V4(ip) => {
                let map = ebpf.map_mut("BLACKLIST_V4").ok_or_else(|| "BLACKLIST_V4 ausente".to_string())?;
                BpfHashMap::<_, u32, u8>::try_from(map).map_err(|e| format!("BLACKLIST_V4 inválido: {e}"))?
                    .insert(u32::from(ip), 1, 0).map_err(|e| format!("no se pudo insertar IPv4: {e}"))
            }
            IpAddr::V6(ip) => {
                let map = ebpf.map_mut("BLACKLIST_V6").ok_or_else(|| "BLACKLIST_V6 ausente".to_string())?;
                BpfHashMap::<_, [u8; 16], u8>::try_from(map).map_err(|e| format!("BLACKLIST_V6 inválido: {e}"))?
                    .insert(ip.octets(), 1, 0).map_err(|e| format!("no se pudo insertar IPv6: {e}"))
            }
        }
    }

    fn load_runtime_blacklist(&self) {
        let Ok(content) = std::fs::read_to_string(&self.runtime_blacklist_path) else { return; };
        for line in content.lines().map(str::trim).filter(|line| !line.is_empty()) {
            if let Ok(ip) = line.parse::<IpAddr>() { self.blacklist.insert(ip); }
        }
        crate::metrics::set_blocked_ips(self.blacklist.len() as u64);
    }
}
