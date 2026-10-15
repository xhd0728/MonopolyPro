/** Deterministic authoritative matches for browser report regression; test server only. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../apps/server/src/store.ts';
import { GameService } from '../apps/server/src/service.ts';
import { createBotBrain } from '../apps/server/src/ai.ts';
import { botChoices } from '../apps/server/src/bot-choices.ts';
import { aiTools } from '../apps/server/src/ai-tools.ts';
import { observe, labelActions, validator } from '../apps/server/src/ai-observe.ts';
import {
  applyAction,
  actingPlayerId,
  endMatch,
  log,
  viewFor,
} from '../packages/engine/src/index.ts';
import { botDecision } from '../packages/engine/src/bot.ts';
if (process.env.NODE_ENV !== 'test' || !process.env.DATA_DIR?.startsWith('artifacts/'))
  throw Error('Only seed an isolated browser test database');
const store = new Store(`${process.env.DATA_DIR}/monopoly.sqlite`);
const service = new GameService(store);
const fixture = service.create({ name: '旅行家' });
service.connected(fixture.code, fixture.seatId);
service.lobby(fixture.code, fixture.seatId, {
  type: 'settings',
  settings: { ...service.record(fixture.code).settings, maxPlayers: 6, rounds: 16 },
});
for (let i = 0; i < 5; i++)
  service.lobby(fixture.code, fixture.seatId, { type: 'addBot', botMode: 'rule' });
service.lobby(fixture.code, fixture.seatId, { type: 'start' });
let record = service.record(fixture.code),
  g = record.game!;
let seed = 71,
  now = Date.now() - 18 * 60000;
const randomInt = (max: number) => {
  seed = (seed * 16807) % 2147483647;
  return seed % max;
};
g.startedAt = now;
g.endsAt = now + 90 * 60000;
for (let i = 0; i < 1000 && g.phase !== 'finished'; i++) {
  const id = g.trade?.to ?? actingPlayerId(g)!;
  g = applyAction(g, id, botDecision(g, id, 'hard')!.action, { now: (now += 2200), randomInt });
  if (g.round >= 10) break;
}
// A native tool loop supplies an actual curated trace, with deterministic provider responses.
const actor = g.trade?.to ?? actingPlayerId(g)!;
const choices = botChoices(g, actor),
  fallback = botDecision(g, actor, 'hard')!;
let replies = 0;
const brain = createBotBrain(
  {
    baseUrl: 'http://fixture.invalid',
    key: 'fixture',
    model: 'browser-fixture',
    mode: 'chat',
    timeoutMs: 2000,
  },
  async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: `c${++replies}`,
                  function: {
                    name: replies === 1 ? 'state' : 'act',
                    arguments:
                      replies === 1 ? '{}' : '{"choice":"a1","reason":"根据全场资产保持经营节奏"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    ),
);
const decision = await brain.choose(
  viewFor(g, actor),
  choices,
  fallback.action,
  new AbortController().signal,
  {
    level: 'hard',
    tools: aiTools(g, actor, choices),
    observation: observe(g, actor),
    labels: labelActions(g, actor, choices),
    validate: validator(g, actor, () => now),
  },
);
g = applyAction(g, actor, decision.action, { now, randomInt });
log(g, { now, randomInt }, 'ai', 'AI 决策已完成', actor, undefined, undefined, {
  detail: 'LLM · 浏览器固定样例',
  aiTrace: decision.trace,
});
// Keep one running room for inspector/keyboard checks.
record.game = g;
for (const seat of record.seats) {
  seat.bot = false;
  seat.connected = false;
  seat.disconnectedAt = null;
}
store.save(record);
const done = service.create({ name: '旅行家' });
const finished = service.record(done.code);
finished.seats = record.seats.map((seat) => ({
  ...seat,
  id: seat.id === fixture.seatId ? done.seatId : seat.id,
}));
finished.hostId = done.seatId;
finished.seats[0].tokenHash = service.record(done.code).seats[0].tokenHash;
// Keep the new host's recovery hash while reusing the match roster.
finished.game = endMatch(g, '精彩旅程，圆满落幕', { now: now + 2000, randomInt });
finished.game.players[0].id = done.seatId;
for (const event of finished.game.events)
  if (event.actor === fixture.seatId) event.actor = done.seatId;
finished.game.winners = finished.game.winners.map((id) =>
  id === fixture.seatId ? done.seatId : id,
);
for (const prop of finished.game.properties)
  if (prop.owner === fixture.seatId) prop.owner = done.seatId;
for (const sample of finished.game.history ?? [])
  for (const p of sample.players) if (p.id === fixture.seatId) p.id = done.seatId;
finished.settings = finished.game.settings;
store.save(finished);
mkdirSync('artifacts', { recursive: true });
store.remove(fixture.code);
writeFileSync('artifacts/ui-fixtures.json', JSON.stringify({ finished: done }));
service.dispose();
store.close();
