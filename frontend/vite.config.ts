/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Production builds get a strict Content-Security-Policy: the page may only talk to
// its own origin, so document content cannot be sent anywhere else from the browser.
// (Dev mode skips it because Vite's hot reload needs inline scripts and websockets.)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'clausewise-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.CLAUSEWISE_BACKEND_URL || 'http://127.0.0.1:8000';
  // Local inference on a laptop can take minutes, so the proxy must not cut it off.
  const proxy = { '/api': { target: backend, changeOrigin: false, timeout: 900_000, proxyTimeout: 900_000 } };
  return {
    plugins: [react(), cspPlugin()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      proxy,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
      css: false,
    },
  };
});
