import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  endMatch,
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
  isTrailing,
  isBehind,
  mapOf,
  taxFor,
  salaryOf,
  bailOf,
  landPrice,
  buildCost,
} from '../packages/engine/src/index.ts';
import { botAction } from '../packages/engine/src/bot.ts';
import {
  BOARD,
  CARDS,
  CHARACTERS,
  DECK_CARDS,
  MAPS,
  NEWS,
  mapById,
} from '../packages/content/src/index.ts';
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
/** Listed price of a town square, for trades that must be roughly balanced between rivals. */
const P = (tile: number) => mapById('town').tiles[tile].price;
/** A level start: rule tests ignore the later-seat cash bonus (tested on its own). */
const game = (mapId = 'town', n = 2) => {
  const g = createGame({ ...DEFAULT_SETTINGS, mapId }, seats(n), 'test', env);
  for (const p of g.players) p.cash = DEFAULT_SETTINGS.initialCash;
  return g;
};
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
  g.settings.auction = true;
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
  g.settings.auction = true;
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
    giveTiles: [1],
    wantTiles: [2],
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
  g.settings.auction = true;
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
    // Square 3 is a chance square; keep a card on top that does not move the player.
    g.decks.chance = [
      'chance-dividend',
      ...g.decks.chance.filter((id) => id !== 'chance-dividend'),
    ];
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
  g.decks.chance = ['chance-headwind', ...g.decks.chance.filter((id) => id !== 'chance-headwind')];
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].position, 0);
  const move = [...g.events].reverse().find((e) => e.kind === 'move');
  assert.deepEqual(move?.path, [2, 1, 0]);
  assert.equal(g.decks.chance.at(-1), 'chance-headwind', 'drawn cards return to the bottom');
});
test('every chance and fate card resolves from both deck squares without breaking invariants', () => {
  for (const card of DECK_CARDS)
    for (const square of [3, 15, 21, 33]) {
      const deck = mapById('town').tiles[square].kind as 'chance' | 'fate';
      if (card.deck !== deck) continue;
      let g = game('town', 3);
      propertyAt(g, 1)!.owner = 'p0';
      propertyAt(g, 1)!.level = 2;
      propertyAt(g, 2)!.owner = 'p1';
      g.pot = 300;
      g.players[0].position = square - 1;
      g.players[0].nextDice = 1;
      g.decks[deck] = [card.id, ...g.decks[deck].filter((id) => id !== card.id)];
      g = act(g, { type: 'roll' });
      assertInvariants(g);
      const drawn = g.events.find((e) => e.spot === deck);
      assert.equal(drawn?.card, card.id, `${card.id} is announced to the table`);
      assert.equal(g.decks[deck].length, 16);
    }
  assert.equal(new Set(DECK_CARDS.map((c) => c.id)).size, 32);
});
test('deck effects: repairs tax buildings, relay helps the poorest, immunity frees from jail', () => {
  let g = game('town', 3);
  propertyAt(g, 1)!.owner = 'p0';
  propertyAt(g, 1)!.level = 3;
  g.players[0].position = 2;
  g.players[0].nextDice = 1;
  g.decks.chance = [
    'chance-renovation',
    ...g.decks.chance.filter((id) => id !== 'chance-renovation'),
  ];
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].cash, 3000 - 120);
  assert.equal(g.pot, 120);
  g = game('town', 3);
  g.players[1].cash = 5000;
  g.players[2].cash = 100;
  g.players[0].position = 14;
  g.players[0].nextDice = 1;
  g.decks.fate = ['fate-relay', ...g.decks.fate.filter((id) => id !== 'fate-relay')];
  g = act(g, { type: 'roll' });
  assert.deepEqual([g.players[1].cash, g.players[2].cash], [4900, 200]);
  g = game();
  g.players[0].position = 2;
  g.players[0].nextDice = 1;
  g.decks.chance = ['chance-immunity', ...g.decks.chance.filter((id) => id !== 'chance-immunity')];
  g = act(g, { type: 'roll' });
  assert.ok(g.players[0].newCards.includes('rescue'), 'the jail key unlocks next turn');
});
test('a clearly trailing player draws two chance cards and keeps the better one', () => {
  let g = game('town', 3);
  g.players[0].cash = 400;
  g.players[1].cash = 3000;
  g.players[0].position = 2;
  g.players[0].nextDice = 1;
  g.decks.chance = [
    'chance-passport',
    'chance-maturity',
    ...g.decks.chance.filter((id) => !['chance-passport', 'chance-maturity'].includes(id)),
  ];
  assert.equal(isTrailing(g, g.players[0]), true);
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].jailTurns, 0, 'the worse card (passport) is skipped');
  assert.equal(g.players[0].cash, 400 + 250);
  assert.ok(g.events.some((e) => e.text.includes('落后补偿')));
  assert.equal(isTrailing(g, g.players[1]), false, 'the leader never gets help');
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
test('a jailed opponent cannot be swapped out of the jail corner', () => {
  let g = game();
  g.players[1].position = BOARD.jail;
  g.players[1].jailTurns = 1;
  g.players[0].cards = ['swap'];
  assert.throws(() => act(g, { type: 'playCard', cardId: 'swap', targetId: 'p1' }), /拘留所/);
  assert.equal(botAction(g, 'p0')?.type === 'playCard', false, 'the bot keeps the card');
  g.players[1].jailTurns = 0;
  g = act(g, { type: 'playCard', cardId: 'swap', targetId: 'p1' });
  assert.equal(g.players[0].position, BOARD.jail);
  assert.equal(g.players[0].jailTurns, 0, 'standing on the jail square is only visiting');
});
test('world news flips every round, never repeats back to back, and changes that round only', () => {
  let g = game();
  assert.deepEqual(g.news, { id: 'calm', round: 1 }, 'round one opens calm and level');
  let seed = 11;
  const randomInt = (max: number) => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % max;
  const seen: string[] = [g.news!.id];
  for (let i = 0; i < 40 && g.phase !== 'finished'; i++) {
    const actor = g.trade?.to ?? actingPlayerId(g)!;
    const before = g.round;
    g = applyAction(g, actor, botAction(g, actor)!, { now: 1000, randomInt });
    if (g.round !== before) {
      assert.equal(g.news!.round, g.round);
      assert.notEqual(g.news!.id, seen.at(-1), 'no repeat on consecutive rounds');
      seen.push(g.news!.id);
    }
  }
  assert.ok(seen.length > 3);
});
test('news effects: boom rent, tax holiday, payday, customs bail, land sale, build sale', () => {
  const at = (id: string, group?: number) => {
    const g = game();
    g.news = { id, round: g.round, ...(group !== undefined ? { group } : {}) };
    return g;
  };
  let g = at('boom', 0);
  propertyAt(g, 1)!.owner = 'p0'; // builder: no rent passive
  const base = mapById('town').tiles[1].rent;
  assert.equal(rentOf(g, propertyAt(g, 1)!), Math.round(base * 1.5));
  g.news!.round = g.round - 1;
  assert.equal(rentOf(g, propertyAt(g, 1)!), base, 'expired news has no effect');
  g = at('tax-holiday');
  g.players[0].position = 5;
  g.players[0].nextDice = 1;
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].cash, 3000);
  g = at('payday');
  assert.equal(salaryOf(g), BOARD.salary * 2);
  g = at('customs');
  assert.equal(bailOf(g), BOARD.bail * 2);
  g = at('land-sale');
  assert.equal(landPrice(g, 1), Math.round(mapById('town').tiles[1].price * 0.8));
  assert.equal(viewFor(g, 'p0').properties.find((p) => p.tile === 1)!.price, landPrice(g, 1));
  g.players[0].position = 1;
  g.phase = 'purchase';
  g = act(g, { type: 'buy' });
  assert.equal(g.players[0].cash, 3000 - landPrice(g, 1));
  g = at('build-sale');
  propertyAt(g, 1)!.owner = 'p0';
  assert.equal(
    buildCost(g, g.players[0], propertyAt(g, 1)!),
    Math.round(mapById('town').tiles[1].buildCost * 0.85 * 0.7),
  );
});

