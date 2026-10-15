/**
 * Bot-only matches for balance and robustness checks: `pnpm exec tsx scripts/simulate.ts [games]`.
 * Every bot decision must be legal; the summary shows how matches end and how cards are used.
 */
import { CHARACTERS, MAPS } from '../packages/content/src/index.ts';
import { DEFAULT_SETTINGS, type Seat } from '../packages/shared/src/index.ts';
import {
  actingPlayerId,
  applyAction,
  assertInvariants,
  assetsOf,
  createGame,
} from '../packages/engine/src/index.ts';
import { botDecision } from '../packages/engine/src/bot.ts';

const games = Number(process.argv[2] ?? 100);
let seed = 7;
const randomInt = (max: number) => {
  seed = (seed * 16807) % 2147483647;
  return seed % max;
};
const seats = (n: number): Seat[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `机器人${i}`,
    characterId: CHARACTERS[(i + seed) % CHARACTERS.length].id,
    team: i % 2,
    bot: true,
    ready: true,
    spectator: false,
    tokenHash: '',
    connected: true,
    disconnectedAt: null,
    controlEpoch: 0,
  }));
const totals = { finished: 0, rounds: 0, bankrupt: 0, cards: 0, illegal: 0, steps: 0, reasons: 0 };
const ends: Record<string, number> = {};
for (let i = 0; i < games; i++) {
  const map = MAPS[i % MAPS.length].id;
  let now = 1000;
  const n = 2 + (i % 5);
  const settings = {
    ...DEFAULT_SETTINGS,
    mapId: map,
    size: (Math.floor(i / MAPS.length) % 2 ? 44 : 36) as 36 | 44,
    auction: Math.floor(i / 5) % 2 === 0,
    mode: ((n === 4 || n === 6) && i % 2 ? 'team' : 'free') as 'team' | 'free',
    end: (['rounds', 'time', 'target'] as const)[i % 3],
    rounds: 8 + (i % 9),
    minutes: 5,
    target: 6000 + (i % 4) * 2000,
    initialCash: [1500, 3000, 5000][Math.floor(i / 3) % 3],
  };
  let g = createGame(settings, seats(n), `sim${i}`, { now, randomInt });
  for (let step = 0; step < 20000 && g.phase !== 'finished'; step++) {
    const actor = g.trade?.to ?? actingPlayerId(g)!;
    const d = botDecision(g, actor)!;
    if (d.reason) totals.reasons++;
    try {
      g = applyAction(g, actor, d.action, { now: (now += 700), randomInt });
    } catch (error) {
      totals.illegal++;
      if (totals.illegal < 5) console.error('illegal', d.action, (error as Error).message);
      g = applyAction(
        g,
        actor,
        { type: g.phase === 'manage' ? 'end' : 'roll' },
        { now, randomInt },
      );
    }
    assertInvariants(g);
    totals.steps++;
  }
  if (g.phase === 'finished') {
    totals.finished++;
    const final = g.history?.at(-1);
    if (
      !final ||
      final.players.some(
        (p) =>
          p.assets !==
          assetsOf(
            g,
            g.players.find((x) => x.id === p.id)!,
          ),
      )
    )
      throw Error('Final financial snapshot mismatch');
  }
  totals.rounds += g.round;
  totals.bankrupt += g.players.filter((p) => p.bankrupt).length;
  totals.cards += g.players.reduce((n, p) => n + p.stats.cards, 0);
  const why = g.finishReason.replace(/[0-9,，].*$/, '').slice(0, 12);
  ends[why] = (ends[why] ?? 0) + 1;
}
console.log({
  games,
  coverage: '4 maps, 36/44 squares, 2-6 seats, auctions, teams, rounds/time/target',
  finished: totals.finished,
  avgRounds: +(totals.rounds / games).toFixed(1),
  bankruptPerGame: +(totals.bankrupt / games).toFixed(2),
  cardsPerGame: +(totals.cards / games).toFixed(1),
  illegalDecisions: totals.illegal,
  explainedDecisions: `${Math.round((totals.reasons / totals.steps) * 100)}%`,
  ends,
});
