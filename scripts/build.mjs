import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { resolve } from 'node:path';
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
