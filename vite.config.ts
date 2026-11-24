import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const PAGES: Record<string, string> = {
  '/admin': '/admin.html',
  '/admin/': '/admin.html',
  '/rps': '/rps.html',
  '/rps/': '/rps.html',
};

function servePage(req: { url?: string }): void {
  const path = req.url?.split('?')[0] ?? '';
  const page = PAGES[path];
  if (!page) return;
  const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  req.url = `${page}${query}`;
}

export default defineConfig({
  root: resolve(__dirname, 'web'),
  // Vite's project root is web/. Env files stay at the repo root. The server still loads only .env.
  envDir: resolve(__dirname),
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        admin: resolve(__dirname, 'web/admin.html'),
        rps: resolve(__dirname, 'web/rps.html'),
      },
    },
  },
  plugins: [
    {
      name: 'html-routes',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          servePage(req);
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, _res, next) => {
          servePage(req);
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [resolve(__dirname)],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/admin/api': 'http://127.0.0.1:8080',
    },
  },
});
