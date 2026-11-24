import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Hono, type Context } from 'hono';
import { RuleError } from './game/engine.ts';
import { HttpError } from './http/errors.ts';
import type { AppDeps, AppEnv } from './app-deps.ts';
import { mountAdmin } from './routes/admin.ts';
import { mountPlayer } from './routes/player.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const CSP =
  "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

function rpsContentSecurityPolicy(extraOrigin?: string): string {
  const origins = ["'self'", 'http://127.0.0.1:8545', 'http://localhost:8545'];
  if (extraOrigin && !origins.includes(extraOrigin)) origins.push(extraOrigin);
  return `default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src ${origins.join(' ')}; base-uri 'none'; frame-ancestors 'none'`;
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    try {
      await next();
    } finally {
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Referrer-Policy', 'no-referrer');
      c.header('X-Frame-Options', 'DENY');
      if (c.req.path.startsWith('/api') || c.req.path.startsWith('/admin/api')) {
        c.header('Cache-Control', 'no-store');
      }
    }
  });

  app.get('/api/health', async (c) => {
    await deps.leaderboard.query('SELECT 1');
    await deps.admin.query('SELECT 1');
    return c.json({ ok: true });
  });

  mountPlayer(app, deps);
  mountAdmin(app, deps);

  if (deps.staticDir) mountStatic(app, deps.staticDir, deps.rpsRpcUrl);

  app.get('/favicon.ico', (c) => c.body(null, 204));

  app.notFound((c) => {
    if (c.req.path.startsWith('/api') || c.req.path.startsWith('/admin/api')) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.text('Not found', 404);
  });

  app.onError((error, c) => {
    if (error instanceof HttpError || error instanceof RuleError) {
      return c.json({ error: error.message }, error.status as 400);
    }
    console.error(error);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return app;
}

function mountStatic(app: Hono<AppEnv>, root: string, extraOrigin?: string): void {
  app.get('/', async (c) => sendHtml(c, await readFile(join(root, 'index.html'), 'utf8'), CSP));
  app.get('/admin', async (c) => sendHtml(c, await readFile(join(root, 'admin.html'), 'utf8'), CSP));
  app.get('/rps', async (c) =>
    sendHtml(c, await readFile(join(root, 'rps.html'), 'utf8'), rpsContentSecurityPolicy(extraOrigin)),
  );
  app.get('/assets/*', async (c) => {
    const file = resolveAsset(root, c.req.path);
    if (!file) return c.notFound();
    const body = await readFile(file);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(body, 200, {
      'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    });
  });
}

function sendHtml(c: Context, html: string, policy: string): Response {
  c.header('Content-Security-Policy', policy);
  c.header('Cache-Control', 'no-cache');
  return c.html(html);
}

function resolveAsset(root: string, requestPath: string): string | null {
  const relative = requestPath.replace(/^\/assets\//, '');
  if (!relative || relative.includes('\0') || relative.includes('..')) return null;
  const assetsRoot = normalize(join(root, 'assets'));
  const full = normalize(join(assetsRoot, relative));
  if (full !== assetsRoot && !full.startsWith(`${assetsRoot}${sep}`)) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return full;
}
