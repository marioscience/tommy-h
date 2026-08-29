import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const container = process.env.XDP_TEST_CONTAINER || 'oxide-xdp-matrix';
const host = process.env.XDP_TEST_HOST || '127.0.0.1';
const udpPort = Number(process.env.XDP_TEST_UDP_PORT || 18080);
const tcpPort = Number(process.env.XDP_TEST_TCP_PORT || 18443);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function metrics() {
  const destination = path.join(os.tmpdir(), `oxide-xdp-${process.pid}.json`);
  execFileSync('docker', ['cp', `${container}:/tmp/metrics.json`, destination], { stdio: 'ignore' });
  const value = JSON.parse(fs.readFileSync(destination, 'utf8'));
  fs.rmSync(destination, { force: true });
  return value;
}

function delta(before, after) {
  return Object.fromEntries(Object.keys(after).map((key) => [
    key,
    typeof after[key] === 'number' && typeof before[key] === 'number'
      ? after[key] - before[key]
      : after[key],
  ]));
}

async function sendUdp(payloads, delayMs = 0) {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    let index = 0;
    const sendNext = () => {
      if (index >= payloads.length) return resolve();
      socket.send(payloads[index++], udpPort, host, (error) => {
        if (error) return reject(error);
        if (delayMs) setTimeout(sendNext, delayMs);
        else setImmediate(sendNext);
      });
    };
    sendNext();
  });
  socket.close();
}

async function sendTcp(count) {
  await Promise.allSettled(Array.from({ length: count }, (_, index) => new Promise((resolve) => {
    const socket = net.createConnection({ host, port: tcpPort });
    socket.setTimeout(750);
    socket.once('connect', () => socket.end(Buffer.from(`tcp-${index}`)));
    socket.once('timeout', () => socket.destroy());
    socket.once('error', resolve);
    socket.once('close', resolve);
  })));
}

async function snapshotAfter(action) {
  await sleep(1_200);
  const before = metrics();
  await action();
  await sleep(1_600);
  return delta(before, metrics());
}

const payloadSizes = [1, 16, 64, 256, 512, 1_200, 1_400];
const mixedPayloads = (count) => Array.from({ length: count }, (_, index) => {
  const size = payloadSizes[index % payloadSizes.length];
  const payload = Buffer.alloc(size);
  if (index % 3 === 0) payload.fill(index & 0xff);
  else if (index % 3 === 1) payload.write(`oxide-text-${index}`);
  else for (let i = 0; i < size; i += 1) payload[i] = (i * 31 + index) & 0xff;
  return payload;
});

const belowLimit = await snapshotAfter(() => sendUdp(mixedPayloads(80)));
assert.equal(belowLimit.udp_packets_in, 80, 'traffic below the PPS limit must reach Tokio');
assert.equal(belowLimit.l4_dropped, 0, 'traffic below the PPS limit must not be dropped');

const burst = await snapshotAfter(() => sendUdp(mixedPayloads(500)));
assert.ok(burst.l4_dropped >= 250, `varied-size burst did not produce enough kernel drops: ${burst.l4_dropped}`);
assert.ok(
  burst.udp_packets_in + burst.l4_dropped >= 495,
  `burst accounting lost packets: pass=${burst.udp_packets_in}, drop=${burst.l4_dropped}`,
);

const paced = await snapshotAfter(async () => {
  for (let window = 0; window < 3; window += 1) {
    await sendUdp(mixedPayloads(40));
    if (window < 2) await sleep(1_100);
  }
});
assert.equal(paced.udp_packets_in, 120, 'rate window must recover for paced traffic');
assert.equal(paced.l4_dropped, 0, 'paced traffic below each window must not be dropped');

const mixedProtocols = await snapshotAfter(async () => {
  await Promise.all([sendUdp(mixedPayloads(80)), sendTcp(80)]);
});
assert.ok(mixedProtocols.xdp_packets_seen >= 150, `mixed TCP/UDP traffic was not observed by XDP: ${mixedProtocols.xdp_packets_seen}`);
assert.ok(mixedProtocols.l4_dropped > 0, 'the shared per-source limiter did not cover mixed TCP/UDP traffic');

console.log(JSON.stringify({ belowLimit, burst, paced, mixedProtocols }, null, 2));
console.log('XDP traffic matrix passed.');
