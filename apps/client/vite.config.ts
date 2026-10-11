import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve('apps/client'),
  build: {
    outDir: resolve('dist/client'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/react-dom/') || id.includes('/react/')) return 'react';
          if (id.includes('/zod/')) return 'validation';
          if (id.includes('/@colyseus/')) return 'network';
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/healthz': 'http://127.0.0.1:8788',
      '/matchmake': 'http://127.0.0.1:8788',
    },
  },
});
