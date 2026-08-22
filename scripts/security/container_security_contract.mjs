import fs from 'fs/promises';
import { buildARKHostConfig } from 'file:///app/src/services/games/ark.js';

let failures = 0;

function assert(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else {
    failures += 1;
    console.error(`FAIL ${message}`);
  }
}

const hostConfig = buildARKHostConfig({
  dataPath: '/tmp/ark-security-contract',
  plan: { memoryBytes: 16 * 1024 ** 3, nanoCpus: 5 * 10 ** 9 }
});
const capabilities = new Set((hostConfig.CapAdd || []).map(value => String(value).toUpperCase()));
const forbiddenCapabilities = [
  'SYS_ADMIN', 'SYS_PTRACE', 'NET_ADMIN', 'SYS_MODULE', 'DAC_READ_SEARCH',
  'NET_RAW', 'MKNOD', 'SYS_CHROOT', 'SYS_BOOT', 'SYS_TIME'
];

assert(hostConfig.Privileged !== true, 'ARK is not privileged');
assert(hostConfig.CapDrop?.includes('ALL'), 'ARK drops every capability before adding its allowlist');
assert(
  hostConfig.SecurityOpt?.includes('no-new-privileges:true'),
  'ARK blocks acquisition of new privileges'
);
assert(
  forbiddenCapabilities.every(capability => !capabilities.has(capability)),
  'ARK capability allowlist excludes host-administration capabilities'
);
assert(hostConfig.PidsLimit > 0 && hostConfig.PidsLimit <= 2048, 'ARK has a bounded process limit');
assert(hostConfig.Init === true, 'ARK uses an init process for child-process cleanup');

const minecraftSource = await fs.readFile('/app/src/services/games/minecraft.js', 'utf8');
assert(minecraftSource.includes("'ONLINE_MODE=TRUE'"), 'Minecraft requires authenticated player identities');
assert(!minecraftSource.includes('ONLINE_MODE=FALSE'), 'Minecraft offline identity mode is absent');

if (failures) {
  console.error(`Container security contract failed: ${failures} finding(s).`);
  process.exit(1);
}

console.log('Container security contract passed.');
