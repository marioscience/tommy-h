import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ignoredDirectories = new Set([
  '.git', '.worktrees', '.npm-cache', '.cargo', 'node_modules', 'target', 'dist', 'build', 'coverage'
]);

async function filesystemCandidates(directory = '.', prefix = '') {
  const result = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        result.push(...await filesystemCandidates(absolute, relative));
      }
    } else if (entry.isFile()) {
      result.push(relative);
    }
  }
  return result;
}

let candidates;
try {
  candidates = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).split(/\r?\n/).filter(Boolean);
} catch {
  candidates = await filesystemCandidates();
  console.warn('Git metadata is unavailable; scanning the source tree directly.');
}

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
const assignment = /\b(?:PAYPAL_SECRET|DISCORD_TOKEN|DISCORD_API_KEY|NODE_ENROLLMENT_API_KEY|JWT_SECRET|SESSION_SECRET|DATABASE_PASSWORD|POSTGRES_PASSWORD|MYSQL_ROOT_PASSWORD|OXIDE_ADMIN_PASSWORD)[ \t]*[:=][ \t]*['"]?([^\s,'"}\]]{12,})/gi;
const placeholder = /\$\{|process\.env|(?:std::)?env::var|required_env|change|example|replace|generate|placeholder|dummy|development|local[-_]?only/i;

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
