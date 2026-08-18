import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const roots = ['frontend/public', 'oxideproxy/node_panel/public'];
const extensions = new Set(['.html', '.js', '.mjs']);
const excludedNames = new Set(['panel_backup.html']);
const executableAttribute = /(?:^|\s)on[a-z]+\s*=/gi;
const dynamicCode = /\beval\s*\(|new\s+Function\s*\(|set(?:Timeout|Interval)\s*\(\s*['"]|javascript:/gi;

async function filesUnder(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'vendor') result.push(...await filesUnder(fullPath));
    else if (extensions.has(path.extname(entry.name)) && !excludedNames.has(entry.name)) result.push(fullPath);
  }
  return result;
}

const files = (await Promise.all(roots.map(filesUnder))).flat();
for (const file of files) {
  const source = await fs.readFile(file, 'utf8');
  assert.equal(
    executableAttribute.test(source),
    false,
    `${file} contains an executable HTML event attribute`
  );
  executableAttribute.lastIndex = 0;
  assert.equal(dynamicCode.test(source), false, `${file} contains dynamic code execution`);
  dynamicCode.lastIndex = 0;
}

console.log(`Inline-code contract passed for ${files.length} frontend files.`);
