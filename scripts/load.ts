import { spawn, execFileSync } from 'node:child_process';
import { cpus, totalmem, release } from 'node:os';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import type { RoomView, GameAction, CommandResult } from '../packages/shared/src/index.ts';
const duration = Number(process.env.LOAD_SECONDS ?? 1800),
  port = Number(process.env.LOAD_PORT ?? 8791),
  base = `http://127.0.0.1:${port}`,
  dir = resolve(`artifacts/load-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const started = Date.now(),
  logs: string[] = [];
const bundle = readFileSync('dist/server/index.js');
const savedBundle = resolve(dir, 'server-under-test.js');
writeFileSync(savedBundle, bundle);
const server = spawn(process.execPath, [savedBundle], {
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dir,
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: base,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (b) => logs.push(String(b)));
server.stderr.on('data', (b) => logs.push(String(b)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function request(path: string, body?: unknown) {
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
  if (!r.ok) throw Error(JSON.stringify(d));
  return d;
}
for (let i = 0; i < 100; i++) {
  try {
    await request('/healthz');
    break;
  } catch {
    await sleep(100);
  }
}
type Seat = { id: string; room: Room; view?: RoomView; pending: boolean };
const matches: Seat[][] = [],
  ackTimes = new Map<string, number>(),
  latencies: number[] = [],
  health: number[] = [];
let accepted = 0,
  rejected = 0,
  disconnects = 0,
  views = 0,
  fatal = '';
const reasons: Record<string, number> = {},
  memory: number[] = [],
  cpu: number[] = [];
const reject = (reason: string) => {
  rejected++;
  reasons[reason] = (reasons[reason] ?? 0) + 1;
};
async function connect(c: any): Promise<Seat> {
  const room = await new Client(base.replace('http', 'ws')).joinById(c.roomId, { key: c.key });
  room.reconnection.enabled = false;
  const seat: Seat = { id: c.seatId, room, pending: false };
  room.onMessage('view', (v: RoomView) => {
    seat.view = v;
    views++;
  });
  room.onMessage('ack', (a: CommandResult) => {
    seat.pending = false;
    const t = ackTimes.get(a.id);
    if (t) {
      latencies.push(performance.now() - t);
      ackTimes.delete(a.id);
    }
    if (a.ok) accepted++;
    else reject(a.error ?? 'unknown');
  });
  room.onMessage('error', (message: string) => {
    reject(message);
    seat.pending = false;
  });
  room.onLeave(() => disconnects++);
  room.send('sync');
  return seat;
}
try {
  for (let n = 0; n < 20; n++) {
    const settings = {
      mapId: ['town', 'islands', 'neon', 'ancient'][n % 4],
      mode: n % 5 === 0 ? 'team' : 'free',
      minutes: 30,
      initialCash: 3000,
      maxPlayers: 6,
    };
    const first = await request('/api/rooms', { name: `L${n}-0`, settings });
    const seats = [await connect(first)];
    for (let i = 1; i < 6; i++) {
      seats.push(
        await connect(
          await request(`/api/rooms/${first.code}/join`, {
            name: `L${n}-${i}`,
            characterId: ['builder', 'landlord', 'runner', 'guardian', 'dealer', 'explorer'][i],
          }),
        ),
      );
    }
    for (const s of seats) s.room.send('lobby', { type: 'ready', ready: true });
    await sleep(50);
    seats[0].room.send('lobby', { type: 'start' });
    matches.push(seats);
  }
  console.log(JSON.stringify({ event: 'load_started', rooms: 20, seats: 120, duration, dir }));
  const end = Date.now() + duration * 1000;
  let nextSample = 0;
  while (Date.now() < end) {
    for (const seats of matches) {
      const v = seats[0].view,
        g = v?.game;
      if (!g || g.phase === 'finished') continue;
      const actor = seats.find((s) => s.id === g.activeId);
      if (!actor || actor.pending) continue;
      const a = actor.view?.game?.actions;
      if (!a?.length) continue;
      let action: GameAction | undefined = a.find((x) => x.primary)?.action;
      if (g.phase === 'auction') {
        action =
          g.auction!.highBid < 100
            ? (a.find((x) => x.action.type === 'bid')?.action ?? { type: 'auctionPass' })
            : { type: 'auctionPass' };
      }
      if (g.phase === 'debt')
        action = a.find(
          (x) =>
            x.action.type === 'bank' ||
            x.action.type === 'downgrade' ||
            x.action.type === 'mortgage',
        )?.action ?? { type: 'surrender' };
      if (!action) action = a.find((x) => x.action.type === 'pass')?.action;
      if (action) {
        const id = randomUUID();
        actor.pending = true;
        ackTimes.set(id, performance.now());
        actor.room.send('command', { id, revision: actor.view!.game!.revision, action });
      }
    }
    if (Date.now() > nextSample) {
      const t = performance.now();
      await request('/healthz');
      health.push(performance.now() - t);
      try {
        const values = execFileSync('ps', ['-p', String(server.pid), '-o', 'rss=,%cpu='], {
          encoding: 'utf8',
        })
          .trim()
          .split(/\s+/)
          .map(Number);
        memory.push(values[0]);
        cpu.push(values[1]);
      } catch {}
      nextSample = Date.now() + 10000;
      console.log(
        JSON.stringify({
          event: 'progress',
          seconds: Math.floor((Date.now() - started) / 1000),
          accepted,
          rejected,
          disconnects,
          views,
        }),
      );
    }
    await sleep(250);
  }
} catch (error) {
  fatal = (error as Error).stack ?? String(error);
  console.error(fatal);
}
const percentile = (a: number[], p: number) =>
  a.length ? [...a].sort((a, b) => a - b)[Math.min(a.length - 1, Math.floor(a.length * p))] : null;
const result = {
  started: new Date(started).toISOString(),
  durationSeconds: (Date.now() - started) / 1000,
  targetSeconds: duration,
  rooms: matches.length,
  seats: matches.flat().length,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  osVersion: release(),
  cpuModel: cpus()[0]?.model,
  cpuCount: cpus().length,
  totalMemoryGiB: totalmem() / 1024 ** 3,
  serverBundleSha256: createHash('sha256').update(bundle).digest('hex'),
  maxSampledRssMiB: memory.length ? Math.max(...memory) / 1024 : null,
  maxSampledCpuPercent: cpu.length ? Math.max(...cpu) : null,
  rejectionReasons: reasons,
  unexpectedRejections: rejected - (reasons['局面已更新，请按最新提示重新操作'] ?? 0),
  accepted,
  rejected,
  disconnects,
  views,
  ackP50: percentile(latencies, 0.5),
  ackP95: percentile(latencies, 0.95),
  ackP99: percentile(latencies, 0.99),
  healthP95: percentile(health, 0.95),
  completedMatches: matches.filter((m) => m[0].view?.game?.phase === 'finished').length,
  fatal,
};
writeFileSync(resolve(dir, 'result.json'), JSON.stringify(result, null, 2));
writeFileSync(resolve(dir, 'server.log'), logs.join(''));
for (const s of matches.flat()) void s.room.leave();
server.kill('SIGTERM');
console.log(JSON.stringify(result));
if (fatal || matches.length !== 20 || disconnects || result.unexpectedRejections)
  process.exitCode = 1;
