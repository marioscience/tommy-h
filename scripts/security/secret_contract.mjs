import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const candidates = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' }
).split(/\r?\n/).filter(Boolean);

const forbiddenPaths = [
  /^\.env$/i,
  /(^|\/)certs?\//i,
  /(^|\/)security-reports\//i,
  /(^|\/).*_backup\.html$/i,
  /\.(?:pem|key|p12|pfx|sqlite3?|db)$/i
];
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk_live_[A-Za-z0-9]{20,}\b/
];
const assignment = /\b(?:PAYPAL_SECRET|DISCORD_TOKEN|JWT_SECRET|SESSION_SECRET|DATABASE_PASSWORD|POSTGRES_PASSWORD|MYSQL_ROOT_PASSWORD|OXIDE_ADMIN_PASSWORD)[ \t]*[:=][ \t]*['"]?([^\s,'"}\]]{12,})/gi;
const placeholder = /\$\{|process\.env|change|example|replace|generate|placeholder|dummy|development|local[-_]?only/i;

for (const file of candidates) {
  const normalized = file.replaceAll('\\', '/');
  assert.equal(
    forbiddenPaths.some((pattern) => pattern.test(normalized)),
    false,
    `${normalized} is sensitive or local-only and must remain ignored`
  );

  let stats;
  try {
    stats = await fs.stat(file);
  } catch {
    continue;
  }
  if (!stats.isFile() || stats.size > 2_000_000) continue;
  const bytes = await fs.readFile(file);
  if (bytes.includes(0)) continue;
  const source = bytes.toString('utf8');
  for (const pattern of secretPatterns) {
    assert.equal(pattern.test(source), false, `${normalized} contains a high-confidence secret pattern`);
  }
  assignment.lastIndex = 0;
  let match;
  while ((match = assignment.exec(source))) {
    assert.match(match[1], placeholder, `${normalized} appears to contain a real secret assignment`);
  }
}

console.log(`Secret contract passed for ${candidates.length} Git candidate files.`);
