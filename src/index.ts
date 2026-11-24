import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { ensureAdmin } from './auth/admin-user.ts';
import { createApp } from './app.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { ADMIN_SQL, LEADERBOARD_SQL } from './db/schema.ts';
import { createPool, migrate } from './db/pool.ts';
import { casinoShoe } from './game/shoe.ts';

loadDotEnv();
const config = loadConfig();

if (config.staticDir && !existsSync(config.staticDir)) {
  throw new Error(`STATIC_DIR does not exist: ${config.staticDir}`);
}

const leaderboard = createPool(config.leaderboardDatabaseUrl);
const admin = createPool(config.adminDatabaseUrl);

await migrate(leaderboard, LEADERBOARD_SQL);
await migrate(admin, ADMIN_SQL);
await ensureAdmin(admin, config.adminUsername, config.adminPassword);

if (config.adminPassword === 'changeme') {
  console.warn('ADMIN_PASSWORD is the local default. Set a real password before exposing this service.');
}

const app = createApp({
  leaderboard,
  admin,
  shoeSource: casinoShoe,
  cookieSecure: config.cookieSecure,
  ...(config.staticDir ? { staticDir: config.staticDir } : {}),
  ...(config.rpsRpcUrl ? { rpsRpcUrl: config.rpsRpcUrl } : {}),
});

const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: config.port }, (info) => {
  console.log(`free-bj listening on http://localhost:${info.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await leaderboard.end();
  await admin.end();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
