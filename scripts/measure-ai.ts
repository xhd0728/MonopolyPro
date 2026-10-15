/** Bounded real-provider harness audit. Writes public-only evidence to ignored artifacts/. */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createBotBrain, readAiConfig } from '../apps/server/src/ai.ts';
import { botChoices } from '../apps/server/src/bot-choices.ts';
import { aiTools } from '../apps/server/src/ai-tools.ts';
import { observe, labelActions, validator } from '../apps/server/src/ai-observe.ts';
import {
  createGame,
  applyAction,
  actingPlayerId,
  viewFor,
  assertInvariants,
} from '../packages/engine/src/index.ts';
import { botDecision } from '../packages/engine/src/bot.ts';
import { DEFAULT_SETTINGS, type AiTraceStep, type Seat } from '../packages/shared/src/index.ts';
if (existsSync('.env')) process.loadEnvFile('.env');
const config = readAiConfig(process.env);
if (!config) throw Error('Server AI is not configured');
const brain = createBotBrain(config);
const count = Math.max(1, Math.min(100, Number(process.argv[2] ?? 24)));
const seats: Seat[] = Array.from({ length: 4 }, (_, i) => ({
  id: `p${i}`,
  name: `AI ${i + 1}`,
  characterId: ['builder', 'landlord', 'runner', 'guardian'][i],
  team: i % 2,
  bot: true,
  ready: true,
  spectator: false,
  tokenHash: '',
  connected: true,
  disconnectedAt: null,
  controlEpoch: 0,
}));
let seed = 37;
const randomInt = (max: number) => {
  seed = (seed * 16807) % 2147483647;
  return seed % max;
};
let g = createGame(
  { ...DEFAULT_SETTINGS, rounds: 16, size: 44, mapId: 'neon' },
  seats,
  'measurement',
  { now: Date.now(), randomInt },
);
// Exercise developed portfolios instead of only an empty opening board.
for (let i = 0; i < 180 && g.phase !== 'finished'; i++) {
  const id = g.trade?.to ?? actingPlayerId(g)!;
  g = applyAction(g, id, botDecision(g, id, 'hard')!.action, { now: Date.now(), randomInt });
}
const records: {
  round: number;
  phase: string;
  source: string;
  elapsed: number;
  action: string;
  trace: AiTraceStep[];
}[] = [];
for (let i = 0; records.length < count && i < count * 8 && g.phase !== 'finished'; i++) {
  const id = g.trade?.to ?? actingPlayerId(g)!;
  const fallback = botDecision(g, id, 'hard')!,
    choices = botChoices(g, id);
  if (!choices.some((c) => JSON.stringify(c) === JSON.stringify(fallback.action)))
    choices.unshift(fallback.action);
  if (choices.length < 2) {
    g = applyAction(g, id, fallback.action, { now: Date.now(), randomInt });
    continue;
  }
  const start = Date.now();
  const decision = await brain.choose(
    viewFor(g, id),
    choices,
    fallback.action,
    new AbortController().signal,
    {
      level: 'hard',
      tools: aiTools(g, id, choices),
      observation: observe(g, id),
      labels: labelActions(g, id, choices),
      validate: validator(g, id, Date.now),
      fallbackReason: fallback.reason,
    },
  );
  records.push({
    round: g.round,
    phase: g.phase,
    source: decision.source,
    elapsed: Date.now() - start,
    action: decision.action.type,
    trace: decision.trace ?? [],
  });
  g = applyAction(g, id, decision.action, { now: Date.now(), randomInt });
  assertInvariants(g);
  console.log(
    JSON.stringify({
      decision: records.length,
      source: decision.source,
      ms: Date.now() - start,
      phase: records.at(-1)!.phase,
    }),
  );
}
const latencies = records.map((r) => r.elapsed).sort((a, b) => a - b);
const summary = {
  model: config.model,
  decisions: records.length,
  llm: records.filter((r) => r.source === 'llm').length,
  fallback: records.filter((r) => r.source === 'rule').length,
  p50: latencies[Math.floor(latencies.length * 0.5)],
  p90: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.9))],
  tools: records.flatMap((r) => r.trace.filter((s) => s.kind === 'tool').map((s) => s.tool)),
  failures: records.flatMap((r) => r.trace.filter((s) => s.kind === 'fallback').map((s) => s.text)),
};
mkdirSync('artifacts/ai-review', { recursive: true });
writeFileSync(
  'artifacts/ai-review/measurement.json',
  JSON.stringify({ summary, records }, null, 2),
);
console.log(JSON.stringify(summary));
