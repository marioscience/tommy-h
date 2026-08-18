import fs from 'fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const files = [
  'frontend/public/admin.html',
  'frontend/public/js/panel.js',
  'frontend/public/games/ark.html',
  'frontend/public/games/cs2.html',
  'frontend/public/games/database.html',
  'frontend/public/games/discordbot.html',
  'frontend/public/games/fivem.html',
  'frontend/public/games/fivem_v3.html',
  'frontend/public/games/minecraft.html',
  'frontend/public/games/palworld.html',
  'frontend/public/games/rust.html',
  'frontend/public/games/sdtd.html',
  'frontend/public/games/valheim.html',
  'frontend/public/games/wordpress.html',
  'frontend/public/games/zomboid.html'
];

function skipQuoted(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  throw new Error('Unterminated quoted expression');
}

function skipRegex(source, start) {
  let index = start + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === '[') inCharacterClass = true;
    if (source[index] === ']') inCharacterClass = false;
    if (source[index] === '/' && !inCharacterClass) {
      index += 1;
      while (/[a-z]/i.test(source[index] || '')) index += 1;
      return index;
    }
    index += 1;
  }
  throw new Error('Unterminated regular expression');
}

function readInterpolation(source, start) {
  let depth = 1;
  let index = start + 2;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(source, index);
      continue;
    }
    if (char === '/' && source[index + 1] !== '/' && source[index + 1] !== '*') {
      index = skipRegex(source, index);
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return { expression: source.slice(start + 2, index), end: index + 1 };
    }
    index += 1;
  }
  throw new Error('Unterminated template interpolation');
}

function compileHandler(raw) {
  let compiled = '';
  let index = 0;
  while (index < raw.length) {
    if (raw[index] === "'") {
      const start = index;
      index += 1;
      let hasInterpolation = false;
      let content = '';
      while (index < raw.length) {
        if (raw[index] === '\\') {
          content += raw.slice(index, index + 2);
          index += 2;
          continue;
        }
        if (raw.startsWith('${', index)) {
          const part = readInterpolation(raw, index);
          hasInterpolation = true;
          content += raw.slice(index, part.end);
          index = part.end;
          continue;
        }
        if (raw[index] === "'") break;
        content += raw[index++];
      }
      if (raw[index] !== "'") throw new Error(`Unterminated handler string: ${raw.slice(start)}`);
      index += 1;
      let exactExpression = null;
      if (hasInterpolation && content.startsWith('${')) {
        const exact = readInterpolation(content, 0);
        if (exact.end === content.length) exactExpression = exact.expression;
      }
      if (exactExpression !== null) compiled += `(${exactExpression})`;
      else if (hasInterpolation) compiled += `\`${content.replaceAll('`', '\\`')}\``;
      else compiled += `'${content}'`;
      continue;
    }
    if (raw.startsWith('${', index)) {
      const part = readInterpolation(raw, index);
      compiled += `(${part.expression})`;
      index = part.end;
      continue;
    }
    compiled += raw[index++];
  }
  return compiled.replace(/\bthis\b/g, 'element');
}

function transform(source, file) {
  const edits = [];
  const pattern = /\son([a-z]+)\s*=\s*"/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const valueStart = pattern.lastIndex;
    let index = valueStart;
    let interpolationDepth = 0;
    while (index < source.length) {
      if (source.startsWith('${', index)) {
        const part = readInterpolation(source, index);
        index = part.end;
        continue;
      }
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === '"' && interpolationDepth === 0) break;
      index += 1;
    }
    if (source[index] !== '"') throw new Error(`Unterminated on${match[1]} in ${file}`);
    const raw = source.slice(valueStart, index);
    const body = compileHandler(raw);
    edits.push({
      start: match.index,
      end: index + 1,
      replacement: ` \${rnBind(${JSON.stringify(match[1].toLowerCase())}, (event, element) => { ${body} })}`
    });
    pattern.lastIndex = index + 1;
  }

  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
  }
  return { source, count: edits.length };
}

function allElements(root) {
  const elements = [...root.querySelectorAll('*')];
  for (const element of [...elements]) {
    if (element.tagName === 'TEMPLATE') elements.push(...allElements(element.content));
  }
  return elements;
}

function validateTransformedSource(file, source) {
  if (/(?:^|\s)on[a-z]+\s*=/i.test(source)) {
    throw new Error(`${file} still contains an executable event attribute`);
  }
  if (file.endsWith('.js')) {
    new vm.Script(source, { filename: file });
    return;
  }
  const document = new JSDOM(source).window.document;
  for (const script of allElements(document).filter((element) => element.tagName === 'SCRIPT')) {
    if (script.src || (script.type && script.type !== 'text/javascript')) continue;
    new vm.Script(script.textContent, { filename: file });
  }
}

let total = 0;
const pendingWrites = [];
for (const file of files) {
  const original = await fs.readFile(file, 'utf8');
  const result = transform(original, file);
  validateTransformedSource(file, result.source);
  if (result.count) pendingWrites.push({ file, source: result.source });
  total += result.count;
  console.log(`${file}: migrated ${result.count} dynamic template handlers`);
}

for (const pending of pendingWrites) await fs.writeFile(pending.file, pending.source);

console.log(`Migrated ${total} dynamic template handlers without eval.`);
