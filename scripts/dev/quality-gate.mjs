import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const scope = process.argv[2] || 'all';
const allowed = new Set(['all', 'frontend', 'backend', 'proxy']);
if (!allowed.has(scope)) throw new Error(`Ámbito inválido. Disponibles: ${[...allowed].join(', ')}`);

function run(command, args) {
  console.log(`\n==> ${command} ${args.join(' ')}`);
  const windowsScript = process.platform === 'win32' && command === 'npm';
  const executable = windowsScript ? (process.env.ComSpec || 'cmd.exe') : command;
  const commandArgs = windowsScript ? ['/d', '/s', '/c', ['call npm', ...args].join(' ')] : args;
  const result = spawnSync(executable, commandArgs, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function runRustTests() {
  const localCargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (!localCargo.error && localCargo.status === 0) {
    run('cargo', ['test', '--manifest-path', 'oxideproxy/Cargo.toml', '--locked']);
    return;
  }
  console.log('\nCargo no está instalado; se usará el toolchain Rust reproducible dentro de Docker.');
  run('docker', [
    'run', '--rm',
    '--volume', `${process.cwd()}:/workspace`,
    '--volume', 'ragenodes-dev-cargo-registry:/usr/local/cargo/registry',
    '--volume', 'ragenodes-dev-cargo-git:/usr/local/cargo/git',
    '--workdir', '/workspace',
    'rust:bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97',
    'cargo', 'test', '--manifest-path', 'oxideproxy/Cargo.toml', '--locked'
  ]);
}

const devTests = readdirSync('scripts/dev')
  .filter(name => name.endsWith('.test.mjs'))
  .map(name => `scripts/dev/${name}`);
run('node', ['--test', ...devTests]);
if (scope === 'all' || scope === 'frontend') {
  run('npm', ['run', 'security:browser']);
  run('npm', ['run', 'security:panel-render']);
}
if (scope === 'all' || scope === 'backend') run('npm', ['--prefix', 'backend', 'test']);
if (scope === 'all' || scope === 'proxy') runRustTests();
console.log(`\nPuerta local superada para: ${scope}.`);
