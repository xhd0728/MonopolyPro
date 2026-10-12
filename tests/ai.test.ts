import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBotBrain,
  readAiConfig,
  type AiDecision,
  type BotBrain,
} from '../apps/server/src/ai.ts';
import { GameService } from '../apps/server/src/service.ts';
import { Store } from '../apps/server/src/store.ts';
import { botChoices } from '../apps/server/src/bot-choices.ts';
import { viewFor, applyAction } from '../packages/engine/src/index.ts';
const config = {
  baseUrl: 'http://provider.invalid/v1',
  key: 'test-secret',
  model: 'fixture',
  mode: 'chat' as const,
  timeoutMs: 1000,
};
function fixture(choose?: BotBrain['choose'], aiDecisionCapMs?: number) {
  const store = new Store(':memory:');
  const service = new GameService(store, {
    now: () => 1000,
    ...(choose ? { brain: { model: 'fixture', choose } } : {}),
    ...(aiDecisionCapMs ? { aiDecisionCapMs } : {}),
  });
  const c = service.create({ name: '真人' });
  service.connected(c.code, c.seatId);
  service.lobby(c.code, c.seatId, { type: 'addBot' });
  service.lobby(c.code, c.seatId, { type: 'ready' });
  service.lobby(c.code, c.seatId, { type: 'start' });
  const record = service.record(c.code);
  record.game!.turn = 1;
  store.save(record);
  return { store, service, c, bot: record.seats[1] };
}
test('LLM protocols use filtered views, a fixed choice index and server-only credentials', async () => {
  const { store, service, c, bot } = fixture();
  const game = service.record(c.code).game!,
    view = viewFor(game, bot.id),
    choices = botChoices(game, bot.id);
  for (const mode of ['chat', 'responses', 'anthropic'] as const) {
    let wire: any;
    const response =
      mode === 'chat'
        ? { choices: [{ message: { content: '{"choice":0}' } }] }
        : mode === 'responses'
          ? {
              output: [
                {
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: '{"choice":0}' }],
                },
              ],
            }
          : { content: [{ type: 'text', text: '{"choice":0}' }] };
    const brain = createBotBrain(
      { ...config, mode, disableThinking: true, reasoningEffort: 'none' },
      async (_url, init) => {
        wire = JSON.parse(init!.body as string);
        if (mode === 'chat') {
          assert.equal(wire.reasoning_effort, 'none');
          assert.equal(wire.enable_thinking, false);
        }
        assert.equal(JSON.stringify(wire).includes('test-secret'), false);
        return new Response(JSON.stringify(response));
      },
    );
    const result = await brain.choose(view, choices, choices[0], new AbortController().signal);
    assert.equal(result.source, 'llm');
    assert.deepEqual(result.action, choices[0]);
    const text =
      mode === 'responses'
        ? wire.input[1].content
        : mode === 'anthropic'
          ? wire.messages[0].content
          : wire.messages[1].content;
    const payload = JSON.parse(text);
    assert.equal(payload.players.find((p: any) => p.id === c.seatId).cards, undefined);
    assert.equal(payload.players.find((p: any) => p.id === c.seatId).nextDice, undefined);
    assert.ok(payload.players.find((p: any) => p.id === bot.id).cards);
  }
  store.close();
});
test('malformed, oversized, rejected or timed-out model output safely falls back', async () => {
  const { store, service, c, bot } = fixture();
  const view = service.view(c.code, bot.id).game!,
    choices = botChoices(service.record(c.code).game!, bot.id);
  for (const request of [
    async () => new Response('{"choices":[{"message":{"content":"{\\\"choice\\\":9999}"}}]}'),
    async () => new Response('x'.repeat(70000)),
    async () => new Response('{}', { status: 429 }),
    async (_u: any, init: any) =>
      new Promise<Response>((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true }),
      ),
  ]) {
    const brain = createBotBrain({ ...config, timeoutMs: 120 }, request as typeof fetch);
    const result = await brain.choose(view, choices, choices[0], new AbortController().signal);
    assert.equal(result.source, 'rule');
    assert.deepEqual(result.action, choices[0]);
  }
  assert.equal(readAiConfig({}), null);
  assert.throws(() => readAiConfig({ MONOPOLY_AI_ENABLED: 'true' }));
  store.close();
});
test('async AI cannot commit a stale decision after another action or shutdown', async () => {
  let resolve!: (decision: AiDecision) => void,
    proposals: any[] = [];
  const { store, service, c, bot } = fixture((_v: any, choices: any[]) => {
    proposals = choices;
    return new Promise<AiDecision>((r) => {
      resolve = r;
    });
  });
  service.tick(c.code);
  assert.equal(service.view(c.code, c.seatId).aiActivity?.state, 'thinking');
  assert.equal(service.record(c.code).game!.revision, 0);
  const record = service.record(c.code);
  record.game = applyAction(record.game!, bot.id, { type: 'ability' }, service.env());
  store.save(record);
  resolve({ action: proposals[0], source: 'llm', message: 'done' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(service.record(c.code).game!.revision, 1);
  service.tick(c.code);
  service.dispose();
  store.close();
  resolve({ action: proposals[0], source: 'llm', message: 'after shutdown' });
  await new Promise((r) => setTimeout(r, 0));
});
test('AI applies legal actions transactionally, persists events, and reports fallback', async () => {
  const { store, service, c } = fixture(async (_v: any, choices: any[]) => ({
    action: choices[0],
    source: 'rule',
    message: '模型超时，规则机器人继续',
  }));
  service.tick(c.code);
  await new Promise((r) => setTimeout(r, 0));
  const record = service.record(c.code);
  assert.equal(record.game!.revision, 1);
  assert.equal(record.game!.events.at(-1)?.kind, 'ai');
  assert.equal(service.view(c.code, c.seatId).aiActivity?.state, 'fallback');
  assert.equal(JSON.stringify(service.view(c.code, c.seatId)).includes('test-secret'), false);
  service.dispose();
  store.close();
});

test('an AI seat that never answers is cut off at the cap and the rule bot plays', async () => {
  // A provider that hangs until aborted, like a stalled network request.
  const hang = (_v: unknown, _c: unknown, _f: unknown, signal: AbortSignal) =>
    new Promise<AiDecision>((_r, reject) =>
      signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }),
    );
  const { store, service, c } = fixture(hang as BotBrain['choose'], 30);
  service.tick(c.code);
  assert.equal(service.view(c.code, c.seatId).aiActivity?.state, 'thinking');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(service.record(c.code).game!.revision, 1, 'the rule fallback was applied');
  assert.match(service.view(c.code, c.seatId).aiActivity!.message, /两分钟/);
  service.dispose();
  store.close();
});
