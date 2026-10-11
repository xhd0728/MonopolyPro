import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommandResult, RoomRecord } from '../../../packages/shared/src/index.ts';

export class Store {
  readonly db: DatabaseSync;
  private records = new Map<string, RoomRecord>();
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = Number((this.db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version);
    if (version > 1) throw new Error(`Database schema ${version} is newer than this server supports (1). Restore a compatible release.`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands(code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, player_id TEXT NOT NULL, command_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(code,player_id,command_id));
      CREATE TABLE IF NOT EXISTS events(code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, game_id TEXT NOT NULL, event_id INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(code,game_id,event_id));
      PRAGMA user_version=1;
    `);
    for (const row of this.db.prepare('SELECT snapshot FROM rooms').all() as {snapshot:string}[]) {
      const record = JSON.parse(row.snapshot) as RoomRecord;
      if (record.version !== 1 || record.game && record.game.version !== 1) throw new Error('Unsupported snapshot version');
      this.records.set(record.code, record);
    }
  }
  get(code: string): RoomRecord | undefined { const r = this.records.get(code); return r && structuredClone(r); }
  all(): RoomRecord[] { return [...this.records.values()].map(r => structuredClone(r)); }
  command(code: string, playerId: string, id: string): {fingerprint:string;result:CommandResult} | null {
    const row = this.db.prepare('SELECT fingerprint,result FROM commands WHERE code=? AND player_id=? AND command_id=?').get(code,playerId,id) as {fingerprint:string;result:string} | undefined;
    return row ? { fingerprint:row.fingerprint,result:JSON.parse(row.result) } : null;
  }
  save(record: RoomRecord, command?: {playerId:string;id:string;fingerprint:string;result:CommandResult}): void {
    const oldLast = this.records.get(record.code)?.game;
    const previousEvent = oldLast?.id === record.game?.id ? (oldLast?.nextEvent ?? 1)-1 : 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO rooms VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET updated_at=excluded.updated_at,snapshot=excluded.snapshot').run(record.code,record.updatedAt,JSON.stringify(record));
      if (record.game) for (const event of record.game.events.filter(e => e.id > previousEvent)) this.db.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?)').run(record.code,record.game.id,event.id,JSON.stringify(event));
      if (command) this.db.prepare('INSERT INTO commands VALUES(?,?,?,?,?)').run(record.code,command.playerId,command.id,command.fingerprint,JSON.stringify(command.result));
      this.db.exec('COMMIT');
      this.records.set(record.code,structuredClone(record));
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  remove(code: string) { this.db.prepare('DELETE FROM rooms WHERE code=?').run(code); this.records.delete(code); }
  close() { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); this.db.close(); }
}