test('the wealth tax only charges a clear leader', () => {
  const flip = (g: GameState) => {
    g.news = { id: 'payday', round: g.round };
    g.phase = 'manage';
    g.turn = g.players.length - 1;
    // Force the next flip to draw the wealth tax.
    return applyAction(
      g,
      g.players[g.turn].id,
      { type: 'end' },
      {
        now: 1000,
        randomInt: (max: number) =>
          max === NEWS.length - 1
            ? NEWS.filter((n) => n.id !== 'payday').findIndex((n) => n.id === 'wealth-tax')
            : 0,
      },
    );
  };
  let g = flip(game('town', 3));
  assert.equal(g.news!.id, 'wealth-tax');
  assert.equal(g.pot, 0, 'equal tables pay nothing');
  g = game('town', 3);
  g.players[1].cash = 6000;
  g = flip(g);
  assert.equal(g.pot, 300);
  assert.equal(g.players[1].cash, 5700);
});

test('catch-up rules: subsidy for players far behind, wealth-scaled tax, travel stipend', () => {
  let g = game('town', 3);
  g.players[1].cash = 9000;
  assert.equal(isBehind(g, g.players[0]), true);
  assert.equal(isBehind(g, g.players[1]), false);
  g.players[0].position = BOARD.tiles - 1;
  g.players[0].nextDice = 2;
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].cash, 3000 + BOARD.salary * 1.5, 'salary plus 50% catch-up subsidy');
  assert.ok(g.events.some((e) => e.text.includes('追赶补贴')));
  // Tax: the rich pay 4% of net worth once that beats the base tax.
  assert.equal(taxFor(g, g.players[1]), Math.round(9000 * 0.04));
  assert.equal(taxFor(g, g.players[2]), 120 + g.round * 5);
  // Stipend every four rounds: 60, or 140 for players far behind.
  g = game('town', 3);
  g.players[1].cash = 9000;
  g.round = 3;
  g.turn = 2;
  g.phase = 'manage';
  g = applyAction(g, 'p2', { type: 'end' }, { now: 1000, randomInt: () => 0 });
  assert.equal(g.round, 4);
  assert.ok(
    g.events.some((e) => e.actor === 'p0' && e.text.includes('追赶加倍') && e.amount === 140),
  );
  assert.ok(
    g.events.some(
      (e) => e.actor === 'p1' && e.text === 'P1：环球补助 +60'.replace('P1', g.players[1].name),
    ),
  );
});
test('waiting players can guess the next roll for free; correct guesses earn a capped reward', () => {
  let g = game('town', 3);
  assert.throws(() => act(g, { type: 'guess', pick: 'high' }), /别人掷骰/);
  const revision = g.revision;
  g = act(g, { type: 'guess', pick: 'high' }, 'p1');
  g = act(g, { type: 'guess', pick: 'low' }, 'p2');
  assert.equal(g.revision, revision, 'guesses never make the roller stale');
  assert.throws(() => act(g, { type: 'guess', pick: 'low' }, 'p1'), /已经猜过/);
  assert.equal(viewFor(g, 'p0').guesses.p1, 'high', 'guesses are public');
  // A real roll of 5 (remote-dice rolls are not scored).
  g = applyAction(
    g,
    'p0',
    { type: 'roll' },
    { now: 1000, randomInt: (max) => (max === 6 ? 4 : 0) },
  );
  assert.equal(g.players[1].cash, 3000 + BOARD.guessReward);
  assert.equal(g.players[2].cash, 3000);
  assert.equal(g.players[1].prophet, 1);
  assert.deepEqual(g.guesses, {});
  assert.ok(g.events.some((e) => e.spot === 'guess'));
  // The reward stops after the cap; the count keeps going for the end-of-match title.
  g = game('town', 3);
  g.players[1].prophet = BOARD.guessCap;
  g = act(g, { type: 'guess', pick: 'low' }, 'p1');
  g = applyAction(g, 'p0', { type: 'roll' }, { now: 1000, randomInt: () => 0 });
  assert.equal(g.players[1].cash, 3000);
  assert.equal(g.players[1].prophet, BOARD.guessCap + 1);
});
test('review fixes: hidden decks, lucky-day debt, shared payments, fixed rolls', () => {
  // Deck order never reaches any viewer.
  let g = game('town', 3);
  for (const id of ['p0', 'p1', null]) assert.equal('decks' in viewFor(g, id), false);
  // Lucky day money arrives first, so a small fine is paid instead of forcing bankruptcy.
  g = game();
  g.news = { id: 'lucky', round: g.round };
  g.players[0].cash = 30;
  g.players[0].position = 2;
  g.players[0].nextDice = 1;
  g.decks.chance = ['chance-speeding', ...g.decks.chance.filter((id) => id !== 'chance-speeding')];
  g = act(g, { type: 'roll' });
  assert.equal(g.debt, null);
  assert.equal(g.players[0].cash, 30 + 50 - 60);
  // Paying every rival: a shortfall becomes one debt shared by all rivals.
  g = game('town', 4);
  for (const p of g.players) p.cash = 60;
  propertyAt(g, 1)!.owner = 'p0';
  g.players[0].position = 2;
  g.players[0].nextDice = 1;
  g.decks.chance = ['chance-chairman', ...g.decks.chance.filter((id) => id !== 'chance-chairman')];
  g = act(g, { type: 'roll' });
  assert.equal(g.phase, 'debt');
  assert.equal(g.debt!.amount, 150);
  assert.deepEqual(g.debt!.split, ['p1', 'p2', 'p3']);
  g.players[0].deposit = 200;
  g = act(g, { type: 'bank', direction: 'withdraw', amount: 200 });
  assert.deepEqual(
    g.players.map((p) => p.cash),
    [60 + 200 - 150, 110, 110, 110],
  );
  // A roll fixed by remote dice is not scored for guesses.
  g = game('town', 3);
  g = act(g, { type: 'guess', pick: 'high' }, 'p1');
  g.players[0].nextDice = 6;
  g.decks.fate = ['fate-bonus', ...g.decks.fate.filter((id) => id !== 'fate-bonus')];
  g = act(g, { type: 'roll' });
  assert.equal(g.players[1].cash, 3000);
  assert.equal(g.players[1].prophet, 0);
});
test('free trading: any player proposes, several squares per side, counter-offers and a cooldown', () => {
  let g = game('town', 3);
  propertyAt(g, 1)!.owner = 'p1';
  propertyAt(g, 2)!.owner = 'p1';
  propertyAt(g, 4)!.owner = 'p2';
  // p1 proposes although it is p0's turn.
  g = act(
    g,
    { type: 'tradeOffer', to: 'p2', giveCash: 0, wantCash: 0, giveTiles: [1, 2], wantTiles: [4] },
    'p1',
  );
  assert.deepEqual(g.trade!.giveTiles, [1, 2]);
  assert.ok(g.events.some((e) => e.spot === 'offer'));
  assert.throws(() => act(g, { type: 'roll' }), /交易/);
  // p2 counters: keeps square 4 and offers 300 cash for both squares instead.
  g = act(
    g,
    { type: 'tradeCounter', giveCash: 300, wantCash: 0, giveTiles: [], wantTiles: [1, 2] },
    'p2',
  );
  assert.equal(g.trade!.from, 'p2');
  assert.equal(g.trade!.to, 'p1');
  assert.equal(g.trade!.counter, true);
  g = act(g, { type: 'tradeAccept' }, 'p1');
  assert.equal(propertyAt(g, 1)!.owner, 'p2');
  assert.equal(propertyAt(g, 2)!.owner, 'p2');
  assert.equal(g.players[1].cash, 3300, 'p1 receives the 300 p2 offered');
  assert.equal(g.players[2].cash, 2700);
  // A rejected proposer waits before proposing again.
  propertyAt(g, 10)!.owner = 'p0';
  g = act(
    g,
    { type: 'tradeOffer', to: 'p0', giveCash: P(10), wantCash: 0, giveTiles: [], wantTiles: [10] },
    'p1',
  );
  g = act(g, { type: 'tradeReject' }, 'p0');
  assert.throws(
    () =>
      act(
        g,
        {
          type: 'tradeOffer',
          to: 'p0',
          giveCash: P(10),
          wantCash: 0,
          giveTiles: [],
          wantTiles: [10],
        },
        'p1',
      ),
    /稍等/,
  );
  // Buildings and mortgages block a square from trading.
  propertyAt(g, 4)!.level = 1;
  assert.throws(
    () =>
      act(
        g,
        { type: 'tradeOffer', to: 'p0', giveCash: 0, wantCash: 0, giveTiles: [4], wantTiles: [] },
        'p2',
      ),
    /建筑/,
  );
});
test('bots value colour groups: they buy the last square they need and refuse cheap completions', () => {
  let g = game('town', 2);
  // p0 owns two of group 0 (squares 1, 2, 4); p1 owns the third.
  propertyAt(g, 1)!.owner = 'p0';
  propertyAt(g, 2)!.owner = 'p0';
  propertyAt(g, 4)!.owner = 'p1';
  g.phase = 'manage';
  g.players[0].cash = 5000;
  // Isolate the trade decision from the bot's talent and hand cards.
  g.players[0].abilityRound = g.round;
  g.players[0].cards = [];
  const offer = botAction(g, 'p0');
  assert.equal(offer?.type, 'tradeOffer');
  assert.deepEqual(offer?.type === 'tradeOffer' && offer.wantTiles, [4]);
  // A cheap offer that completes the proposer's group is refused; a generous one is taken.
  g = act(g, {
    type: 'tradeOffer',
    to: 'p1',
    giveCash: 300,
    wantCash: 0,
    giveTiles: [],
    wantTiles: [4],
  });
  assert.equal(botAction(g, 'p1')?.type, 'tradeReject');
  g.trade!.giveCash = 1000;
  assert.equal(botAction(g, 'p1')?.type, 'tradeAccept');
});
test('end conditions: a fixed number of rounds, a net-worth target, and the final stretch', () => {
  // Rounds: the match settles after the last round, with a final stretch first.
  let g = createGame({ ...DEFAULT_SETTINGS, end: 'rounds', rounds: 4 }, seats(2), 'r', env);
  propertyAt(g, 1)!.owner = 'p1';
  const base = rentOf(g, propertyAt(g, 1)!);
  let steps = 0;
  while (g.phase !== 'finished' && steps++ < 500) {
    const actor = g.trade?.to ?? actingPlayerId(g)!;
    g = applyAction(g, actor, botAction(g, actor)!, env);
    if (g.round === 3 && g.phase !== 'finished') {
      assert.equal(g.finale, true, 'the last two rounds are the final stretch');
      assert.ok(rentOf(g, propertyAt(g, 1)!) >= Math.round(base * 1.5) - 1);
    }
  }
  assert.equal(g.phase, 'finished');
  assert.match(g.finishReason, /4 轮/);
  assert.ok(g.events.some((e) => e.text.includes('终局冲刺')));
  // Target: the first player to the target wins at once.
  g = createGame({ ...DEFAULT_SETTINGS, end: 'target', target: 6000 }, seats(3), 't', env);
  g.players[2].deposit = 3100;
  g = act(g, { type: 'end' }, 'p0');
  assert.equal(g.phase, 'finished');
  assert.deepEqual(g.winners, ['p2']);
  assert.match(g.finishReason, /率先达到目标/);
  // 80% of the target starts the final stretch.
  g = createGame({ ...DEFAULT_SETTINGS, end: 'target', target: 10000 }, seats(3), 't2', env);
  g.players[1].deposit = 5100;
  g = act(g, { type: 'ability' });
  assert.equal(g.finale, true);
  // Time: the classic clock, with the last five minutes as the final stretch.
  g = createGame({ ...DEFAULT_SETTINGS, end: 'time', minutes: 20 }, seats(2), 'c', env);
  assert.equal(g.endsAt, env.now + 20 * 60000);
  const later = tickGame(g, { ...env, now: g.endsAt - 4 * 60000 });
  assert.equal(later?.finale, true);
  // Rounds and target modes still stop at the 90-minute cap.
  g = createGame(DEFAULT_SETTINGS, seats(2), 'cap', env);
  assert.equal(g.endsAt, env.now + 90 * 60000);
});
test('44-square boards: corners, jail, salary and complete bot matches on every map', () => {
  for (const mapId of ['town', 'islands', 'neon', 'ancient']) {
    let random = mapId.length * 97;
    const randomInt = (max: number) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random % max;
    };
    let now = 1000;
    let g = createGame(
      { ...DEFAULT_SETTINGS, mapId, size: 44, end: 'rounds', rounds: 10 },
      seats(4),
      `xl-${mapId}`,
      { now, randomInt },
    );
    assert.equal(mapOf(g).tiles.length, 44);
    assert.equal(g.properties.length, mapId === 'islands' ? 30 : 32);
    for (let step = 0; step < 8000 && g.phase !== 'finished'; step++) {
      const actor = g.trade?.to ?? actingPlayerId(g)!;
      g = applyAction(g, actor, botAction(g, actor)!, { now: (now += 500), randomInt });
      assertInvariants(g);
    }
    assert.equal(g.phase, 'finished', `${mapId} XL finishes`);
  }
  // Go-to-jail on the large ring sends players to square 11 without salary; start pays 600.
  let g = createGame({ ...DEFAULT_SETTINGS, size: 44 }, seats(2), 'xl', env);
  g.players[0].position = 31;
  g.players[0].nextDice = 2;
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].position, 11);
  assert.equal(g.players[0].jailTurns, 1);
  g = createGame({ ...DEFAULT_SETTINGS, size: 44 }, seats(2), 'xl2', env);
  g.players[0].position = 42;
  g.players[0].nextDice = 3;
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].position, 1);
  assert.equal(g.players[0].cash, 3000 + 600);
});
test('match statistics count rent, purchases, builds, laps, jail visits, cards and trades', () => {
  let g = game();
  g.players[0].position = 1;
  g.phase = 'purchase';
  g = act(g, { type: 'buy' });
  g = act(g, { type: 'build', tile: 1 });
  assert.equal(g.players[0].stats.bought, 1);
  assert.equal(g.players[0].stats.built, 1);
  g = act(g, { type: 'end' });
  // p1 lands on p0's square and pays rent.
  g.players[1].position = 0;
  g.players[1].nextDice = 1;
  g = act(g, { type: 'roll' }, 'p1');
  const rent = g.players[0].stats.rentIn;
  assert.ok(rent > 0);
  assert.equal(g.players[1].stats.rentOut, rent);
  assert.equal(g.players[0].stats.biggestRent, rent);
  // Laps and jail visits.
  g = game();
  g.players[0].position = BOARD.tiles - 1;
  g.players[0].nextDice = 1;
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].stats.laps, 1);
  g = game();
  g.players[0].position = BOARD.goToJail - 1;
  g.players[0].nextDice = 1;
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].stats.jailed, 1);
  // Cards played and trades completed.
  g = game();
  g.players[0].cards = ['bonus'];
  g = act(g, { type: 'playCard', cardId: 'bonus' });
  assert.equal(g.players[0].stats.cards, 1);
  propertyAt(g, 1)!.owner = 'p1';
  g = act(g, {
    type: 'tradeOffer',
    to: 'p1',
    giveCash: P(1),
    wantCash: 0,
    giveTiles: [],
    wantTiles: [1],
  });
  g = act(g, { type: 'tradeAccept' }, 'p1');
  assert.deepEqual(
    g.players.map((p) => p.stats.trades),
    [1, 1],
  );
  // Stats are public: every viewer sees them.
  assert.equal(viewFor(g, null).players[0].stats.cards, 1);
});
test('review fixes: trades cannot stall the table, team targets use averages', () => {
  // Expired offers start the cooldown too, and counters are capped.
  let g = game('town', 3);
  propertyAt(g, 4)!.owner = 'p2';
  g = act(
    g,
    { type: 'tradeOffer', to: 'p2', giveCash: P(4), wantCash: 0, giveTiles: [], wantTiles: [4] },
    'p1',
  );
  assert.equal(g.trade!.expiresAt, env.now + 30000, 'side trades hold the table for 30 s');
  const later = { now: env.now + 31000, randomInt: () => 0 };
  g = applyAction(g, 'p0', { type: 'ability' }, later);
  assert.equal(g.trade, null);
  assert.throws(
    () =>
      applyAction(
        g,
        'p1',
        {
          type: 'tradeOffer',
          to: 'p2',
          giveCash: P(4),
          wantCash: 0,
          giveTiles: [],
          wantTiles: [4],
        },
        later,
      ),
    /稍等/,
  );
  g = game('town', 2);
  propertyAt(g, 4)!.owner = 'p1';
  g = act(g, {
    type: 'tradeOffer',
    to: 'p1',
    giveCash: P(4),
    wantCash: 0,
    giveTiles: [],
    wantTiles: [4],
  });
  g = act(
    g,
    { type: 'tradeCounter', giveCash: 0, wantCash: P(4) + 20, giveTiles: [4], wantTiles: [] },
    'p1',
  );
  g = act(
    g,
    { type: 'tradeCounter', giveCash: P(4) + 10, wantCash: 0, giveTiles: [], wantTiles: [4] },
    'p0',
  );
  assert.throws(
    () =>
      act(
        g,
        { type: 'tradeCounter', giveCash: 0, wantCash: 12, giveTiles: [], wantTiles: [] },
        'p1',
      ),
    /两次/,
  );
  // 3v3 at 3000 each with a 9000 target must not end on the first move.
  g = createGame(
    { ...DEFAULT_SETTINGS, mode: 'team', end: 'target', target: 9000 },
    seats(6),
    'team-target',
    env,
  );
  g = act(g, { type: 'ability' });
  assert.notEqual(g.phase, 'finished');
  // Money owed to a player who has since gone bankrupt goes to the pot.
  g = game('town', 3);
  propertyAt(g, 1)!.owner = 'p1';
  g.players[0].cash = 0;
  g.players[0].position = 0;
  g.players[0].nextDice = 1;
  g = act(g, { type: 'roll' });
  assert.equal(g.phase, 'debt');
  g = act(g, { type: 'surrender' }, 'p1');
  g.players[0].deposit = 1000;
  g = act(g, { type: 'bank', direction: 'withdraw', amount: 1000 });
  assert.equal(g.players[1].cash, 0);
  assert.equal(g.players[1].stats.rentIn, 0);
  assertInvariants(g);
});

