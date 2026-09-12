import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = path.join(backendRoot, 'src');
const maximumLines = 500;

async function findJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findJavaScriptFiles(target);
    return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
  }));
  return nested.flat();
}

const files = await findJavaScriptFiles(sourceRoot);
const modules = await Promise.all(files.map(async (file) => ({
  file: path.relative(backendRoot, file).replaceAll('\\', '/'),
  lines: (await readFile(file, 'utf8')).split(/\r?\n/).length
})));
const oversized = modules.filter(({ lines }) => lines > maximumLines);

if (oversized.length > 0) {
  console.error(`Los módulos del backend no deben superar ${maximumLines} líneas:`);
  for (const { file, lines } of oversized.sort((a, b) => b.lines - a.lines)) {
    console.error(`- ${file}: ${lines}`);
  }
  console.error('Divide por responsabilidad; no reduzcas líneas sacrificando claridad.');
  process.exitCode = 1;
} else {
  const largest = modules.sort((a, b) => b.lines - a.lines)[0];
  console.log(`Estructura válida: ${modules.length} módulos; mayor ${largest.file} (${largest.lines}/${maximumLines}).`);
}
