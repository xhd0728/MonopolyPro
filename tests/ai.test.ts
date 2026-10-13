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
import { aiTools } from '../apps/server/src/ai-tools.ts';
import { labelActions, observe, validator } from '../apps/server/src/ai-observe.ts';
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
/** A chat-completions reply carrying one native tool call. */
const toolReply = (name: string, args: object) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: `call_${name}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }),
  );
const hooksFor = (
  game: any,
  seatId: string,
  choices: any[],
  level: 'easy' | 'normal' | 'hard' = 'normal',
) => ({
  tools: aiTools(game, seatId, choices),
  level,
  observation: observe(game, seatId),
  labels: labelActions(game, seatId, choices),
  validate: validator(game, seatId, 1000),
});
test('native tool calls in all three wire formats, with a compact observation and no secrets', async () => {
  const { store, service, c, bot } = fixture();
  const game = service.record(c.code).game!,
    view = viewFor(game, bot.id),
    choices = botChoices(game, bot.id);
  const replies = {
    chat: () => toolReply('act', { choice: 'a1', reason: '直接出发' }),
    responses: () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'function_call',
              call_id: 'c1',
              name: 'act',
              arguments: '{"choice":"a1","reason":"直接出发"}',
            },
          ],
        }),
      ),
    anthropic: () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'act',
              input: { choice: 'a1', reason: '直接出发' },
            },
          ],
        }),
      ),
  };
  for (const mode of ['chat', 'responses', 'anthropic'] as const) {
    let wire: any;
    const brain = createBotBrain(
      { ...config, mode, disableThinking: true, reasoningEffort: 'none' },
      async (_url, init) => {
        wire = JSON.parse(init!.body as string);
        assert.equal(JSON.stringify(wire).includes('test-secret'), false);
        return replies[mode]();
      },
    );
    const result = await brain.choose(
      view,
      choices,
      choices[0],
      new AbortController().signal,
      hooksFor(game, bot.id, choices, 'easy'),
    );
    assert.equal(result.source, 'llm', mode);
    assert.deepEqual(result.action, choices[0]);
    assert.equal(result.reason, '直接出发');
    // The act tool is declared natively and forced (an easy bot reads nothing first).
    const tools =
      mode === 'chat'
        ? wire.tools.map((t: any) => t.function.name)
        : wire.tools.map((t: any) => t.name);
    assert.deepEqual(tools, ['act']);
    if (mode === 'chat')
      assert.deepEqual(wire.tool_choice, { type: 'function', function: { name: 'act' } });
    const text =
      mode === 'responses'
        ? wire.input[1].content
        : mode === 'anthropic'
          ? wire.messages[0].content
          : wire.messages[1].content;
    const observed = JSON.parse(text.slice(text.indexOf('{'), text.indexOf('\n候选动作')));
    // Other seats are summarised: a card count, never the cards themselves.
    assert.equal(typeof observed.others[0].cards, 'number');
    assert.match(text, /a1: /);
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

test('agentic loop: lookups, a rejected custom action fed back with the reason, then a correction', async () => {
  const { store, service, c, bot } = fixture();
  const game = service.record(c.code).game!;
  const choices = botChoices(game, bot.id);
  const sent: any[] = [];
  const replies = [
    () => toolReply('look_ahead', {}),
    // A bid outside an auction: the engine refuses it and says why.
    () => toolReply('act', { custom: { type: 'bid', amount: 50 }, reason: '先抢一口' }),
    () => toolReply('act', { choice: 'a1', reason: '改为直接出发' }),
  ];
  const labels: string[] = [];
  const brain = createBotBrain(config, async (_url, init) => {
    sent.push(JSON.parse(init!.body as string));
    return replies[sent.length - 1]();
  });
  const result = await brain.choose(
    viewFor(game, bot.id),
    choices,
    choices[0],
    new AbortController().signal,
    {
      ...hooksFor(game, bot.id, choices, 'normal'),
      onStep: (label) => labels.push(label),
    },
  );
  assert.equal(result.source, 'llm');
  assert.deepEqual(result.action, choices[0]);
  assert.equal(result.reason, '改为直接出发');
  assert.match(result.message, /自我纠正 1 次/);
  assert.deepEqual(result.steps, labels);
  assert.match(labels[0], /前方/);
  assert.equal(sent.length, 3);
  // Tool results go back as role "tool" messages tied to the call id.
  const feedback = sent[2].messages.at(-1);
  assert.equal(feedback.role, 'tool');
  assert.equal(feedback.tool_call_id, 'call_act');
  assert.match(feedback.content, /不合法/);
  store.close();
});
test('custom trade offers, turn plans, salvaged text calls and the JSON fallback protocol', async () => {
  const { store, service, c, bot } = fixture();
  const record = service.record(c.code);
  const g = record.game!;
  g.phase = 'manage';
  g.properties.find((x) => x.tile === 4)!.owner = c.seatId;
  store.save(record);
  const game = service.record(c.code).game!;
  const choices = botChoices(game, bot.id);
  const end = `a${choices.findIndex((x) => x.type === 'end') + 1}`;
  const offer = {
    type: 'tradeOffer',
    to: c.seatId,
    giveCash: 240,
    wantCash: 0,
    giveTiles: [],
    wantTiles: [4],
  };
  // A free-form trade, with "end the turn" planned right after.
  let brain = createBotBrain(config, async () =>
    toolReply('act', { custom: offer, reason: '收购最后一块', then: [end] }),
  );
  let result = await brain.choose(
    viewFor(game, bot.id),
    choices,
    choices[0],
    new AbortController().signal,
    hooksFor(game, bot.id, choices, 'hard'),
  );
  assert.equal(result.source, 'llm');
  assert.deepEqual(result.action, offer);
  assert.deepEqual(result.plan, [{ type: 'end' }]);
  // Easy bots may only pick listed candidates.
  result = await brain.choose(
    viewFor(game, bot.id),
    choices,
    choices[0],
    new AbortController().signal,
    hooksFor(game, bot.id, choices, 'easy'),
  );
  assert.equal(result.source, 'rule');
  // A tool call that leaked into plain text as a Hermes block is still understood.
  brain = createBotBrain(
    config,
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `<tool_call>{"name":"act","arguments":{"choice":"${end}","reason":"收工"}}</tool_call>`,
              },
            },
          ],
        }),
      ),
  );
  result = await brain.choose(
    viewFor(game, bot.id),
    choices,
    choices[0],
    new AbortController().signal,
    hooksFor(game, bot.id, choices),
  );
  assert.equal(result.source, 'llm');
  assert.deepEqual(result.action, { type: 'end' });
  // An endpoint that rejects tool definitions is switched to the JSON protocol for good.
  const bodies: any[] = [];
  brain = createBotBrain(config, async (_u, init) => {
    const body = JSON.parse(init!.body as string);
    bodies.push(body);
    if (body.tools) return new Response('{"error":"tools are not supported"}', { status: 400 });
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: `{"tool":"act","args":{"choice":"${end}","reason":"收工"}}` } },
        ],
      }),
    );
  });
  for (let i = 0; i < 2; i++) {
    result = await brain.choose(
      viewFor(game, bot.id),
      choices,
      choices[0],
      new AbortController().signal,
      hooksFor(game, bot.id, choices),
    );
    assert.equal(result.source, 'llm');
  }
  assert.equal(bodies.filter((b) => b.tools).length, 1, 'tools are tried once, then dropped');
  assert.equal(bodies.at(-1).response_format.type, 'json_object');
  store.close();
});
test('agentic loop safety: previews refuse random moves, reasons never name held cards, transient errors retry', async () => {
  const { store, service, c, bot } = fixture();
  const record = service.record(c.code);
  record.game!.players[1].cards = ['remote', 'bonus'];
  store.save(record);
  const game = service.record(c.code).game!;
  const choices = botChoices(game, bot.id);
  const tools = aiTools(game, bot.id, choices);
  const roll = choices.findIndex((a) => a.type === 'roll');
  assert.ok(roll >= 0);
  assert.match(JSON.stringify(tools.preview.run({ choice: roll })), /随机/);
  const bonus = choices.findIndex((a) => a.type === 'playCard' && a.cardId === 'bonus');
  assert.ok(bonus >= 0);
  assert.equal(typeof (tools.preview.run({ choice: bonus }) as any).cash, 'number');
  // A reason that reveals another card still in hand is dropped.
  let brain = createBotBrain(config, async () =>
    toolReply('act', { choice: `a${bonus + 1}`, reason: '留着遥控骰子下回合用' }),
  );
  const secret = await brain.choose(
    viewFor(game, bot.id),
    choices,
    choices[0],
    new AbortController().signal,
    hooksFor(game, bot.id, choices),
  );
  assert.equal(secret.source, 'llm');
  assert.equal(secret.reason, undefined);
  // One 503 is retried; a provider that keeps failing hands over to the rule bot.
  let calls = 0;
  brain = createBotBrain(config, async () =>
    ++calls === 1
      ? new Response('{}', { status: 503 })
      : toolReply('act', { choice: 'a1', reason: '出发' }),
  );
  const retried = await brain.choose(
    viewFor(game, bot.id),
    choices,
    choices[0],
    new AbortController().signal,
    hooksFor(game, bot.id, choices),
  );
  assert.equal(retried.source, 'llm');
  assert.equal(calls, 2);
  calls = 0;
  brain = createBotBrain(config, async () => (calls++, new Response('{}', { status: 500 })));
  const failed = await brain.choose(
    viewFor(game, bot.id),
    choices,
    choices[0],
    new AbortController().signal,
    hooksFor(game, bot.id, choices),
  );
  assert.equal(failed.source, 'rule');
  assert.equal(calls, 2, 'exactly one retry');
  store.close();
});
test('rule bots explain notable moves in the shared log', () => {
  const store = new Store(':memory:');
  const service = new GameService(store, { now: () => 1000 });
  const c = service.create({ name: '真人' });
  service.connected(c.code, c.seatId);
  service.lobby(c.code, c.seatId, { type: 'addBot', botMode: 'rule' });
  service.lobby(c.code, c.seatId, { type: 'ready' });
  service.lobby(c.code, c.seatId, { type: 'start' });
  const record = service.record(c.code);
  const bot = record.seats[1];
  record.game!.turn = 1;
  record.game!.players[1].position = 1;
  record.game!.phase = 'purchase';
  store.save(record);
  service.tick(c.code);
  const events = service.record(c.code).game!.events;
  const last = events.at(-1)!;
  assert.equal(last.kind, 'ai');
  assert.equal(last.actor, bot.id);
  assert.match(last.text, /现金|色组|租金/);
  store.close();
});
test('busy model slots queue the seat instead of handing over at once; planned moves skip a request', async () => {
  let now = 1000;
  const store = new Store(':memory:');
  let calls = 0;
  const hang = () => new Promise<AiDecision>(() => {});
  const service = new GameService(store, {
    now: () => now,
    aiMaxConcurrent: 1,
    brain: {
      model: 'fixture',
      choose: async (_v, choices) => {
        calls++;
        if (calls === 1) return hang();
        const end = choices.find((c) => c.type === 'end');
        return {
          action: choices.find((c) => c.type !== 'end' && c.type !== 'ability') ?? choices[0],
          source: 'llm',
          message: 'ok',
          ...(end ? { plan: [end] } : {}),
        };
      },
    },
  });
  const room = () => {
    const c = service.create({ name: '真人' });
    service.connected(c.code, c.seatId);
    service.lobby(c.code, c.seatId, { type: 'addBot', botMode: 'llm', botLevel: 'hard' });
    service.lobby(c.code, c.seatId, { type: 'start' });
    const r = service.record(c.code);
    r.game!.turn = 1;
    store.save(r);
    return c;
  };
  const a = room(),
    b = room();
  assert.equal(service.record(b.code).seats[1].botLevel, 'hard');
  service.tick(a.code); // takes the only slot and never answers
  service.tick(b.code);
  assert.equal(service.view(b.code, b.seatId).aiActivity?.state, 'queued');
  assert.equal(service.record(b.code).game!.revision, 0, 'waiting, not handed to the rule bot');
  now += 21000;
  service.tick(b.code);
  assert.equal(service.record(b.code).game!.revision, 1, 'after 20 s the rule bot plays');
  assert.match(service.view(b.code, b.seatId).aiActivity!.message, /排队/);
  service.dispose();
  store.close();
  // A planned follow-up is played on the next tick without asking the model again.
  const s2 = new Store(':memory:');
  let asked = 0;
  const svc = new GameService(s2, {
    now: () => 1000,
    brain: {
      model: 'fixture',
      choose: async (_v, choices) => {
        asked++;
        const build = choices.find((c) => c.type === 'build');
        return {
          action: build ?? choices[0],
          source: 'llm',
          message: 'ok',
          plan: [{ type: 'end' }],
        };
      },
    },
  });
  const c = svc.create({ name: '真人' });
  svc.connected(c.code, c.seatId);
  svc.lobby(c.code, c.seatId, { type: 'addBot', botMode: 'llm' });
  svc.lobby(c.code, c.seatId, { type: 'start' });
  const r = svc.record(c.code);
  r.game!.turn = 1;
  r.game!.phase = 'manage';
  r.game!.properties.find((x) => x.tile === 1)!.owner = r.seats[1].id;
  s2.save(r);
  svc.tick(c.code);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(asked, 1);
  const turn = svc.record(c.code).game!.turn;
  svc.tick(c.code);
  assert.equal(asked, 1, 'the plan did not need another request');
  assert.notEqual(svc.record(c.code).game!.turn, turn, 'the planned end of turn was played');
  svc.dispose();
  s2.close();
});
