#![no_std]
#![no_main]

use aya_ebpf::{
    bindings::xdp_action,
    helpers::bpf_ktime_get_ns,
    macros::{map, xdp},
    maps::{Array, HashMap, LruHashMap, PerCpuArray},
    programs::XdpContext,
};
use core::mem;

const ETH_P_8021Q: u16 = 0x8100;
const ETH_P_8021AD: u16 = 0x88a8;
const ETH_P_IPV4: u16 = 0x0800;
const ETH_P_IPV6: u16 = 0x86dd;
const STATS_INDEX: u32 = 0;
const POLICY_INDEX: u32 = 0;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct PolicyConfig {
    pub window_ns: u64,
    pub max_pps: u32,
    pub enabled: u32,
    pub _reserved: [u32; 2],
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct RateWindow {
    pub started_ns: u64,
    pub packets: u32,
    pub _reserved: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct XdpStats {
    pub packets_seen: u64,
    pub packets_passed: u64,
    pub packets_dropped: u64,
    pub blacklist_drops: u64,
    pub rate_limit_drops: u64,
    pub parse_errors: u64,
}

#[map]
static BLACKLIST_V4: HashMap<u32, u8> = HashMap::with_max_entries(65_536, 0);

#[map]
static BLACKLIST_V6: HashMap<[u8; 16], u8> = HashMap::with_max_entries(65_536, 0);

// RX flows are normally stable on one queue/CPU. A per-CPU LRU map avoids
// cross-CPU races and bounds memory under source-address spray attacks.
#[map]
static RATE_V4: LruHashMap<u32, RateWindow> = LruHashMap::with_max_entries(131_072, 0);

#[map]
static RATE_V6: LruHashMap<[u8; 16], RateWindow> = LruHashMap::with_max_entries(131_072, 0);

#[map]
static POLICY: Array<PolicyConfig> = Array::with_max_entries(1, 0);

#[map]
static STATS: PerCpuArray<XdpStats> = PerCpuArray::with_max_entries(1, 0);

#[xdp]
pub fn oxide_xdp(ctx: XdpContext) -> u32 {
    match try_oxide_xdp(&ctx) {
        Ok(action) => action,
        Err(()) => {
            update_stats(|stats| stats.parse_errors = stats.parse_errors.saturating_add(1));
            xdp_action::XDP_PASS
        }
    }
}

fn try_oxide_xdp(ctx: &XdpContext) -> Result<u32, ()> {
    update_stats(|stats| stats.packets_seen = stats.packets_seen.saturating_add(1));
    let policy = POLICY.get(POLICY_INDEX);
    let Some(policy) = policy else {
        return pass();
    };
    if policy.enabled == 0 {
        return pass();
    }

    let (ether_type, network_offset) = ethernet_protocol(ctx)?;
    match ether_type {
        ETH_P_IPV4 => inspect_ipv4(ctx, network_offset, policy),
        ETH_P_IPV6 => inspect_ipv6(ctx, network_offset, policy),
        _ => pass(),
    }
}

fn ethernet_protocol(ctx: &XdpContext) -> Result<(u16, usize), ()> {
    let mut offset = 14usize;
    let mut ether_type = read_be_u16(ctx, 12)?;
    // Support single and stacked VLAN tags, with a strict verifier-friendly bound.
    let mut tags = 0;
    while (ether_type == ETH_P_8021Q || ether_type == ETH_P_8021AD) && tags < 2 {
        ether_type = read_be_u16(ctx, offset + 2)?;
        offset += 4;
        tags += 1;
    }
    Ok((ether_type, offset))
}

fn inspect_ipv4(ctx: &XdpContext, offset: usize, policy: &PolicyConfig) -> Result<u32, ()> {
    let version_ihl = read_u8(ctx, offset)?;
    if version_ihl >> 4 != 4 || (version_ihl & 0x0f) < 5 {
        return Err(());
    }
    let source = read_be_u32(ctx, offset + 12)?;
    if unsafe { BLACKLIST_V4.get(&source) }.is_some() {
        return drop_blacklist();
    }
    rate_limit_v4(source, policy)
}

fn inspect_ipv6(ctx: &XdpContext, offset: usize, policy: &PolicyConfig) -> Result<u32, ()> {
    if read_u8(ctx, offset)? >> 4 != 6 {
        return Err(());
    }
    let source = read_array_16(ctx, offset + 8)?;
    if unsafe { BLACKLIST_V6.get(&source) }.is_some() {
        return drop_blacklist();
    }
    rate_limit_v6(source, policy)
}

fn rate_limit_v4(source: u32, policy: &PolicyConfig) -> Result<u32, ()> {
    let now = unsafe { bpf_ktime_get_ns() };
    if let Some(window) = RATE_V4.get_ptr_mut(&source) {
        let window = unsafe { &mut *window };
        if now.saturating_sub(window.started_ns) >= policy.window_ns {
            window.started_ns = now;
            window.packets = 1;
            return pass();
        }
        window.packets = window.packets.saturating_add(1);
        if window.packets > policy.max_pps {
            return drop_rate_limited();
        }
        return pass();
    }
    RATE_V4.insert(&source, &RateWindow { started_ns: now, packets: 1, _reserved: 0 }, 0)
        .map_err(|_| ())?;
    pass()
}

fn rate_limit_v6(source: [u8; 16], policy: &PolicyConfig) -> Result<u32, ()> {
    let now = unsafe { bpf_ktime_get_ns() };
    if let Some(window) = RATE_V6.get_ptr_mut(&source) {
        let window = unsafe { &mut *window };
        if now.saturating_sub(window.started_ns) >= policy.window_ns {
            window.started_ns = now;
            window.packets = 1;
            return pass();
        }
        window.packets = window.packets.saturating_add(1);
        if window.packets > policy.max_pps {
            return drop_rate_limited();
        }
        return pass();
    }
    RATE_V6.insert(&source, &RateWindow { started_ns: now, packets: 1, _reserved: 0 }, 0)
        .map_err(|_| ())?;
    pass()
}

fn pass() -> Result<u32, ()> {
    update_stats(|stats| stats.packets_passed = stats.packets_passed.saturating_add(1));
    Ok(xdp_action::XDP_PASS)
}

fn drop_blacklist() -> Result<u32, ()> {
    update_stats(|stats| {
        stats.packets_dropped = stats.packets_dropped.saturating_add(1);
        stats.blacklist_drops = stats.blacklist_drops.saturating_add(1);
    });
    Ok(xdp_action::XDP_DROP)
}

fn drop_rate_limited() -> Result<u32, ()> {
    update_stats(|stats| {
        stats.packets_dropped = stats.packets_dropped.saturating_add(1);
        stats.rate_limit_drops = stats.rate_limit_drops.saturating_add(1);
    });
    Ok(xdp_action::XDP_DROP)
}

fn update_stats(update: impl FnOnce(&mut XdpStats)) {
    if let Some(stats) = STATS.get_ptr_mut(STATS_INDEX) {
        update(unsafe { &mut *stats });
    }
}

fn read_u8(ctx: &XdpContext, offset: usize) -> Result<u8, ()> {
    Ok(unsafe { *ptr_at::<u8>(ctx, offset)? })
}

fn read_be_u16(ctx: &XdpContext, offset: usize) -> Result<u16, ()> {
    let bytes = [read_u8(ctx, offset)?, read_u8(ctx, offset + 1)?];
    Ok(u16::from_be_bytes(bytes))
}

fn read_be_u32(ctx: &XdpContext, offset: usize) -> Result<u32, ()> {
    let bytes = [
        read_u8(ctx, offset)?, read_u8(ctx, offset + 1)?,
        read_u8(ctx, offset + 2)?, read_u8(ctx, offset + 3)?,
    ];
    Ok(u32::from_be_bytes(bytes))
}

fn read_array_16(ctx: &XdpContext, offset: usize) -> Result<[u8; 16], ()> {
    let mut output = [0u8; 16];
    let mut index = 0;
    while index < 16 {
        output[index] = read_u8(ctx, offset + index)?;
        index += 1;
    }
    Ok(output)
}

unsafe fn ptr_at<T>(ctx: &XdpContext, offset: usize) -> Result<*const T, ()> {
    let start = ctx.data();
    let end = ctx.data_end();
    let len = mem::size_of::<T>();
    if start + offset + len > end {
        return Err(());
    }
    Ok((start + offset) as *const T)
}

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}
