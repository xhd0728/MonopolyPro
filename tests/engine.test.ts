import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  applyAction,
  assertInvariants,
  actingPlayerId,
  propertyAt,
  rentOf,
  exitsFor,
  actionsFor,
  viewFor,
  tickGame,
  assetsOf,
  log,
  VIEW_EVENTS,
} from '../packages/engine/src/index.ts';
import { botAction } from '../packages/engine/src/bot.ts';
import { BOARD, CARDS, CHARACTERS, MAPS, mapById } from '../packages/content/src/index.ts';
import {
  DEFAULT_SETTINGS,
  type Seat,
  type GameState,
  type GameAction,
} from '../packages/shared/src/index.ts';
const seats = (n = 2): Seat[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `玩家${i}`,
    characterId: CHARACTERS[i % 6].id,
    team: i % 2,
    bot: true,
    ready: true,
    spectator: false,
    tokenHash: '',
    connected: true,
    disconnectedAt: null,
    controlEpoch: 0,
  }));
const env = { now: 1000, randomInt: (_max: number) => 0 };
const game = (mapId = 'town', n = 2) =>
  createGame({ ...DEFAULT_SETTINGS, mapId }, seats(n), 'test', env);
const act = (g: GameState, a: GameAction, id = 'p0') => applyAction(g, id, a, env);
test('ownership, exact purchase/build costs, mortgage and redemption', () => {
  let g = game();
  g.players[0].position = 1;
  g.phase = 'purchase';
  g = act(g, { type: 'buy' });
  assert.equal(g.players[0].cash, 3000 - mapById('town').tiles[1].price);
  assert.equal(propertyAt(g, 1)?.owner, 'p0');
  const prev = g.players[0].cash;
  g = act(g, { type: 'build', tile: 1 });
  assert.equal(g.players[0].cash, prev - Math.round(mapById('town').tiles[1].buildCost * 0.85));
  assert.throws(() => act(g, { type: 'mortgage', tile: 1 }));
  g = act(g, { type: 'downgrade', tile: 1 });
  g = act(g, { type: 'mortgage', tile: 1 });
  assert.equal(rentOf(g, propertyAt(g, 1)!), 0);
  g = act(g, { type: 'redeem', tile: 1 });
  assert.equal(propertyAt(g, 1)?.mortgaged, false);
  assert.throws(() => act(g, { type: 'build', tile: 1 }, 'p1'));
});
test('auction sequential bidding settles once, and all-pass leaves property unowned', () => {
  let g = game();
  g.phase = 'purchase';
  g.players[0].position = 1;
  g = act(g, { type: 'pass' });
  g = act(g, { type: 'bid', amount: 200 });
  assert.throws(() => act(g, { type: 'bid', amount: 210 }));
  g = act(g, { type: 'auctionPass' }, 'p1');
  assert.equal(propertyAt(g, 1)?.owner, 'p0');
  assert.equal(g.players[0].cash, 2800);
  assert.equal(g.phase, 'manage');
  g = game();
  g.phase = 'purchase';
  g.players[0].position = 1;
  g = act(g, { type: 'pass' });
  g = act(g, { type: 'auctionPass' });
  g = act(g, { type: 'auctionPass' }, 'p1');
  assert.equal(propertyAt(g, 1)?.owner, null);
});
test('trade validates all assets before atomic exchange and freezes turn', () => {
  let g = game();
  propertyAt(g, 1)!.owner = 'p0';
  propertyAt(g, 2)!.owner = 'p1';
  g = act(g, {
    type: 'tradeOffer',
    to: 'p1',
    giveCash: 100,
    wantCash: 20,
    giveTile: 1,
    wantTile: 2,
  });
  assert.throws(() => act(g, { type: 'roll' }));
  g.players[1].cash = 0;
  const before = structuredClone(g);
  assert.throws(() => act(g, { type: 'tradeAccept' }, 'p1'));
  assert.deepEqual(g, before);
  g.players[1].cash = 3000;
  g = act(g, { type: 'tradeAccept' }, 'p1');
  assert.equal(propertyAt(g, 1)?.owner, 'p1');
  assert.equal(propertyAt(g, 2)?.owner, 'p0');
  assert.deepEqual(
    g.players.map((p) => p.cash),
    [2920, 3080],
  );
});
test('players leaving an auction preserve the active bidder and settle before the next turn', () => {
  let g = game('town', 4);
  g.phase = 'purchase';
  g.players[0].position = 1;
  g = act(g, { type: 'pass' });
  g = act(g, { type: 'bid', amount: 100 });
  assert.equal(actingPlayerId(g), 'p1');
  g = act(g, { type: 'surrender' }, 'p3');
  assert.equal(actingPlayerId(g), 'p1', 'an unrelated departure must not skip a bidder');
  g = act(g, { type: 'surrender' });
  assert.equal(g.phase, 'auction', 'the initiating player leaving must not cancel bidding');
  assert.equal(actingPlayerId(g), 'p1');
  assert.equal(g.auction!.highBidderId, null);
  g = act(g, { type: 'bid', amount: 200 }, 'p1');
  g = act(g, { type: 'auctionPass' }, 'p2');
  assert.equal(propertyAt(g, 1)!.owner, 'p1');
  assert.equal(g.players[1].cash, 2800);
  assert.equal(g.phase, 'roll');
  assert.equal(g.turn, 1);
  assert.equal(g.auction, null);
  assertInvariants(g);
});
test('public asset breakdown and payable rents match authority calculations without private hands', () => {
  const g = game('town', 4);
  propertyAt(g, 1)!.owner = 'p1';
  propertyAt(g, 1)!.level = 2;
  propertyAt(g, 2)!.owner = 'p1';
  propertyAt(g, 2)!.mortgaged = true;
  g.players[1].deposit = 600;
  g.debt = { playerId: 'p1', amount: 100, creditorId: null, reason: '税费' };
  const v = viewFor(g, 'p3');
  const p = v.players[1];
  assert.equal(p.assets, p.cash + p.deposit + p.propertyValue - p.debt);
  assert.equal(p.propertyCount, 2);
  assert.equal(p.buildingCount, 2);
  assert.equal(p.debt, 100);
  assert.equal(
    v.properties.find((x) => x.tile === 1)!.payableRent,
    rentOf(g, propertyAt(g, 1)!, g.players[3]),
  );
  assert.equal(v.properties.find((x) => x.tile === 2)!.rent, 0);
  assert.equal(p.cards, undefined);
  assert.equal(p.nextDice, undefined);
  g.players[3].shield = 1;
  assert.equal(viewFor(g, 'p3').properties.find((x) => x.tile === 1)!.payableRent, 0);
  g.players[3].shield = 0;
  g.settings.mode = 'team';
  assert.equal(viewFor(g, 'p3').properties.find((x) => x.tile === 1)!.payableRent, 0);
});
test('debt can be resolved by emergency withdrawal; bankruptcy clears ownership', () => {
  let g = game();
  g.players[0].cash = 1;
  g.players[0].deposit = 300;
  g.players[0].position = 5;
  g.players[0].nextDice = 1;
  g = act(g, { type: 'roll' });
  assert.equal(g.phase, 'debt');
  const d = g.debt!.amount;
  g = act(g, { type: 'bank', amount: 300, direction: 'withdraw' });
  assert.equal(g.phase, 'manage');
  assert.equal(g.players[0].cash, 301 - d);
  propertyAt(g, 1)!.owner = 'p0';
  g = act(g, { type: 'surrender' });
  assert.equal(propertyAt(g, 1)?.owner, null);
  assert.equal(g.phase, 'finished');
  assert.deepEqual(g.winners, ['p1']);
});
test('each roll uses exactly one six-sided die; runner adds one step', () => {
  for (let face = 0; face < 6; face++) {
    let g = game();
    const roll = { now: 1000, randomInt: (max: number) => (max === 6 ? face : 0) };
    g = applyAction(g, 'p0', { type: 'roll' }, roll);
    assert.deepEqual(g.lastDice, [face + 1]);
    assert.equal(g.players[0].position, face + 1, 'builder moves exactly the die value');
  }
  let g = game();
  g.players[0].characterId = 'runner';
  g = applyAction(g, 'p0', { type: 'roll' }, { now: 1000, randomInt: () => 5 });
  assert.deepEqual(g.lastDice, [6]);
  assert.equal(g.players[0].position, 7, 'runner gets +1 on top of the single die');
});
test('private cards and predetermined dice do not reach opponents or spectators', () => {
  const g = game();
  g.players[0].nextDice = 6;
  assert.equal(viewFor(g, 'p0').players[0].cards?.length, 2);
  for (const id of ['p1', null]) {
    const v = viewFor(g, id);
    assert.equal(v.players[0].cards, undefined);
    assert.equal(v.players[0].nextDice, undefined);
    assert.equal(v.players[0].cardCount, 2);
  }
  assert.equal(viewFor(g, null).actions.length, 0);
});
test('maps differ in live routing, and ferry costs exactly 80', () => {
  let g = game('islands');
  g.phase = 'manage';
  g.players[0].position = 13;
  g = act(g, { type: 'ferry' });
  assert.equal(g.players[0].position, 31);
  assert.equal(g.players[0].cash, 2920);
  assert.equal(g.phase, 'roll');
  g = game('neon');
  assert.deepEqual(exitsFor(g, 11), [12, 23]);
  g.players[0].position = 11;
  g.players[0].nextDice = 1;
  g = act(g, { type: 'roll' });
  assert.equal(g.phase, 'path');
  g = act(g, { type: 'choosePath', tile: 23 });
  assert.equal(g.players[0].position, 23);
  assert.equal(g.pendingPath, null);
  g = game('ancient');
  assert.deepEqual(exitsFor(g, 11), [12]);
  g.round = 2;
  assert.deepEqual(exitsFor(g, 11), [12, 22]);
});
test('go-to-jail sends players straight to jail without salary; three ways out', () => {
  const jailed = () => {
    let g = game();
    g.players[0].position = BOARD.goToJail - 2;
    g.players[0].nextDice = 2;
    g = act(g, { type: 'roll' });
    assert.equal(g.players[0].position, BOARD.jail);
    assert.equal(g.players[0].jailTurns, 1);
    assert.equal(g.players[0].cash, 3000, 'no salary when sent to jail');
    assert.equal(g.phase, 'manage');
    g = act(g, { type: 'end' });
    g = act(g, { type: 'roll' }, 'p1');
    g.phase = 'manage';
    g = act(g, { type: 'end' }, 'p1');
    assert.equal(g.phase, 'jail');
    assert.ok(actionsFor(g, 'p0').some((a) => a.action.type === 'bail'));
    assert.throws(() => act(g, { type: 'roll' }), /不能掷骰/);
    return g;
  };
  // 1. Pay bail: the fine feeds the Free Parking pot and the turn continues normally.
  let g = jailed();
  const pot = g.pot;
  g = act(g, { type: 'bail' });
  assert.equal(g.phase, 'roll');
  assert.equal(g.players[0].jailTurns, 0);
  assert.equal(g.pot, pot + BOARD.bail);
  // 2. Roll a six: leave immediately and move by that roll.
  g = jailed();
  g = applyAction(
    g,
    'p0',
    { type: 'jailRoll' },
    {
      now: 1000,
      randomInt: (max) => (max === 6 ? 5 : 0),
    },
  );
  assert.equal(g.players[0].position, BOARD.jail + 6);
  assert.equal(g.players[0].jailTurns, 0);
  // Any other face serves the turn; next turn is free.
  g = jailed();
  g = applyAction(g, 'p0', { type: 'jailRoll' }, { now: 1000, randomInt: () => 2 });
  assert.equal(g.players[0].position, BOARD.jail);
  assert.equal(g.players[0].jailTurns, 0);
  assert.equal(g.phase, 'manage');
  // 3. A get-out card releases the player; movement cards are blocked while jailed.
  g = jailed();
  g.players[0].cards = ['sprint', 'rescue'];
  assert.throws(() => act(g, { type: 'playCard', cardId: 'sprint' }), /拘留中/);
  g = act(g, { type: 'playCard', cardId: 'rescue' });
  assert.equal(g.phase, 'roll');
  assert.equal(g.players[0].jailTurns, 0);
  assertInvariants(g);
});
test('taxes fill the Free Parking pot, and landing there collects it all', () => {
  let g = game();
  g.players[0].position = 5;
  g.players[0].nextDice = 1;
  g = act(g, { type: 'roll' });
  const tax = 3000 - g.players[0].cash;
  assert.ok(tax > 0);
  assert.equal(g.pot, tax);
  g = act(g, { type: 'end' });
  g.players[1].position = BOARD.parking - 3;
  g.players[1].nextDice = 3;
  const before = g.players[1].cash;
  g = act(g, { type: 'roll' }, 'p1');
  assert.equal(g.players[1].cash, before + tax);
  assert.equal(g.pot, 0);
});
test('chance tiles can push players back three squares', () => {
  let g = game();
  g.players[0].position = 2;
  g.players[0].nextDice = 1;
  // Event roll picks outcome 4 (headwind), every other random draw is 0.
  let draws = 0;
  g = applyAction(
    g,
    'p0',
    { type: 'roll' },
    {
      now: 1000,
      randomInt: (max) => (max === 8 && draws++ === 0 ? 4 : 0),
    },
  );
  assert.equal(g.players[0].position, 0);
  const move = [...g.events].reverse().find((e) => e.kind === 'move');
  assert.deepEqual(move?.path, [2, 1, 0]);
});
test('all 30 controlled card effects execute with valid targets', () => {
  assert.equal(CARDS.length, 30);
  for (const card of CARDS) {
    let g = game();
    g.players[0].cards = [card.id];
    g.players[1].cards = ['bonus'];
    propertyAt(g, 1)!.owner = 'p0';
    propertyAt(g, 2)!.owner = 'p1';
    propertyAt(g, 2)!.level = 2;
    propertyAt(g, 1)!.level = 1;
    g = act(g, {
      type: 'playCard',
      cardId: card.id,
      targetId: 'p1',
      tile: card.target === 'ownProperty' ? 1 : card.target === 'enemyProperty' ? 2 : 4,
      value: 3,
    });
    assertInvariants(g);
    assert.ok(!g.players[0].cards.includes(card.id));
  }
});
test('team rent exemption, timing ranking and surviving team winner', () => {
  let g = createGame({ ...DEFAULT_SETTINGS, mode: 'team' }, seats(4), 'teams', env);
  propertyAt(g, 1)!.owner = 'p2';
  g.players[0].position = 0;
  g.players[0].nextDice = 1;
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].cash, 3000);
  g = act(g, { type: 'surrender' }, 'p1');
  g = act(g, { type: 'surrender' }, 'p3');
  assert.equal(g.phase, 'finished');
  assert.deepEqual(g.winners, ['p0', 'p2']);
  g = game();
  g.players[1].deposit = 500;
  g = tickGame(g, { ...env, now: g.endsAt })!;
  assert.deepEqual(g.winners, ['p1']);
  assert.equal(assetsOf(g, g.players[1]), 3500);
});
test('complete seeded bot matches across maps, seat counts and modes', () => {
  let matches = 0,
    commands = 0;
  for (const map of MAPS)
    for (const n of [2, 4, 6])
      for (let seed = 1; seed <= 4; seed++) {
        let random = seed * 729 + n;
        const randomInt = (max: number) => {
          random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
          return random % max;
        };
        let now = 1000;
        let g = createGame(
          {
            ...DEFAULT_SETTINGS,
            mapId: map.id,
            mode: n === 2 ? 'free' : seed % 2 ? 'team' : 'quick',
            minutes: 5,
          },
          seats(n),
          `${map.id}-${n}-${seed}`,
          { now, randomInt },
        );
        for (let step = 0; step < 5000 && g.phase !== 'finished'; step++) {
          now += 300;
          const actor = g.trade?.to ?? actingPlayerId(g)!;
          const a = botAction(g, actor);
          assert.ok(a, `${g.settings.mapId} ${g.phase} needs a bot action`);
          g = applyAction(g, actor, a, { now, randomInt });
          assertInvariants(g);
          commands++;
        }
        assert.equal(g.phase, 'finished');
        assert.ok(g.winners.length);
        matches++;
      }
  console.log(`Simulated ${matches} complete matches, ${commands} commands`);
});
test('views carry a bounded recent log plus each player’s latest action from the full log', () => {
  let g = game('town', 4);
  for (let i = 0; i < 200; i++) log(g, env, 'bank', `玩家0存入 ${i}`, 'p0');
  log(g, env, 'purchase', '玩家1买下中国', 'p1');
  for (let i = 0; i < 100; i++) log(g, env, 'turn', `轮到玩家2`, 'p2');
  const v = viewFor(g, 'p0');
  assert.equal(v.events.length, VIEW_EVENTS);
  assert.deepEqual(v.events, g.events.slice(-VIEW_EVENTS));
  assert.equal(v.players[0].lastAction, '玩家0存入 199');
  assert.equal(v.players[1].lastAction, '玩家1买下中国', 'older than the view window');
  assert.equal(v.players[2].lastAction, null, 'turn notices are not actions');
  // The view must not alias mutable authority state.
  v.players[0].cards!.push('bonus');
  v.settings.minutes = 1;
  assert.notEqual(g.players[0].cards.length, v.players[0].cards!.length);
  assert.equal(g.settings.minutes, DEFAULT_SETTINGS.minutes);
  assert.equal(tickGame(g, env), null, 'idle ticks return without copying');
});
test('passing the start square pays the configured salary', () => {
  let g = game();
  g.players[0].position = BOARD.tiles - 2;
  g.players[0].nextDice = 4;
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].position, 2);
  assert.equal(g.players[0].cash, 3000 + BOARD.salary);
  assert.equal(BOARD.salary, 500, 'single-die laps take ~10 turns; salary is scaled up to match');
});
