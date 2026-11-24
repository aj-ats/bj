import { existsSync, readFileSync } from 'node:fs';

export interface Config {
  port: number;
  leaderboardDatabaseUrl: string;
  adminDatabaseUrl: string;
  adminUsername: string;
  adminPassword: string;
  staticDir: string;
  cookieSecure: boolean;
  /** CSP origin for the RPS page. Empty when RPS_RPC_URL is unset or invalid. */
  rpsRpcUrl: string;
}

export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const adminPassword = env.ADMIN_PASSWORD ?? (nodeEnv === 'production' ? '' : 'changeme');
  if (!adminPassword) throw new Error('ADMIN_PASSWORD is required when NODE_ENV is production');
  if (adminPassword.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
  return {
    port,
    leaderboardDatabaseUrl: required(env, 'LEADERBOARD_DATABASE_URL'),
    adminDatabaseUrl: required(env, 'ADMIN_DATABASE_URL'),
    adminUsername: env.ADMIN_USERNAME ?? 'admin',
    adminPassword,
    staticDir: env.STATIC_DIR ?? '',
    cookieSecure: env.COOKIE_SECURE === 'true',
    rpsRpcUrl: rpcOrigin(env.RPS_RPC_URL),
  };
}

function rpcOrigin(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    console.warn('RPS_RPC_URL is not a URL. The RPS page will not add it to connect-src.');
    return '';
  }
  if (url.username || url.password || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    console.warn('RPS_RPC_URL must be an http or https URL without a username. It was ignored.');
    return '';
  }
  if (/[\s;]/.test(url.origin)) {
    console.warn('RPS_RPC_URL origin is not safe to put in a CSP. It was ignored.');
    return '';
  }
  return url.origin;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}
