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
import { mapById } from '../packages/content/src/index.ts';
import { viewFor, applyAction, createGame, exitsFor, log } from '../packages/engine/src/index.ts';
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
  validate: validator(game, seatId, () => 1000),
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
test('review fixes: one self-written offer per round, lopsided AI offers are vetoed', async () => {
  const store = new Store(':memory:');
  let offer: any = null;
  const service = new GameService(store, {
    now: () => 1000,
    brain: {
      model: 'fixture',
      choose: async (_v, choices) => ({
        action: offer ?? choices[0],
        source: 'llm',
        message: 'ok',
      }),
    },
  });
  const c = service.create({ name: '真人' });
  service.connected(c.code, c.seatId);
  service.lobby(c.code, c.seatId, { type: 'addBot', botMode: 'llm' });
  service.lobby(c.code, c.seatId, { type: 'start' });
  const r = service.record(c.code);
  const bot = r.seats[1].id;
  r.game!.turn = 1;
  r.game!.phase = 'manage';
  r.game!.properties.find((x) => x.tile === 4)!.owner = c.seatId;
  r.game!.players[1].cash = 5000;
  store.save(r);
  const game = service.record(c.code).game!;
  const check = validator(game, bot, () => 1000);
  const fair: any = {
    type: 'tradeOffer',
    to: c.seatId,
    giveCash: 240,
    wantCash: 0,
    giveTiles: [],
    wantTiles: [4],
  };
  assert.equal(check(fair, true), null);
  const after = applyAction(game, bot, fair, { now: 1000, randomInt: () => 0 });
  after.trade = null;
  assert.match(validator(after, bot, () => 1000)(fair, true)!, /本轮你已经发起过交易/);
  // A model that pays 480 for a 240 square is overruled by the rule bot.
  offer = { ...fair, giveCash: 480 };
  service.tick(c.code);
  await new Promise((done) => setTimeout(done, 0));
  const latest = service.record(c.code).game!;
  assert.equal(latest.trade, null, 'the lopsided offer was not sent');
  assert.ok(latest.events.some((e) => e.kind === 'ai' && e.detail?.startsWith('规则')));
  service.dispose();
  store.close();
});

test('truncated thinking gets a larger final-call budget; public trace never contains raw reasoning', async () => {
  const { store, service, c, bot } = fixture();
  const game = service.record(c.code).game!,
    choices = botChoices(game, bot.id);
  const wires: any[] = [],
    streamed: any[] = [];
  const brain = createBotBrain(config, async (_url, init) => {
    wires.push(JSON.parse(init!.body as string));
    if (wires.length === 1)
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'length',
              message: {
                content: 'a1 PRIVATE_REASONING is still being considered',
                reasoning_content: 'SECRET_REASONING',
              },
            },
          ],
        }),
      );
    return toolReply('act', { choice: 'a1', reason: '出发探索' });
  });
  const result = await brain.choose(
    viewFor(game, bot.id),
    choices,
    choices[0],
    new AbortController().signal,
    { ...hooksFor(game, bot.id, choices), onTrace: (trace) => streamed.push(trace) },
  );
  assert.equal(result.source, 'llm');
  assert.equal(wires.length, 2);
  assert.ok(wires[1].max_tokens > wires[0].max_tokens);
  assert.deepEqual(
    wires[1].tools.map((t: any) => t.function.name),
    ['act'],
  );
  assert.ok(result.trace?.some((s) => s.kind === 'retry'));
  assert.equal(result.trace?.at(-1)?.kind, 'decision');
  assert.ok(streamed.length >= 2);
  assert.ok(
    streamed.every((trace) => trace.every((step: any) => step.kind !== 'decision')),
    'uncommitted final choices are not broadcast',
  );
  assert.doesNotMatch(JSON.stringify(result.trace), /PRIVATE_REASONING|SECRET_REASONING|a99/);
  store.close();
});

