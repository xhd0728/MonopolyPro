import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const source = resolve(process.argv[2] ?? process.env.DATA_DIR + '/monopoly.sqlite');
const target = process.argv[3];
if (!target)
  throw Error(
    'Usage: node scripts/backup.mjs /var/lib/monopolypro/monopoly.sqlite /path/to/backup.sqlite',
  );
mkdirSync(dirname(resolve(target)), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true });
await backup(db, resolve(target));
db.close();
chmodSync(resolve(target), 0o600);
console.log(`Backup complete: ${resolve(target)}`);
