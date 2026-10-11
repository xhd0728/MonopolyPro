import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../apps/server/src/store.ts';
import { GameService } from '../apps/server/src/service.ts';
test('online SQLite backup captures committed WAL and restores the same seat and command result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'monopoly-backup-'));
  const store = new Store(join(dir, 'live.sqlite'));
  try {
    const service = new GameService(store),
      c = service.create({ name: '备份玩家' });
    service.connected(c.code, c.seatId);
    service.lobby(c.code, c.seatId, { type: 'addBot' });
    service.lobby(c.code, c.seatId, { type: 'ready' });
    service.lobby(c.code, c.seatId, { type: 'start' });
    const cmd = { id: 'backup-0001', revision: 0, action: { type: 'ability' } };
    const result = service.command(c.code, c.seatId, cmd);
    const expected = service.record(c.code);
    const target = join(dir, 'backups', 'snapshot.sqlite');
    execFileSync(process.execPath, ['scripts/backup.mjs', join(dir, 'live.sqlite'), target]);
    assert.equal(statSync(target).mode & 0o777, 0o600);
    const restored = new Store(target);
    try {
      assert.deepEqual(restored.get(c.code), expected);
      assert.deepEqual(restored.command(c.code, c.seatId, cmd.id)?.result, result);
    } finally {
      restored.close();
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