test('multiple native reads and act in one reply do not discard the valid decision', async () => {
  const { store, service, c, bot } = fixture();
  const game = service.record(c.code).game!,
    choices = botChoices(game, bot.id);
  const brain = createBotBrain(
    config,
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'PRIVATE_BODY',
                tool_calls: [
                  { id: 's', function: { name: 'state', arguments: '{}' } },
                  {
                    id: 'a',
                    function: { name: 'act', arguments: '{"choice":"a1","reason":"出发"}' },
                  },
                ],
              },
            },
          ],
        }),
      ),
  );
  const result = await brain.choose(
    viewFor(game, bot.id),
    choices,
    choices[0],
    new AbortController().signal,
    hooksFor(game, bot.id, choices),
  );
  assert.equal(result.source, 'llm');
  assert.equal(result.trace?.filter((s) => s.kind === 'tool').length, 1);
  assert.doesNotMatch(JSON.stringify(result.trace), /PRIVATE_BODY|hand|nextDice|lockedCards/);
  store.close();
});

test('Responses preserves encrypted reasoning between tool calls without publishing it', async () => {
  const { store, service, c, bot } = fixture();
  const game = service.record(c.code).game!,
    choices = botChoices(game, bot.id);
  let count = 0,
    second: any;
  const reasoning = {
    type: 'reasoning',
    id: 'rs_1',
    summary: [],
    encrypted_content: 'ENCRYPTED_PRIVATE_STATE',
  };
  const brain = createBotBrain({ ...config, mode: 'responses' }, async (_url, init) => {
    const wire = JSON.parse(init!.body as string);
    assert.deepEqual(wire.include, ['reasoning.encrypted_content']);
    if (++count === 1)
      return new Response(
        JSON.stringify({
          output: [
            reasoning,
            { type: 'function_call', call_id: 'c1', name: 'square', arguments: '{"index":1}' },
          ],
        }),
      );
    second = wire;
    return new Response(
      JSON.stringify({
        output: [
          {
            type: 'function_call',
            call_id: 'c2',
            name: 'act',
            arguments: '{"choice":"a1","reason":"出发"}',
          },
        ],
      }),
    );
  });
  const result = await brain.choose(
    viewFor(game, bot.id),
    choices,
    choices[0],
    new AbortController().signal,
    hooksFor(game, bot.id, choices),
  );
  assert.equal(result.source, 'llm');
  assert.ok(
    second.input.some((item: any) => item.encrypted_content === reasoning.encrypted_content),
  );
  assert.doesNotMatch(JSON.stringify(result.trace), /ENCRYPTED_PRIVATE_STATE/);
  store.close();
});

test('tools agree on candidate ids, enumerate forks, and hide private preview details', () => {
  const { store, service, c, bot } = fixture();
  const game = service.record(c.code).game!;
  game.settings.mapId = 'neon';
  const map = mapById('neon');
  // Recreate for this board rather than reusing another map's property list.
  const g = createGame(game.settings, service.record(c.code).seats, 'forks', {
    now: 1000,
    randomInt: () => 0,
  });
  const fork = map.tiles.find((t) => exitsFor(g, t.index).length > 1)!;
  assert.ok(fork);
  g.turn = 1;
  const me = g.players.find((p) => p.id === bot.id)!;
  me.position = fork.index;
  me.characterId = 'builder';
  const choices = botChoices(g, bot.id),
    tools = aiTools(g, bot.id, choices);
  const risk = tools.look_ahead.run({}) as any[];
  assert.deepEqual(
    risk[0].outcomes.map((x: any) => x.index).sort(),
    [...exitsFor(g, fork.index)].sort(),
  );
  const advice = tools.advice.run({}) as any;
  assert.match(advice.choice, /^a\d+$/);
  assert.deepEqual(choices[Number(advice.choice.slice(1)) - 1], advice.action);
  assert.doesNotMatch(JSON.stringify(tools.preview.publicFacts!({}, {})), /cardId|遥控骰子/);
  assert.equal(observe(g, bot.id).activeId, bot.id);
  store.close();
});

