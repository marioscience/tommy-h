import { GameDig } from 'gamedig';

export const GAME_PROFILES = Object.freeze({
  minecraft: { type: 'minecraft', port: 25565 },
  fivem: { type: 'fivem', port: 30120 },
  rust: { type: 'rust', port: 28015 },
  palworld: { type: 'palworld', port: 8211 },
  ark: { type: 'asa', port: 7777 },
  cs2: { type: 'cs2', port: 27015 },
  '7dtd': { type: '7d2d', port: 26900 },
  valheim: { type: 'valheim', port: 2456 },
  zomboid: { type: 'projectzomboid', port: 16261 }
});

function positivePort(value, label) {
  const port = Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} debe estar entre 1 y 65535.`);
  }
  return port;
}

function positiveInteger(value, label) {
  const number = Number.parseInt(String(value), 10);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} debe ser un entero positivo.`);
  }
  return number;
}

export function smokeOptions(game, environment = process.env) {
  const profile = GAME_PROFILES[game];
  if (!profile) throw new Error(`Juego desconocido. Disponibles: ${Object.keys(GAME_PROFILES).join(', ')}`);
  const host = environment.GAME_SMOKE_HOST?.trim();
  if (!host) throw new Error('Define GAME_SMOKE_HOST con la IP o dominio que quieres comprobar.');
  return {
    type: environment.GAME_SMOKE_TYPE?.trim() || profile.type,
    host,
    port: positivePort(environment.GAME_SMOKE_PORT || profile.port, 'GAME_SMOKE_PORT'),
    ...(environment.GAME_SMOKE_QUERY_PORT
      ? { queryPort: positivePort(environment.GAME_SMOKE_QUERY_PORT, 'GAME_SMOKE_QUERY_PORT') }
      : {}),
    maxAttempts: 1,
    socketTimeout: positiveInteger(environment.GAME_SMOKE_TIMEOUT_MS || 5000, 'GAME_SMOKE_TIMEOUT_MS')
  };
}

export async function queryGame(game, environment = process.env, query = GameDig.query) {
  const options = smokeOptions(game, environment);
  const startedAt = performance.now();
  const state = await query(options);
  return {
    game,
    host: options.host,
    port: options.port,
    queryPort: options.queryPort || null,
    latencyMs: Number((performance.now() - startedAt).toFixed(2)),
    name: state.name || null,
    map: state.map || null,
    players: Array.isArray(state.players) ? state.players.length : null,
    maxPlayers: state.maxplayers ?? null,
    connect: state.connect || null,
    raw: state.raw || null
  };
}

export async function gameSmokeMain(game, environment = process.env) {
  const result = await queryGame(game, environment);
  console.log(JSON.stringify({ status: 'pass', ...result }, null, 2));
}
