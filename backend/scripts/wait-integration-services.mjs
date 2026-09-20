import pg from 'pg';
import { createClient } from 'redis';

const attempts = Number.parseInt(process.env.INTEGRATION_WAIT_ATTEMPTS || '30', 10);
const delayMs = Number.parseInt(process.env.INTEGRATION_WAIT_MS || '1000', 10);

const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function probe() {
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const redis = createClient({ url: process.env.REDIS_URL });
  try {
    await database.connect();
    await database.query('SELECT 1');
    await redis.connect();
    if (await redis.ping() !== 'PONG') throw new Error('Redis no respondió PONG');
  } finally {
    await database.end().catch(() => {});
    if (redis.isOpen) await redis.quit().catch(() => {});
  }
}

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    await probe();
    console.log(`PostgreSQL y Redis disponibles (intento ${attempt}/${attempts}).`);
    process.exit(0);
  } catch (error) {
    if (attempt === attempts) throw new Error(`Dependencias no disponibles: ${error.message}`);
    await sleep(delayMs);
  }
}