test('queue admission is fair when a previous room immediately requests again', async () => {
  const store = new Store(':memory:');
  const pending: { resolve: (d: AiDecision) => void; choices: any[] }[] = [];
  const service = new GameService(store, {
    now: () => 1000,
    aiMaxConcurrent: 1,
    brain: {
      model: 'fixture',
      choose: (_v, choices) => new Promise((resolve) => pending.push({ resolve, choices })),
    },
  });
  const make = () => {
    const c = service.create({ name: '玩家' });
    service.connected(c.code, c.seatId);
    service.lobby(c.code, c.seatId, { type: 'addBot', botMode: 'llm' });
    service.lobby(c.code, c.seatId, { type: 'start' });
    const r = service.record(c.code);
    r.game!.turn = 1;
    store.save(r);
    return c;
  };
  const a = make(),
    b = make();
  service.tick(a.code);
  service.tick(b.code);
  pending[0].resolve({
    source: 'llm',
    action: pending[0].choices.find((x) => x.type === 'ability')!,
    message: 'ok',
  });
  await new Promise((r) => setTimeout(r, 0));
  service.tick(a.code);
  assert.equal(service.view(a.code, a.seatId).aiActivity?.state, 'queued');
  service.tick(b.code);
  assert.equal(service.view(b.code, b.seatId).aiActivity?.state, 'thinking');
  assert.equal(pending.length, 2);
  service.dispose();
  store.close();
});

test('durable trajectory pagination requires room credentials and survives rolling event removal', () => {
  const { store, service, c, bot } = fixture();
  const record = service.record(c.code),
    game = record.game!;
  const env = service.env();
  for (let i = 0; i < 38; i++)
    log(game, env, 'ai', '公开决定', bot.id, undefined, undefined, {
      aiTrace: [{ kind: 'decision', title: '测试决定', text: '公开摘要', ms: i }],
    });
  store.save(record);
  for (let i = 0; i < 160; i++) log(game, env, 'test', '其他事件');
  store.save(record);
  assert.equal(game.events.filter((e) => e.aiTrace).length, 0);
  assert.throws(
    () => service.aiTraces(c.code, { token: 'x'.repeat(40), gameId: game.id }),
    /无法恢复/,
  );
  assert.throws(() => service.aiTraces(c.code, { token: c.token, gameId: 'other' }), /对局已更新/);
  const first = service.aiTraces(c.code, { token: c.token, gameId: game.id });
  assert.equal(first.events.length, 24);
  assert.ok(first.before);
  const next = service.aiTraces(c.code, { token: c.token, gameId: game.id, before: first.before });
  assert.equal(next.events.length, 14);
  assert.equal(next.before, null);
  assert.equal(new Set([...first.events, ...next.events].map((e) => e.id)).size, 38);
  assert.doesNotMatch(JSON.stringify(first), /tokenHash|newCards|nextDice|test-secret/);
  service.dispose();
  store.close();
});

test('failed persistence cannot activate an uncommitted model turn plan', async () => {
  let asked = 0;
  const { store, service, c } = fixture(async (_view, choices) => {
    asked++;
    return {
      source: 'llm',
      action: choices.find((a) => a.type === 'ability')!,
      plan: [{ type: 'end' }],
      message: 'ok',
    };
  });
  const record = service.record(c.code);
  record.game!.phase = 'manage';
  store.save(record);
  const save = store.save.bind(store);
  let fail = true;
  store.save = (...args) => {
    if (fail) {
      fail = false;
      throw Error('disk unavailable');
    }
    save(...args);
  };
  service.tick(c.code);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(service.record(c.code).game!.revision, 0);
  service.tick(c.code);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked, 2, 'a failed first action must be decided again before any follow-up runs');
  assert.equal(service.record(c.code).game!.revision, 1);
  service.dispose();
  store.close();
});
