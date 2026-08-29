use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TCP_ACTIVE: AtomicU64 = AtomicU64::new(0);
static TCP_EVENTS_IN: AtomicU64 = AtomicU64::new(0);
static TCP_READS_IN: AtomicU64 = AtomicU64::new(0);
static TCP_READS_OUT: AtomicU64 = AtomicU64::new(0);
static TCP_BYTES_IN: AtomicU64 = AtomicU64::new(0);
static TCP_BYTES_OUT: AtomicU64 = AtomicU64::new(0);
static UDP_PACKETS_IN: AtomicU64 = AtomicU64::new(0);
static UDP_PACKETS_OUT: AtomicU64 = AtomicU64::new(0);
static UDP_BYTES_IN: AtomicU64 = AtomicU64::new(0);
static UDP_BYTES_OUT: AtomicU64 = AtomicU64::new(0);
static L4_DROPPED: AtomicU64 = AtomicU64::new(0);
static L4_BLOCKED_IPS: AtomicU64 = AtomicU64::new(0);
static XDP_MODE: AtomicU64 = AtomicU64::new(0);
static XDP_PACKETS_SEEN: AtomicU64 = AtomicU64::new(0);
static XDP_PARSE_ERRORS: AtomicU64 = AtomicU64::new(0);
static XDP_BLACKLIST_DROPS: AtomicU64 = AtomicU64::new(0);
static XDP_RATE_LIMIT_DROPS: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
struct Snapshot {
    timestamp_ms: u128,
    tcp_active: u64,
    tcp_events_in: u64,
    tcp_reads_in: u64,
    tcp_reads_out: u64,
    tcp_bytes_in: u64,
    tcp_bytes_out: u64,
    udp_packets_in: u64,
    udp_packets_out: u64,
    udp_bytes_in: u64,
    udp_bytes_out: u64,
    l4_dropped: u64,
    l4_blocked_ips: u64,
    xdp_mode: &'static str,
    xdp_packets_seen: u64,
    xdp_parse_errors: u64,
    xdp_blacklist_drops: u64,
    xdp_rate_limit_drops: u64,
}

pub fn tcp_open(initial_bytes: usize) {
    TCP_ACTIVE.fetch_add(1, Ordering::Relaxed);
    TCP_EVENTS_IN.fetch_add(1, Ordering::Relaxed);
    TCP_BYTES_IN.fetch_add(initial_bytes as u64, Ordering::Relaxed);
}

pub fn tcp_close() {
    let _ = TCP_ACTIVE.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| value.checked_sub(1));
}

pub fn tcp_ingress(bytes: usize) {
    TCP_READS_IN.fetch_add(1, Ordering::Relaxed);
    TCP_BYTES_IN.fetch_add(bytes as u64, Ordering::Relaxed);
}

pub fn tcp_egress(bytes: usize) {
    TCP_READS_OUT.fetch_add(1, Ordering::Relaxed);
    TCP_BYTES_OUT.fetch_add(bytes as u64, Ordering::Relaxed);
}

pub fn udp_ingress(bytes: usize) {
    UDP_PACKETS_IN.fetch_add(1, Ordering::Relaxed);
    UDP_BYTES_IN.fetch_add(bytes as u64, Ordering::Relaxed);
}

pub fn udp_egress(bytes: usize) {
    UDP_PACKETS_OUT.fetch_add(1, Ordering::Relaxed);
    UDP_BYTES_OUT.fetch_add(bytes as u64, Ordering::Relaxed);
}

pub fn l4_drop() {
    L4_DROPPED.fetch_add(1, Ordering::Relaxed);
}

pub fn set_blocked_ips(value: u64) {
    L4_BLOCKED_IPS.store(value, Ordering::Relaxed);
}

pub fn set_xdp_mode(mode: crate::ebpf_xdp::XdpAttachMode) {
    let value = match mode {
        crate::ebpf_xdp::XdpAttachMode::Disabled => 0,
        crate::ebpf_xdp::XdpAttachMode::Memory => 1,
        crate::ebpf_xdp::XdpAttachMode::Generic => 2,
        crate::ebpf_xdp::XdpAttachMode::Driver => 3,
    };
    XDP_MODE.store(value, Ordering::Relaxed);
}

pub fn update_xdp_stats(stats: crate::ebpf_xdp::XdpStats) {
    XDP_PACKETS_SEEN.store(stats.packets_seen, Ordering::Relaxed);
    XDP_PARSE_ERRORS.store(stats.parse_errors, Ordering::Relaxed);
    XDP_BLACKLIST_DROPS.store(stats.blacklist_drops, Ordering::Relaxed);
    XDP_RATE_LIMIT_DROPS.store(stats.rate_limit_drops, Ordering::Relaxed);
    L4_DROPPED.store(stats.packets_dropped, Ordering::Relaxed);
}

fn xdp_mode_name() -> &'static str {
    match XDP_MODE.load(Ordering::Relaxed) {
        3 => "xdp-driver",
        2 => "xdp-generic",
        1 => "memory",
        _ => "disabled",
    }
}

pub async fn write_snapshots(path: String) {
    loop {
        let snapshot = Snapshot {
            timestamp_ms: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
            tcp_active: TCP_ACTIVE.load(Ordering::Relaxed),
            tcp_events_in: TCP_EVENTS_IN.load(Ordering::Relaxed),
            tcp_reads_in: TCP_READS_IN.load(Ordering::Relaxed),
            tcp_reads_out: TCP_READS_OUT.load(Ordering::Relaxed),
            tcp_bytes_in: TCP_BYTES_IN.load(Ordering::Relaxed),
            tcp_bytes_out: TCP_BYTES_OUT.load(Ordering::Relaxed),
            udp_packets_in: UDP_PACKETS_IN.load(Ordering::Relaxed),
            udp_packets_out: UDP_PACKETS_OUT.load(Ordering::Relaxed),
            udp_bytes_in: UDP_BYTES_IN.load(Ordering::Relaxed),
            udp_bytes_out: UDP_BYTES_OUT.load(Ordering::Relaxed),
            l4_dropped: L4_DROPPED.load(Ordering::Relaxed),
            l4_blocked_ips: L4_BLOCKED_IPS.load(Ordering::Relaxed),
            xdp_mode: xdp_mode_name(),
            xdp_packets_seen: XDP_PACKETS_SEEN.load(Ordering::Relaxed),
            xdp_parse_errors: XDP_PARSE_ERRORS.load(Ordering::Relaxed),
            xdp_blacklist_drops: XDP_BLACKLIST_DROPS.load(Ordering::Relaxed),
            xdp_rate_limit_drops: XDP_RATE_LIMIT_DROPS.load(Ordering::Relaxed),
        };
        if let Ok(encoded) = serde_json::to_vec(&snapshot) {
            let temporary = format!("{}.tmp", path);
            if let Some(parent) = Path::new(&path).parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            if tokio::fs::write(&temporary, encoded).await.is_ok() {
                let _ = tokio::fs::rename(&temporary, &path).await;
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}
