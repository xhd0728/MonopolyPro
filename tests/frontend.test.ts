import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createGame, viewFor } from '../packages/engine/src/index.ts';
import { DEFAULT_SETTINGS, type Seat } from '../packages/shared/src/index.ts';
import { BOARD, NEWS, mapById } from '../packages/content/src/index.ts';
import { activityRows, describeActivity } from '../apps/client/src/activity.ts';
import { TradeDialog } from '../apps/client/src/Trade.tsx';
function game() {
  const seats: Seat[] = ['p0', 'p1'].map((id, i) => ({
    id,
    name: `玩家${i}`,
    characterId: 'builder',
    team: i,
    bot: false,
    ready: true,
    spectator: false,
    tokenHash: '',
    connected: true,
    disconnectedAt: null,
    controlEpoch: 0,
  }));
  return createGame(DEFAULT_SETTINGS, seats, 'frontend', { now: 1000, randomInt: () => 0 });
}
test('historical news preserves its actual news and country-specific effect after the round changes', () => {
  const g = game();
  const old = NEWS.find((n) => n.effect === 'groupBoom')!,
    current = NEWS.find((n) => n.effect === 'rateCut')!;
  g.news = { id: current.id, round: g.round };
  const view = viewFor(g, 'p0');
  const e = {
    id: 999,
    at: 1000,
    kind: 'news',
    spot: 'news' as const,
    text: `第 2 轮世界新闻「${old.name}」：中国、日本本轮租金 +50%`,
  };
  const described = describeActivity(e, view, mapById(g.settings.mapId));
  assert.match(described.title!, new RegExp(old.name));
  assert.equal(described.body, '中国、日本本轮租金 +50%');
  const finale = { ...e, kind: 'finale', text: '终局冲刺：租金提高 50%' };
  assert.equal(describeActivity(finale, view, mapById(g.settings.mapId)).body, finale.text);
});
test('important activity keeps AI explanations even when the original dice row is routine', () => {
  const view = viewFor(game(), 'p0');
  view.events = [
    { id: 1, at: 1000, kind: 'dice', actor: 'p0', text: '玩家0掷出 3 点' },
    {
      id: 2,
      at: 1000,
      kind: 'ai',
      actor: 'p0',
      text: '玩家0：保留现金稳健前进',
      aiTrace: [{ kind: 'decision', title: '决定', text: '公开摘要', ms: 0 }],
    },
  ];
  const rows = activityRows(view, mapById(view.settings.mapId), 'key');
  assert.equal(rows.length, 1);
  assert.ok('why' in rows[0] && rows[0].why === '保留现金稳健前进');
  view.events.pop();
  assert.equal(activityRows(view, mapById(view.settings.mapId), 'key').length, 0);
});
test('clients receive the actual bank interest for normal, rate-cut and rate-hike rounds', () => {
  const g = game();
  assert.equal(viewFor(g, 'p0').bankInterestRate, BOARD.interest);
  for (const effect of ['rateCut', 'rateHike'] as const) {
    const news = NEWS.find((n) => n.effect === effect)!;
    g.news = { id: news.id, round: g.round };
    assert.equal(viewFor(g, null).bankInterestRate, effect === 'rateCut' ? 0 : news.amount / 100);
  }
});
test('a trade draft becomes visibly invalid when selected land changes ownership or the partner goes bankrupt', () => {
  const g = game();
  g.properties[0].owner = 'p0';
  g.properties[1].owner = 'p1';
  const draft = {
    to: 'p1',
    giveCash: 0,
    wantCash: 0,
    giveTiles: [g.properties[0].tile],
    wantTiles: [g.properties[1].tile],
    counter: false,
  };
  const render = () => {
    const view = viewFor(g, 'p0');
    return renderToStaticMarkup(
      createElement(TradeDialog, {
        game: view,
        map: mapById(g.settings.mapId),
        me: view.players[0],
        draft,
        disabled: false,
        send: () => {},
      }),
    );
  };
  assert.doesNotMatch(render(), /地产状态已变化/);
  g.properties[0].owner = 'p1';
  const stale = render();
  assert.match(stale, /选中的地产状态已变化/);
  assert.match(stale, /清除失效地产/);
  assert.match(stale, /<button class="primary full" disabled=""/);
  g.players[1].bankrupt = true;
  assert.match(render(), /请选择交易对象/);
  g.players[1].bankrupt = false;
  draft.counter = true;
  assert.match(render(), /原交易已失效/);
});
