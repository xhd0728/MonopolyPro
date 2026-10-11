import { cpSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
if (!existsSync('dist/server/index.js') || !existsSync('dist/client/index.html'))
  throw Error('Run pnpm build first');
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw Error('Commit source changes before packaging a release');
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dir = resolve(`releases/monopolypro-${sha}`);
if (existsSync(dir)) throw Error(`Release already exists: ${dir}`);
mkdirSync(dir, { recursive: true });
for (const file of [
  'dist',
  'deploy',
  'scripts/backup.mjs',
  'docs',
  'README.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.env.example',
]) {
  const dest = resolve(dir, file);
  mkdirSync(resolve(dest, '..'), { recursive: true });
  cpSync(file, dest, { recursive: true });
}
writeFileSync(
  resolve(dir, 'RELEASE.json'),
  JSON.stringify(
    { sha, commit, node: process.version, builtAt: new Date().toISOString(), schema: 1 },
    null,
    2,
  ),
);
const archive = `${dir}.tar.gz`;
execFileSync('tar', ['-czf', archive, '-C', resolve('releases'), `monopolypro-${sha}`]);
const source = `${dir}-source.tar.gz`;
execFileSync('git', ['archive', '--format=tar.gz', `--output=${source}`, 'HEAD']);
writeFileSync(
  `${archive}.sha256`,
  [archive, source]
    .map(
      (file) =>
        `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${file.split('/').at(-1)}`,
    )
    .join('\n') + '\n',
);
console.log(JSON.stringify({ archive, source, sha }));
