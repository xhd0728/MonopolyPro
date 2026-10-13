/**
 * Bot strength check: `pnpm exec tsx scripts/levels.ts` (LV=easy,normal,hard N=300 SEED=3).
 * Seats rotate between levels every match; prints win rate and average net worth per level.
 */
import { CHARACTERS, MAPS } from '../packages/content/src/index.ts';
import { DEFAULT_SETTINGS, type BotLevel, type Seat } from '../packages/shared/src/index.ts';
import { actingPlayerId, applyAction, assetsOf, createGame } from '../packages/engine/src/index.ts';
import { botAction } from '../packages/engine/src/bot.ts';
let seed = Number(process.env.SEED ?? 3);
const randomInt = (m: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % m);
const levels: BotLevel[] = (process.env.LV ?? 'easy,normal,hard,normal').split(',') as BotLevel[];
const wins: Record<string, number> = {},
  worth: Record<string, number> = {},
  n: Record<string, number> = {};
let illegal = 0;
const G = Number(process.env.N ?? 200);
for (let i = 0; i < G; i++) {
  const order = levels.map((_, k) => levels[(k + i) % levels.length]);
  const seats: Seat[] = order.map((_, k) => ({
    id: `p${k}`,
    name: `b${k}`,
    characterId: CHARACTERS[(i * 7 + k) % 6].id,
    team: k % 2,
    bot: true,
    ready: true,
    spectator: false,
    tokenHash: '',
    connected: true,
    disconnectedAt: null,
    controlEpoch: 0,
  }));
  let now = 1000;
  let g = createGame({ ...DEFAULT_SETTINGS, mapId: MAPS[i % MAPS.length].id }, seats, 'l' + i, {
    now,
    randomInt,
  });
  for (let s = 0; s < 20000 && g.phase !== 'finished'; s++) {
    const a = g.trade?.to ?? actingPlayerId(g)!;
    const lv = order[Number(a.slice(1))];
    try {
      g = applyAction(g, a, botAction(g, a, lv)!, { now: (now += 700), randomInt });
    } catch {
      illegal++;
      g = applyAction(g, a, botAction(g, a, 'normal')!, { now, randomInt });
    }
  }
  g.players.forEach((p, k) => {
    const lv = order[k];
    n[lv] = (n[lv] ?? 0) + 1;
    worth[lv] = (worth[lv] ?? 0) + assetsOf(g, p);
    if (g.winners.includes(p.id)) wins[lv] = (wins[lv] ?? 0) + 1;
  });
}
const out: Record<string, string> = {};
for (const lv of Object.keys(n))
  out[lv] =
    `win ${((100 * (wins[lv] ?? 0)) / n[lv]).toFixed(1)}% worth ${Math.round(worth[lv] / n[lv])}`;
console.log(JSON.stringify({ levels, illegal, out }));
