import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('backend/src/services/serverControlService.js', 'utf8');
const restartStart = service.indexOf("if (action === 'restart')");
const restartEnd = service.indexOf('await logAudit', restartStart);
assert.ok(restartStart >= 0 && restartEnd > restartStart, 'restart control block must exist');

const restartBlock = service.slice(restartStart, restartEnd);
assert.ok(!restartBlock.includes('} finally {'), 'a failed restart must not be marked running in finally');
assert.match(restartBlock, /catch \(error\)[\s\S]*?status = 'error'[\s\S]*?throw error;/, 'restart failures must persist error state and propagate');
assert.match(restartBlock, /status = 'running'/, 'successful restarts must persist running state');
assert.equal((service.match(/case 'discordbot': await Docker\.restartDiscordBotContainer/g) || []).length, 3, 'every restart path must support the canonical discordbot template');
assert.ok(!service.includes('default: await Docker.restartFivemContainer'), 'unknown templates must not silently restart as FiveM');
assert.ok(!service.includes('Omitiendo reparación específica'), 'maintenance must not mark unknown templates as repaired');

console.log('Server state contract passed.');