test('by default only the player who landed may buy; declining leaves the square unsold', () => {
  let g = game();
  g.players[0].position = 1;
  g.phase = 'purchase';
  assert.equal(actionsFor(g, 'p0').find((a) => a.action.type === 'pass')?.label, '放弃购买');
  g = act(g, { type: 'pass' });
  assert.equal(g.phase, 'manage');
  assert.equal(g.auction, null);
  assert.equal(propertyAt(g, 1)!.owner, null);
  assert.throws(() => act(g, { type: 'bid', amount: 10 }, 'p1'));
});
test('card market: one blind draw per turn, new cards wait a turn, one card played per turn', () => {
  let g = game('town', 2);
  const shop = mapById('town').tiles.find((t) => t.kind === 'shop')!.index;
  g.players[0].cards = ['bonus', 'savings'];
  g.players[0].position = shop;
  g.phase = 'manage';
  assert.ok(actionsFor(g, 'p0').some((a) => a.action.type === 'buyCard'));
  g = act(g, { type: 'buyCard' });
  assert.equal(g.players[0].cash, 3000 - BOARD.cardDraw);
  assert.equal(g.players[0].newCards.length, 1, 'the drawn card waits for the next turn');
  assert.deepEqual(g.players[0].cards, ['bonus', 'savings']);
  assert.throws(() => act(g, { type: 'buyCard' }), /只能在卡牌市场抽一次/);
  assert.throws(
    () => act(g, { type: 'playCard', cardId: g.players[0].newCards[0] }),
    /下回合才能使用|每回合只能/,
  );
  g = act(g, { type: 'playCard', cardId: 'bonus' });
  assert.throws(() => act(g, { type: 'playCard', cardId: 'savings' }), /每回合只能使用一张/);
  // The hidden new card stays private, but counts toward the hand size everyone sees.
  const view = viewFor(g, 'p1');
  assert.equal(view.players[0].cardCount, 2);
  assert.equal(view.players[0].newCards, undefined);
  g = act(g, { type: 'end' });
  g.phase = 'manage';
  g = act(g, { type: 'end' }, 'p1');
  assert.equal(g.players[0].newCards.length, 0);
  assert.equal(g.players[0].cards.length, 2, 'last turn’s draw is now playable');
  assert.equal(g.players[0].cardPlayed, false);
});
test('hands hold five cards and rent shields never stack or come from talents', () => {
  let g = game('town', 4);
  const shop = mapById('town').tiles.find((t) => t.kind === 'shop')!.index;
  g.players[0].cards = ['bonus', 'bonus', 'bonus', 'bonus', 'bonus'];
  g.players[0].position = shop;
  g.phase = 'manage';
  assert.equal(
    actionsFor(g, 'p0').some((a) => a.action.type === 'buyCard'),
    false,
  );
  assert.throws(() => act(g, { type: 'buyCard' }), /手牌已满/);
  g.players[0].cards = ['shield', 'insure'];
  g.players[0].shield = 1;
  assert.throws(() => act(g, { type: 'playCard', cardId: 'shield' }), /护盾不能叠加/);
  g = act(g, { type: 'playCard', cardId: 'insure' });
  assert.equal(g.players[0].shield, 1, 'insurance pays cash but the shield stays capped');
  assert.equal(CARDS.filter((c) => c.effect === 'shield').length, 1);
  // Runner and guardian talents no longer hand out rent shields.
  for (const id of ['p2', 'p3']) {
    let h = game('town', 4);
    h.turn = Number(id.slice(1));
    h.phase = 'manage';
    h = act(h, { type: 'ability' }, id);
    const p = h.players.find((x) => x.id === id)!;
    assert.equal(p.shield, 0);
    assert.ok(p.cash > 3000);
  }
  assert.ok(CARDS.some((c) => c.rarity === 'rare') && CARDS.some((c) => c.rarity === 'common'));
});
test('audit fixes: fair start, full land value, no gifts between rivals, no target-crossing trades', () => {
  // Later seats start a little richer; land counts at its price in net worth.
  let g = createGame(DEFAULT_SETTINGS, seats(3), 'seats', env);
  assert.deepEqual(
    g.players.map((p) => p.cash),
    [3000, 3000 + BOARD.seatBonus, 3000 + 2 * BOARD.seatBonus],
  );
  g = game('town', 3);
  propertyAt(g, 1)!.owner = 'p0';
  assert.equal(assetsOf(g, g.players[0]), 3000 + mapById('town').tiles[1].price);
  // Rivals cannot gift or overpay; teammates may help each other.
  propertyAt(g, 4)!.owner = 'p1';
  const offer = (giveCash: number, wantTiles: number[], to = 'p1') =>
    ({ type: 'tradeOffer', to, giveCash, wantCash: 0, giveTiles: [], wantTiles }) as GameAction;
  assert.throws(() => act(g, offer(100, [])), /单方面赠送/);
  const price = mapById('town').tiles[4].price;
  assert.throws(() => act(g, offer(price * 2 + 10, [4])), /2 倍/);
  act(g, offer(price * 2, [4]));
  let t = createGame({ ...DEFAULT_SETTINGS, mode: 'team' }, seats(4), 'team', env);
  t = act(t, offer(500, [], 'p2'));
  assert.equal(t.trade!.giveCash, 500, 'teammates may hand over cash');
  // A trade may not hand anyone the target win.
  let h = createGame({ ...DEFAULT_SETTINGS, end: 'target', target: 4000 }, seats(2), 'h', env);
  for (const p of h.players) p.cash = 3000;
  propertyAt(h, 4)!.owner = 'p1';
  h.players[1].cash = 4000 - price - 1;
  h = act(h, offer(price * 2, [4]));
  assert.throws(() => act(h, { type: 'tradeAccept' }, 'p1'), /目标净资产/);
});
test('audit fixes: side offers once per round and dismissable; consistent cards, jail, market and bankruptcy', () => {
  let g = game('town', 3);
  propertyAt(g, 4)!.owner = 'p2';
  const side = {
    type: 'tradeOffer',
    to: 'p2',
    giveCash: P(4),
    wantCash: 0,
    giveTiles: [],
    wantTiles: [4],
  } as GameAction;
  g = act(g, side, 'p1');
  // The player on turn waves it away and carries on.
  g = act(g, { type: 'tradeReject' }, 'p0');
  assert.equal(g.trade, null);
  assert.ok(g.events.at(-1)!.text.includes('跳过了旁人的交易提案'));
  const later = { now: env.now + 20000, randomInt: () => 0 };
  assert.throws(() => applyAction(g, 'p1', side, later), /每轮只能发起一次/);
  // 回到起点 before rolling is this turn's move, like the other movement cards.
  g = game();
  g.players[0].cards = ['home'];
  g.players[0].position = 5;
  g = act(g, { type: 'playCard', cardId: 'home' });
  assert.equal(g.phase, 'manage');
  assert.equal(g.players[0].position, 0);
  // The market sells only on the turn you arrive, after landing.
  g = game();
  const shop = mapById('town').tiles.find((t) => t.kind === 'shop')!.index;
  g.players[0].position = shop;
  assert.throws(() => act(g, { type: 'buyCard' }), /抵达卡牌市场后/);
  // After a failed jail roll you stay put for the rest of the turn.
  g = game();
  g.players[0].position = mapOf(g).corners.jail;
  g.players[0].jailTurns = 1;
  g.players[0].cards = ['sprint'];
  g.phase = 'jail';
  g = applyAction(g, 'p0', { type: 'jailRoll' }, { now: 1000, randomInt: () => 0 });
  assert.equal(g.phase, 'manage');
  assert.throws(() => act(g, { type: 'playCard', cardId: 'sprint' }), /拘留中/);
  // Road works take at most the cash in hand, and the landing still offers the square.
  g = game();
  g.traps[1] = { owner: 'p1', until: 99, amount: 100 };
  g.players[0].cash = 40;
  g.players[0].nextDice = 1;
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].cash, 0);
  assert.equal(g.debt, null);
  assert.equal(g.phase, 'purchase');
  // A creditor takes mortgaged land as it is.
  g = game('town', 3);
  propertyAt(g, 2)!.owner = 'p0';
  propertyAt(g, 2)!.mortgaged = true;
  propertyAt(g, 1)!.owner = 'p1';
  propertyAt(g, 1)!.level = 3;
  g.players[0].cash = 0;
  g.players[0].nextDice = 1;
  g = act(g, { type: 'roll' });
  g = act(g, { type: 'surrender' });
  assert.equal(propertyAt(g, 2)!.owner, 'p1');
  assert.equal(propertyAt(g, 2)!.mortgaged, true);
});
test('review fixes: balanced rival trades, lasting off-turn quota, bots skip side offers, savings pay road works', () => {
  let g = game('town', 3);
  propertyAt(g, 4)!.owner = 'p2';
  propertyAt(g, 1)!.owner = 'p1';
  // A token coin for a square is not a trade between rivals.
  assert.throws(
    () =>
      act(
        g,
        { type: 'tradeOffer', to: 'p2', giveCash: 1, wantCash: 0, giveTiles: [], wantTiles: [4] },
        'p1',
      ),
    /差距不能超过一倍/,
  );
  // Using the off-turn offer, then an offer to the player on turn, does not refill the quota.
  const side = {
    type: 'tradeOffer',
    to: 'p2',
    giveCash: P(4),
    wantCash: 0,
    giveTiles: [],
    wantTiles: [4],
  } as GameAction;
  g = act(g, side, 'p1');
  g = act(g, { type: 'tradeReject' }, 'p2');
  let t = { now: env.now + 16000, randomInt: () => 0 };
  g = applyAction(
    g,
    'p1',
    { type: 'tradeOffer', to: 'p0', giveCash: 0, wantCash: P(1), giveTiles: [1], wantTiles: [] },
    t,
  );
  g = applyAction(g, 'p0', { type: 'tradeReject' }, t);
  t = { now: env.now + 40000, randomInt: () => 0 };
  assert.throws(() => applyAction(g, 'p1', side, t), /每轮只能发起一次/);
  // A bot on turn waves away an offer between two others.
  g = game('town', 3);
  propertyAt(g, 4)!.owner = 'p2';
  g = act(g, side, 'p1');
  assert.ok(actionsFor(g, 'p0').some((a) => a.action.type === 'tradeReject'));
  assert.equal(botAction(g, 'p0')?.type, 'tradeReject');
  // Road works are paid from savings when cash runs short.
  g = game();
  g.traps[1] = { owner: 'p1', until: 99, amount: 100 };
  g.players[0].cash = 30;
  g.players[0].deposit = 500;
  g.players[0].nextDice = 1;
  g = act(g, { type: 'roll' });
  assert.equal(g.players[0].cash + g.players[0].deposit, 430);
  assert.equal(g.players[1].cash, 3100);
});
test('bot difficulty levels play legal moves and differ in strength', () => {
  const levels = ['easy', 'normal', 'hard'] as const;
  let seed = 5;
  const randomInt = (max: number) => (
    (seed = (seed * 1103515245 + 12345) % 2147483648),
    seed % max
  );
  const wins = { easy: 0, normal: 0, hard: 0 };
  for (let i = 0; i < 30; i++) {
    let now = 1000;
    let g = createGame(DEFAULT_SETTINGS, seats(3), `lv${i}`, { now, randomInt });
    const order = levels.map((_, k) => levels[(k + i) % 3]);
    for (let step = 0; step < 20000 && g.phase !== 'finished'; step++) {
      const actor = g.trade?.to ?? actingPlayerId(g)!;
      g = applyAction(g, actor, botAction(g, actor, order[Number(actor.slice(1))])!, {
        now: (now += 700),
        randomInt,
      });
      assertInvariants(g);
    }
    assert.equal(g.phase, 'finished');
    for (const w of g.winners) wins[order[Number(w.slice(1))]]++;
  }
  assert.ok(wins.hard > wins.easy, `hard ${wins.hard} should beat easy ${wins.easy}`);
});

