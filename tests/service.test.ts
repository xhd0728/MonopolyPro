import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/src/store.ts';
import { GameService } from '../apps/server/src/service.ts';
import { DEFAULT_SETTINGS } from '../packages/shared/src/index.ts';
const fixture = () => {
  const store = new Store(':memory:');
  let now = 1000;
  const service = new GameService(store, { now: () => now });
  const c = service.create({ name: '甲', password: 'test' });
  service.connected(c.code, c.seatId);
  service.lobby(c.code, c.seatId, { type: 'addBot' });
  service.lobby(c.code, c.seatId, { type: 'ready' });
  service.lobby(c.code, c.seatId, { type: 'start' });
  return { store, service, c, time: (t: number) => (now = t) };
};
test('authenticated lobby, locked room, private views and durable idempotent commands', () => {
  const { store, service, c } = fixture();
  assert.throws(() => service.join(c.code, { name: '乙', password: 'wrong' }));
  assert.throws(() => service.authenticate(c.code, 'x'.repeat(43)));
  const observer = service.join(c.code, { name: '观众', password: 'test', spectator: true });
  assert.equal(service.view(c.code, observer.seatId).game?.players[0].cards, undefined);
  assert.throws(() =>
    service.command(c.code, observer.seatId, {
      id: 'spectator-001',
      revision: 0,
      action: { type: 'roll' },
    }),
  );
  const command = { id: 'dedup-0001', revision: 0, action: { type: 'ability' } };
  const result = service.command(c.code, c.seatId, command);
  assert.equal(result.ok, true);
  const cash = service.record(c.code).game!.players[0].cash;
  assert.deepEqual(service.command(c.code, c.seatId, command), result);
  assert.equal(service.record(c.code).game!.players[0].cash, cash);
  assert.throws(() => service.command(c.code, c.seatId, { ...command, action: { type: 'roll' } }));
  assert.equal(
    service.command(c.code, c.seatId, { id: 'stale-0001', revision: 0, action: { type: 'roll' } })
      .ok,
    false,
  );
  store.close();
});
test('15s disconnect takeover, returning player retains seat and cancels bot control', () => {
  const { store, service, c, time } = fixture();
  service.disconnected(c.code, c.seatId);
  time(15999);
  service.tick(c.code);
  assert.equal(service.record(c.code).game!.revision, 0);
  time(16000);
  service.tick(c.code);
  assert.equal(service.view(c.code, c.seatId).seats[0].takeover, true);
  assert.ok(service.record(c.code).game!.revision > 0);
  service.connected(c.code, c.seatId);
  assert.equal(service.view(c.code, c.seatId).seats[0].takeover, false);
  const revision = service.record(c.code).game!.revision;
  time(16001);
  service.tick(c.code);
  assert.equal(service.record(c.code).game!.revision, revision);
  store.close();
});
test('restart restores trade, auction and path decisions with resume credentials and dedup', () => {
  for (const phase of ['trade', 'auction', 'path']) {
    const dir = mkdtempSync(join(tmpdir(), 'monopoly-'));
    const path = join(dir, 'state.sqlite');
    let store = new Store(path),
      service = new GameService(store, { now: () => 1000 });
    const c = service.create({ name: '甲' });
    service.connected(c.code, c.seatId);
    service.lobby(c.code, c.seatId, { type: 'addBot' });
    service.lobby(c.code, c.seatId, { type: 'ready' });
    service.lobby(c.code, c.seatId, { type: 'start' });
    let r = service.record(c.code);
    if (phase === 'trade') {
      const other = r.game!.players[1].id;
      service.command(c.code, c.seatId, {
        id: 'saved-trade',
        revision: 0,
        action: {
          type: 'tradeOffer',
          to: other,
          giveCash: 50,
          wantCash: 0,
          giveTiles: [],
          wantTiles: [],
        },
      });
    } else if (phase === 'auction') {
      r.game!.phase = 'purchase';
      r.game!.players[0].position = 1;
      store.save(r);
      service.command(c.code, c.seatId, {
        id: 'saved-auction',
        revision: 0,
        action: { type: 'pass' },
      });
    } else {
      r.settings.mapId = 'neon';
      r.game!.settings.mapId = 'neon';
      r.game!.players[0].position = 11;
      r.game!.players[0].nextDice = 1;
      store.save(r);
      service.command(c.code, c.seatId, {
        id: 'saved-path',
        revision: 0,
        action: { type: 'roll' },
      });
    }
    const expected = service.record(c.code).game;
    store.close();
    store = new Store(path);
    service = new GameService(store, { now: () => 1100 });
    assert.deepEqual(service.record(c.code).game, expected);
    assert.equal(service.authenticate(c.code, c.token).seat.id, c.seatId);
    assert.equal(service.view(c.code, c.seatId).seats[0].connected, false);
    assert.ok(store.command(c.code, c.seatId, `saved-${phase}`)?.result.ok);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('full spectator gallery does not block remaining player seats', () => {
  const store = new Store(':memory:');
  try {
    const service = new GameService(store),
      c = service.create({ name: '甲' });
    for (let i = 0; i < 20; i++) service.join(c.code, { name: `观众${i}`, spectator: true });
    assert.throws(() => service.join(c.code, { name: '观众21', spectator: true }));
    const human = service.join(c.code, { name: '乙' });
    assert.equal(
      service.view(c.code, human.seatId).seats.find((s) => s.id === human.seatId)?.spectator,
      false,
    );
  } finally {
    store.close();
  }
});
test('inactive offline seats announce takeover at the grace boundary without changing the game', () => {
  const store = new Store(':memory:');
  let now = 1000;
  const service = new GameService(store, { now: () => now });
  const host = service.create({ name: '在线房主' });
  const guest = service.join(host.code, { name: '等候玩家' });
  for (const seat of [host, guest]) {
    service.connected(host.code, seat.seatId);
    service.lobby(host.code, seat.seatId, { type: 'ready' });
  }
  service.lobby(host.code, host.seatId, { type: 'start' });
  service.disconnected(host.code, guest.seatId);
  now = 15999;
  assert.equal(service.tick(host.code), false);
  now = 16000;
  assert.equal(service.tick(host.code), true);
  assert.equal(
    service.view(host.code, host.seatId).seats.find((s) => s.id === guest.seatId)!.takeover,
    true,
  );
  assert.equal(service.record(host.code).game!.revision, 0);
  now = 16001;
  assert.equal(service.tick(host.code), false);
  service.connected(host.code, guest.seatId);
  assert.equal(service.tick(host.code), true);
  assert.equal(
    service.view(host.code, host.seatId).seats.find((s) => s.id === guest.seatId)!.takeover,
    false,
  );
  service.dispose();
  store.close();
});
test('legacy 28-tile snapshots return the room to the lobby instead of blocking startup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'monopoly-'));
  const path = join(dir, 'legacy.sqlite');
  let store = new Store(path);
  const service = new GameService(store, { now: () => 1000 });
  const c = service.create({ name: '甲' });
  service.lobby(c.code, c.seatId, { type: 'addBot' });
  service.lobby(c.code, c.seatId, { type: 'ready' });
  service.connected(c.code, c.seatId);
  service.lobby(c.code, c.seatId, { type: 'start' });
  const r = service.record(c.code);
  (r.game as unknown as { version: number }).version = 1;
  store.save(r);
  store.close();
  store = new Store(path);
  const restored = store.get(c.code)!;
  assert.equal(restored.game, null);
  assert.equal(restored.seats.find((s) => !s.bot)!.ready, false);
  assert.match(restored.chat.at(-1)!.text, /36 格/);
  store.close();
  // The migration is persisted, so a second start sees the same lobby.
  store = new Store(path);
  assert.equal(store.get(c.code)!.game, null);
  store.close();
});
test('version-2 games on the 36-square board load with decks, news and guesses filled in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'monopoly-'));
  const path = join(dir, 'v2.sqlite');
  let store = new Store(path);
  const service = new GameService(store, { now: () => 1000 });
  const c = service.create({ name: '甲' });
  service.lobby(c.code, c.seatId, { type: 'addBot' });
  service.lobby(c.code, c.seatId, { type: 'ready' });
  service.connected(c.code, c.seatId);
  service.lobby(c.code, c.seatId, { type: 'start' });
  const r = service.record(c.code);
  const old = r.game as unknown as Record<string, unknown>;
  old.version = 2;
  delete old.decks;
  delete old.news;
  delete old.guesses;
  for (const p of r.game!.players) delete (p as unknown as Record<string, unknown>).prophet;
  store.save(r);
  store.close();
  store = new Store(path);
  const g = store.get(c.code)!.game!;
  assert.equal(g.version, 3);
  assert.equal(g.decks.chance.length, 16);
  assert.equal(g.decks.fate.length, 16);
  assert.deepEqual(g.guesses, {});
  assert.ok(g.players.every((p) => p.prophet === 0));
  store.close();
});
test('emotes are fixed, rate limited, shown briefly and never persisted', () => {
  const store = new Store(':memory:');
  let now = 1000;
  const service = new GameService(store, { now: () => now });
  const c = service.create({ name: '甲' });
  service.emote(c.code, c.seatId, '🎉');
  assert.throws(() => service.emote(c.code, c.seatId, '😂'), /太快/);
  assert.throws(() => service.emote(c.code, c.seatId, '<b>hi</b>'));
  assert.deepEqual(
    service.view(c.code, c.seatId).emotes.map((e) => e.emote),
    ['🎉'],
  );
  now += 3000;
  service.emote(c.code, c.seatId, '👍');
  now += 4000;
  assert.deepEqual(
    service.view(c.code, c.seatId).emotes.map((e) => e.emote),
    ['👍'],
    'older reactions expire',
  );
  assert.equal(JSON.stringify(store.get(c.code)).includes('👍'), false);
  store.close();
});

test('human decisions are untimed by default; a host-set limit plays a safe default', () => {
  for (const turnSeconds of [0, 60]) {
    const store = new Store(':memory:');
    let now = 1000;
    const service = new GameService(store, { now: () => now });
    const c = service.create({ name: '甲', settings: { ...DEFAULT_SETTINGS, turnSeconds } });
    service.connected(c.code, c.seatId);
    service.lobby(c.code, c.seatId, { type: 'addBot', botMode: 'rule' });
    service.lobby(c.code, c.seatId, { type: 'ready' });
    service.lobby(c.code, c.seatId, { type: 'start' });
    const before = service.record(c.code).game!.revision;
    now += 10 * 60 * 1000;
    service.tick(c.code);
    const after = service.record(c.code).game!.revision;
    if (turnSeconds) assert.ok(after > before, 'a set limit moves the game on');
    else assert.equal(after, before, 'no limit: the game waits for the player');
    assert.equal(service.view(c.code, c.seatId).decisionTimeoutMs, turnSeconds * 1000);
    store.close();
  }
});
test('auto-play, renaming mid-match, and the host handing an idle seat to a bot', () => {
  const store = new Store(':memory:');
  let now = 1000;
  const service = new GameService(store, { now: () => now });
  const c = service.create({ name: '甲' });
  const b = service.join(c.code, { name: '乙' });
  service.connected(c.code, c.seatId);
  service.connected(c.code, b.seatId);
  service.lobby(c.code, c.seatId, { type: 'ready' });
  service.lobby(c.code, b.seatId, { type: 'ready' });
  service.lobby(c.code, c.seatId, { type: 'start' });
  // Rename at any time; the match uses the new name.
  service.lobby(c.code, b.seatId, { type: 'rename', name: '乙乙' });
  assert.equal(service.record(c.code).game!.players[1].name, '乙乙');
  // Auto-play: the rule bot acts for the seat even though it is connected and untimed.
  service.lobby(c.code, c.seatId, { type: 'afk', afk: true });
  assert.equal(service.view(c.code, b.seatId).seats[0].afk, true);
  const before = service.record(c.code).game!.revision;
  service.tick(c.code);
  assert.ok(service.record(c.code).game!.revision > before);
  // Acting again switches auto-play off.
  const g = service.record(c.code).game!;
  const mine = g.players[g.turn].id === c.seatId;
  service.command(c.code, mine ? c.seatId : b.seatId, {
    id: 'back-at-table',
    revision: g.revision,
    action: { type: 'surrender' },
  });
  if (mine) assert.equal(service.record(c.code).seats[0].afk, false);
  store.close();
  // Host controls: in the lobby a player is removed; mid-match the seat goes to a bot.
  const s2 = new Store(':memory:');
  const svc = new GameService(s2, { now: () => now });
  const h = svc.create({ name: '房主' });
  const x = svc.join(h.code, { name: '挂机的人' });
  assert.throws(() => svc.lobby(h.code, x.seatId, { type: 'kick', seatId: h.seatId }), /房主/);
  assert.equal(svc.lobby(h.code, h.seatId, { type: 'kick', seatId: x.seatId }), x.seatId);
  assert.equal(svc.record(h.code).seats.length, 1);
  const y = svc.join(h.code, { name: '玩家二' });
  svc.connected(h.code, h.seatId);
  svc.connected(h.code, y.seatId);
  svc.lobby(h.code, h.seatId, { type: 'ready' });
  svc.lobby(h.code, y.seatId, { type: 'ready' });
  svc.lobby(h.code, h.seatId, { type: 'start' });
  svc.lobby(h.code, h.seatId, { type: 'kick', seatId: y.seatId });
  const seat = svc.record(h.code).seats.find((s) => s.id === y.seatId)!;
  assert.equal(seat.bot, true);
  assert.throws(() => svc.authenticate(h.code, y.token), /无法恢复/);
  s2.close();
});
test('reported pings show on connected human seats and only band changes trigger a broadcast', () => {
  const store = new Store(':memory:');
  const service = new GameService(store, { now: () => 1000 });
  const c = service.create({ name: '甲' });
  service.connected(c.code, c.seatId);
  assert.equal(service.reportLatency(c.code, c.seatId, 40), true, 'first report');
  assert.equal(service.reportLatency(c.code, c.seatId, 60), false, 'still good');
  assert.equal(service.reportLatency(c.code, c.seatId, 300), true, 'became poor');
  assert.equal(service.reportLatency(c.code, c.seatId, 'x'), false);
  assert.equal(service.reportLatency(c.code, c.seatId, -1), false);
  assert.equal(service.view(c.code, c.seatId).seats[0].latency, 300);
  service.disconnected(c.code, c.seatId);
  assert.equal(service.view(c.code, c.seatId).seats[0].latency, undefined);
  store.close();
});
test('review fixes: kicked seats cannot reconnect with an old grant; auto-play ends with the match', () => {
  const store = new Store(':memory:');
  const service = new GameService(store, { now: () => 1000 });
  const h = service.create({ name: '房主' });
  const y = service.join(h.code, { name: '玩家二' });
  service.connected(h.code, h.seatId);
  service.connected(h.code, y.seatId);
  service.lobby(h.code, h.seatId, { type: 'ready' });
  service.lobby(h.code, y.seatId, { type: 'ready' });
  service.lobby(h.code, h.seatId, { type: 'start' });
  const grant = service.grant(h.code, y.token);
  service.lobby(h.code, h.seatId, { type: 'kick', seatId: y.seatId });
  assert.throws(() => service.consumeGrant(h.code, grant.key), /凭证|机器人/);
  assert.throws(
    () =>
      service.command(h.code, y.seatId, {
        id: 'ghost-move',
        revision: 0,
        action: { type: 'roll' },
      }),
    /机器人/,
  );
  // Auto-play is cleared when the next match is set up.
  service.lobby(h.code, h.seatId, { type: 'afk', afk: true });
  const r = service.record(h.code);
  r.game!.phase = 'finished';
  store.save(r);
  service.lobby(h.code, h.seatId, { type: 'newMatch' });
  assert.equal(service.record(h.code).seats[0].afk, false);
  store.close();
});
