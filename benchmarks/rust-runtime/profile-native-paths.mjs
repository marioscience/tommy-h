import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { rustUtil } from '../../backend/src/utils/rustUtil.js';
import { encodeSourceRconPacket, SourceRconDecoder } from '../../backend/src/utils/sourceRconProtocol.js';

const telemetrySamples = Math.max(1, Number(process.env.NATIVE_PROFILE_STATS || 100_000));
const hashSizeMiB = Math.max(1, Number(process.env.NATIVE_PROFILE_HASH_MIB || 512));

function usageDelta(before) {
    const after = process.resourceUsage();
    return (after.userCPUTime + after.systemCPUTime - before.userCPUTime - before.systemCPUTime) / 1000;
}

async function measure(run) {
    const usage = process.resourceUsage();
    const start = performance.now();
    await run();
    return { wallMs: performance.now() - start, cpuMs: usageDelta(usage) };
}

function dockerSample(index) {
    return {
        cpu_stats: { cpu_usage: { total_usage: 200_000 + index }, system_cpu_usage: 1_000_000 + index * 2, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 100_000 }, system_cpu_usage: 500_000 },
        memory_stats: { usage: 1024 * 1024 * 512, limit: 1024 * 1024 * 1024, stats: { inactive_file: 1024 } },
        networks: { eth0: { rx_bytes: 1000, tx_bytes: 2000 } }
    };
}

async function nodeHash(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const input = fs.createReadStream(file);
        input.on('data', chunk => hash.update(chunk));
        input.on('error', reject);
        input.on('end', () => resolve(hash.digest('hex')));
    });
}

if (!rustUtil.runtimeInfo().nativeAvailable) throw new Error('Este perfil requiere el módulo Rust nativo.');
const stats = Array.from({ length: telemetrySamples }, (_, index) => dockerSample(index));
const singleTelemetry = await measure(async () => {
    for (const sample of stats) await rustUtil.calculateStats(sample);
});
const batchTelemetry = await measure(() => rustUtil.calculateStatsBatch(stats));

const temporary = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ragenodes-native-profile-'));
const hashFile = path.join(temporary, 'large.bin');
const handle = await fsPromises.open(hashFile, 'w');
const block = Buffer.alloc(1024 * 1024, 0x5a);
for (let index = 0; index < hashSizeMiB; index += 1) await handle.write(block);
await handle.close();
let nodeDigest;
let rustDigest;
const nodeHashTiming = await measure(async () => { nodeDigest = await nodeHash(hashFile); });
const rustHashTiming = await measure(async () => { rustDigest = await rustUtil.sha256File(hashFile); });

const packet = encodeSourceRconPacket(7, 0, 'status response');
const rconPackets = Math.max(1, Number(process.env.NATIVE_PROFILE_RCON_PACKETS || 100_000));
const rconTiming = await measure(() => {
    const decoder = new SourceRconDecoder();
    for (let index = 0; index < rconPackets; index += 1) decoder.push(packet);
});

await fsPromises.rm(temporary, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({
    runtime: rustUtil.runtimeInfo(),
    telemetry: { samples: telemetrySamples, single: singleTelemetry, batch: batchTelemetry },
    hash: { sizeMiB: hashSizeMiB, node: nodeHashTiming, rust: rustHashTiming, equivalent: nodeDigest === rustDigest },
    rcon: { packets: rconPackets, javascript: rconTiming, microsecondsPerPacket: rconTiming.cpuMs * 1000 / rconPackets }
}, null, 2)}\n`);