test('financial history records true opening, completed rounds and a final partial round without private fields', () => {
  let g = createGame({ ...DEFAULT_SETTINGS, end: 'rounds', rounds: 4 }, seats(), 'history', env);
  assert.equal(g.history?.length, 1);
  assert.deepEqual(
    g.history![0].players.map((p) => p.cash),
    g.players.map((p) => p.cash),
  );
  const opening = JSON.stringify(g.history![0]);
  for (let step = 0; step < 1000 && g.phase !== 'finished'; step++) {
    const id = g.trade?.to ?? actingPlayerId(g)!;
    g = applyAction(g, id, botAction(g, id)!, { now: 1000 + step * 100, randomInt: () => 0 });
  }
  assert.equal(g.phase, 'finished');
  assert.deepEqual(
    g.history!.map((s) => s.round),
    [0, 1, 2, 3, 4],
  );
  assert.ok(g.history!.every((s) => s.complete));
  assert.equal(JSON.stringify(g.history![0]), opening, 'earlier samples remain immutable');
  for (const p of g.history!.at(-1)!.players) {
    assert.equal(
      p.assets,
      assetsOf(
        g,
        g.players.find((x) => x.id === p.id)!,
      ),
    );
    assert.equal(p.assets, p.cash + p.deposit + p.propertyValue - p.debt);
  }
  const publicHistory = JSON.stringify(viewFor(g, null).history);
  assert.doesNotMatch(publicHistory, /cardId|nextDice|newCards|tokenHash|decks/);
  assert.equal(g.finishedAt, g.decisionAt);
  // An externally ended/time-limited match also records its incomplete final round.
  let partial = game();
  partial.phase = 'manage';
  partial.players[0].cash += 200;
  partial = endMatch(partial, '测试结束', { ...env, now: 5000 });
  assert.equal(partial.history!.at(-1)!.complete, false);
  assert.equal(partial.history!.at(-1)!.players[0].cash, partial.players[0].cash);
});

test('financial history survives event trimming and spectators only receive a short tail while playing', () => {
  let g = game();
  for (let round = 0; round < 4; round++) {
    g.phase = 'manage';
    g.turn = 1;
    g = applyAction(g, 'p1', { type: 'end' }, { now: 2000 + round * 100, randomInt: () => 0 });
  }
  assert.equal(g.history!.length, 5);
  for (let i = 0; i < 200; i++) log(g, env, 'test', '记录');
  assert.equal(g.events.length, 120);
  assert.equal(g.history![0].round, 0);
  assert.equal(viewFor(g, null).history!.length, 2);
  const old = { ...g, history: undefined };
  const done = endMatch(old, '旧存档结束', env);
  assert.equal(done.history!.length, 1, 'old rounds are never invented');
  assert.equal(done.history![0].round, g.round);
});
