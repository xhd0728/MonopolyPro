import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import type { RoomView, CommandResult } from '../packages/shared/src/index.ts';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function freePort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
async function fixture() {
  const port = await freePort(),
    dir = mkdtempSync(join(tmpdir(), 'monopoly-net-')),
    base = `http://127.0.0.1:${port}`;
  let child: ChildProcess;
  let output = '';
  const sockets: Room[] = [];
  async function start() {
    child = spawn(process.execPath, ['dist/server/index.js'], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        DATA_DIR: dir,
        BOT_STEP_MS: '100',
        DISCONNECT_TAKEOVER_MS: '300',
        DECISION_TIMEOUT_MS: '45000',
        PUBLIC_ORIGIN: base,
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', (b) => (output += b));
    child.stderr!.on('data', (b) => (output += b));
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(base + '/healthz');
        if (r.ok) return;
      } catch {}
      await sleep(50);
    }
    throw Error(output);
  }
  async function stop(force = false) {
    if (child.exitCode !== null) return;
    const exit = new Promise<void>((r) => child.once('exit', () => r()));
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
    await exit;
  }
  async function api(path: string, body?: unknown) {
    const r = await fetch(
      base + path,
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {},
    );
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  async function connect(c: any) {
    const room = await new Client(base.replace('http', 'ws')).joinById(c.roomId, { key: c.key });
    room.reconnection.enabled = false;
    sockets.push(room);
    let view: RoomView | undefined;
    room.onMessage('view', (v: RoomView) => (view = v));
    room.onMessage('error', () => {});
    room.onMessage('pong', () => {});
    room.send('sync');
    await until(() => !!view);
    return {
      room,
      get view() {
        return view!;
      },
    };
  }
  await start();
  return {
    api,
    connect,
    start,
    stop,
    base,
    cleanup: async () => {
      for (const s of sockets) void s.leave();
      await stop();
      rmSync(dir, { recursive: true, force: true });
    },
    get output() {
      return output;
    },
  };
}
async function until(fn: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw Error('Condition timed out');
    await sleep(20);
  }
}
test('real sockets: 2/4/6 seats, spectator privacy, concurrency, duplicate, stale commands and crash restore', async () => {
  const f = await fixture();
  try {
    const page = await fetch(f.base);
    assert.match(page.headers.get('cache-control')!, /no-cache/);
    for (const count of [2, 4, 6]) {
      const c = await f.api('/api/rooms', {
        name: '房主',
        settings: { mapId: 'town', mode: 'free', minutes: 5, initialCash: 3000, maxPlayers: count },
      });
      const first = await f.connect(c),
        players = [first];
      for (let i = 1; i < count; i++)
        players.push(
          await f.connect(await f.api(`/api/rooms/${c.code}/join`, { name: `好友${i}` })),
        );
      for (const p of players) p.room.send('lobby', { type: 'ready', ready: true });
      await until(() => first.view.seats.every((s) => s.ready));
      first.room.send('lobby', { type: 'start' });
      await until(() => !!first.view.game);
      const observer = await f.connect(
        await f.api(`/api/rooms/${c.code}/join`, { name: '观众', spectator: true }),
      );
      assert.ok(observer.view.game?.players.every((p) => !('cards' in p) && !('nextDice' in p)));
      assert.ok(players[1].view.game?.players[0].cards === undefined);
      const id = randomUUID(),
        cmd = { id, revision: 0, action: { type: 'ability' } };
      const acks: CommandResult[] = [];
      first.room.onMessage('ack', (a: CommandResult) => acks.push(a));
      first.room.send('command', cmd);
      first.room.send('command', cmd);
      await until(() => acks.length === 2);
      assert.deepEqual(acks[0], acks[1]);
      assert.equal(first.view.game!.players[0].cash, 3180);
      assert.equal(first.view.game!.revision, 1);
      first.room.send('command', { id: randomUUID(), revision: 0, action: { type: 'roll' } });
      await until(() => acks.length === 3);
      assert.equal(acks[2].ok, false);
      const unauthorized: CommandResult[] = [];
      players[1].room.onMessage('ack', (a: CommandResult) => unauthorized.push(a));
      players[1].room.send('command', { id: randomUUID(), revision: 1, action: { type: 'roll' } });
      first.room.send('command', { id: randomUUID(), revision: 1, action: { type: 'roll' } });
      await until(() => unauthorized.length > 0 && acks.length === 4);
      assert.equal(unauthorized[0].ok, false);
      assert.equal(acks[3].ok, true);
      first.room.send('command', {
        id: randomUUID(),
        revision: first.view.game!.revision,
        action: { type: 'bid', amount: null },
      });
      await until(() => acks.length === 5);
      assert.equal(acks[4].ok, false);
      assert.equal(acks[4].error, '请求格式无效');
      if (count === 2) {
        const revision = first.view.game!.revision;
        await f.stop(true);
        await f.start();
        const resumed = await f.connect(
          await f.api(`/api/rooms/${c.code}/resume`, { token: c.token }),
        );
        assert.equal(resumed.view.viewerId, c.seatId);
        assert.equal(resumed.view.game!.revision, revision);
        const ack: CommandResult[] = [];
        resumed.room.onMessage('ack', (a: CommandResult) => ack.push(a));
        resumed.room.send('command', cmd);
        await until(() => ack.length > 0);
        assert.deepEqual(ack[0], acks[0]);
        assert.equal(resumed.view.game!.revision, revision);
        await f.stop(true);
        await f.start();
        await sleep(600);
        const unattended = await f.connect(
          await f.api(`/api/rooms/${c.code}/resume`, { token: c.token }),
        );
        assert.ok(
          unattended.view.game!.revision > revision,
          'restored rooms should progress before any human reconnects',
        );
      }
      if (count === 4) {
        await first.room.leave();
        await until(() => players[1].view.isHost);
        const restored = await f.connect(
          await f.api(`/api/rooms/${c.code}/resume`, { token: c.token }),
        );
        assert.equal(restored.view.viewerId, c.seatId);
        assert.equal(restored.view.isHost, false);
      }
      for (const p of players) void p.room.leave();
      void observer.room.leave();
    }
    const denied = await fetch(f.base + '/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://hostile.example' },
      body: JSON.stringify({ name: '恶意' }),
    });
    assert.equal(denied.status, 403);
  } finally {
    await f.cleanup();
  }
});
