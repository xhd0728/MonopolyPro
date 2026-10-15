import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { resolve } from 'node:path';
// This command always creates production assets, including when run by a test job.
// Vite otherwise treats NODE_ENV=test as DEV and embeds the development API port.
process.env.NODE_ENV = 'production';
await build({
  entryPoints: ['apps/server/src/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  target: 'node22.16',
});
await viteBuild({ configFile: resolve('apps/client/vite.config.ts') });
