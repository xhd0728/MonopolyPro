import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertInvariants } from '../packages/engine/src/index.ts';
import type { RoomRecord } from '../packages/shared/src/index.ts';
const dir = resolve(process.argv[2]);
const db = new DatabaseSync(resolve(dir, 'monopoly.sqlite'), { readOnly: true });
const records = (db.prepare('SELECT snapshot FROM rooms').all() as { snapshot: string }[]).map(
  (r) => JSON.parse(r.snapshot) as RoomRecord,
);
for (const r of records) {
  if (!r.game) throw Error('Room has no match');
  assertInvariants(r.game);
  const row = db
    .prepare('SELECT max(event_id) n FROM events WHERE code=? AND game_id=?')
    .get(r.code, r.game.id) as { n: number };
  if (row.n !== r.game.nextEvent - 1) throw Error('Persisted event tail mismatch');
}
const failures = (
  db.prepare("SELECT result FROM commands WHERE json_extract(result,'$.ok')=0").all() as {
    result: string;
  }[]
).map((r) => JSON.parse(r.result) as { error: string });
const reasons: Record<string, number> = {};
for (const f of failures) reasons[f.error] = (reasons[f.error] ?? 0) + 1;
const unexpected = failures.filter((f) => f.error !== '局面已更新，请按最新提示重新操作');
const stats = db
  .prepare("SELECT count(*) total,sum(json_extract(result,'$.ok')=1) accepted FROM commands")
  .get();
const result = {
  ...JSON.parse(readFileSync(resolve(dir, 'result.json'), 'utf8')),
  audit: {
    rooms: records.length,
    invariants: true,
    eventTails: true,
    commands: stats,
    rejectionReasons: reasons,
    unexpectedRejections: unexpected.length,
  },
};
db.close();
writeFileSync(resolve(dir, 'audited-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (unexpected.length) process.exitCode = 1;
