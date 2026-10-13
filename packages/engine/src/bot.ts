import { cardById, mapById } from '../../content/src/index.ts';
import type {
  CardDefinition,
  GameAction,
  GameState,
  PlayerState,
  PropertyState,
} from '../../shared/src/index.ts';
import {
  actionsFor,
  actingPlayerId,
  assetsOf,
  bailOf,
  buildCost,
  isEnemy,
  landPrice,
  propertyAt,
  rentOf,
} from './index.ts';

/** A rule-bot move with a short, public explanation (never mentions cards still in hand). */
export interface BotDecision {
  action: GameAction;
  reason: string;
}

/** Uses only public opponent information and this seat's own cards. No network/LLM calls. */
export function botAction(g: GameState, id: string): GameAction | null {
  return botDecision(g, id)?.action ?? null;
}

const tileOf = (g: GameState, tile: number) =>
  mapById(g.settings.mapId, g.settings.size).tiles[tile];
const groupOf = (g: GameState, tile: number) => tileOf(g, tile).group;
const groupLots = (g: GameState, tile: number) =>
  g.properties.filter((x) => groupOf(g, x.tile) === groupOf(g, tile));
const rivals = (g: GameState, p: PlayerState) =>
  g.players.filter((x) => !x.bankrupt && isEnemy(g, p, x));

/**
 * Cash the bot keeps for rent it might owe: the dearest rival rent on the board, at least 300.
 * Spending below this line is how rule bots used to go bankrupt on one unlucky roll.
 */
export function reserveFor(g: GameState, p: PlayerState) {
  let worst = 0;
  for (const prop of g.properties) {
    const owner = prop.owner && g.players.find((x) => x.id === prop.owner);
    if (owner && isEnemy(g, p, owner) && !prop.mortgaged)
      worst = Math.max(worst, rentOf(g, prop, p));
  }
  return Math.max(300, Math.min(1500, worst));
}
/** The squares a roll of 1–6 (plus the runner's extra step) would reach, ignoring forks. */
function reach(g: GameState, p: PlayerState) {
  const size = mapById(g.settings.mapId, g.settings.size).tiles.length;
  const extra = p.characterId === 'runner' ? 1 : 0;
  return [1, 2, 3, 4, 5, 6].map((face) => ({ face, tile: (p.position + face + extra) % size }));
}
/** How much the bot likes ending its move on a square: positive good, negative costly. */
function landingScore(g: GameState, p: PlayerState, tile: number) {
  const t = tileOf(g, tile);
  const prop = propertyAt(g, tile);
  if (prop) {
    if (!prop.owner) return p.cash - landPrice(g, tile) > reserveFor(g, p) ? 300 : 20;
    const owner = g.players.find((x) => x.id === prop.owner)!;
    return isEnemy(g, p, owner) ? -rentOf(g, prop, p) : 60;
  }
  if (t.kind === 'gotojail') return -250;
  if (t.kind === 'tax') return -150;
  if (t.kind === 'parking') return g.pot;
  if (t.kind === 'chance' || t.kind === 'fate') return 60;
  return 0;
}

export function botDecision(g: GameState, id: string): BotDecision | null {
  const p = g.players.find((x) => x.id === id);
  if (!p || p.bankrupt || g.phase === 'finished') return null;
  if (g.trade?.to === id) {
    const t = g.trade;
    // What the bot receives versus what it gives, valuing colour-group effects.
    const gets = t.giveCash + t.giveTiles.reduce((n, x) => n + squareValue(g, x, id, true), 0);
    const pays = t.wantCash + t.wantTiles.reduce((n, x) => n + squareValue(g, x, t.from, true), 0);
    // Never pay cash that would leave nothing for rent.
    const affordable = p.cash - t.wantCash >= Math.min(reserveFor(g, p), p.cash * 0.5);
    return gets >= pays * 1.08 + 20 && affordable
      ? { action: { type: 'tradeAccept' }, reason: `估值 ${gets} 对 ${pays}，这笔交易划算` }
      : {
          action: { type: 'tradeReject' },
          reason: affordable ? `估值 ${gets} 对 ${pays}，不够划算` : '付完现金后无力支付租金',
        };
  }
  if (actingPlayerId(g) !== id) return null;
  const options = actionsFor(g, id);
  const has = (type: GameAction['type']) => options.find((x) => x.action.type === type);
  const reserve = reserveFor(g, p);
  if (g.phase === 'auction') {
    const bid = has('bid');
    const tile = g.auction!.tile;
    const worth = squareValue(g, tile, id, true);
    const cap = Math.min(worth, Math.max(0, p.cash - reserve));
    return bid && g.auction!.highBid + 10 <= cap
      ? { action: bid.action, reason: `估值约 ${worth}，可以继续加价` }
      : { action: { type: 'auctionPass' }, reason: '价格已超过估值或需保留现金' };
  }
  if (g.phase === 'debt') {
    const bank = has('bank');
    if (bank) return { action: bank.action, reason: '先取出存款还债' };
    // Mortgage bare land outside complete groups first; buildings earn the most rent.
    const mortgages = options.filter((x) => x.action.type === 'mortgage');
    const loose = mortgages.find((x) => {
      const tile = (x.action as { tile: number }).tile;
      return !groupLots(g, tile).every((l) => l.owner === id);
    });
    if (loose) return { action: loose.action, reason: '抵押不成组的空地筹款' };
    const sell = has('downgrade');
    if (sell) return { action: sell.action, reason: '出售建筑筹款' };
    if (mortgages[0]) return { action: mortgages[0].action, reason: '抵押地产筹款' };
    return { action: { type: 'surrender' }, reason: '资产不足以偿债' };
  }
  if (g.phase === 'purchase') {
    const buy = has('buy');
    const price = landPrice(g, p.position);
    const lots = groupLots(g, p.position);
    const completes = lots.every((x) => x.tile === p.position || x.owner === id);
    const blocks = lots.some(
      (x) =>
        x.tile !== p.position &&
        x.owner &&
        x.owner !== id &&
        lots.every((y) => y.tile === p.position || y.owner === x.owner),
    );
    const left = p.cash - price;
    if (buy && completes && left >= 100)
      return { action: buy.action, reason: `买下后凑齐色组，租金 +30%` };
    if (buy && blocks && left >= 150) return { action: buy.action, reason: '阻止对手凑齐色组' };
    // Land is what wins a timed match; keep only a modest cushion for the next rent.
    const cushion = Math.min(reserve, 250 + g.round * 15);
    if (buy && left >= cushion)
      return { action: buy.action, reason: `买后仍留 ${left} 现金，足够应付租金` };
    return {
      action: { type: 'pass' },
      reason: buy ? `买后只剩 ${left}，需要留够租金` : '现金不足',
    };
  }
  if (g.phase === 'jail') {
    const rescue = p.cards.find((c) => cardById(c)?.effect === 'rescue');
    if (rescue && !p.cardPlayed)
      return { action: { type: 'playCard', cardId: rescue }, reason: '用自由通行出狱' };
    // Leaving early matters most while unowned land is still on the board.
    const landLeft = g.properties.some((x) => !x.owner);
    return p.cash >= bailOf(g) + (landLeft ? 500 : 1500) && has('bail')
      ? { action: { type: 'bail' }, reason: landLeft ? '还有空地，尽早出狱抢地' : '现金充裕，保释' }
      : {
          action: { type: 'jailRoll' },
          reason: landLeft ? '先试试掷出 6 点' : '空地已售完，留在拘留所更安全',
        };
  }
  if (g.phase === 'path') {
    const scored = options
      .filter((x) => x.action.type === 'choosePath')
      .map((x) => ({ x, score: landingScore(g, p, (x.action as { tile: number }).tile) }))
      .sort((a, b) => b.score - a.score);
    return scored[0] ? { action: scored[0].x.action, reason: '选择风险更低的路线' } : null;
  }
  const ability = has('ability');
  if (ability) return { action: ability.action, reason: '天赋已就绪' };
  const card = cardMove(g, p, reserve);
  if (card) return card;
  // A blind draw at the market when cash is comfortable.
  const draw = has('buyCard');
  if (draw && p.cash > reserve + 600) return { action: draw.action, reason: '现金宽裕，抽一张卡' };
  const offer = groupOffer(g, p);
  if (offer) return { action: offer, reason: '出价收购凑齐色组所缺的地块' };
  const build = bestBuild(g, p, reserve);
  if (build) return build;
  const primary = options.find((x) => x.primary)?.action;
  return primary ? { action: primary, reason: '' } : null;
}

/** Upgrade where it pays most: complete groups first, then the highest rent per coin. */
function bestBuild(g: GameState, p: PlayerState, reserve: number): BotDecision | null {
  if (g.phase !== 'manage') return null;
  let best: { prop: PropertyState; score: number; cost: number; group: boolean } | null = null;
  for (const prop of g.properties) {
    if (prop.owner !== p.id || prop.mortgaged || prop.level >= 3) continue;
    const cost = buildCost(g, p, prop);
    if (p.cash - cost < Math.min(reserve, 600) + 150) continue;
    const group = groupLots(g, prop.tile).every((x) => x.owner === p.id);
    // Outside a complete group, stop at level 2 so cash stays liquid.
    if (!group && prop.level >= 2) continue;
    const score = (tileOf(g, prop.tile).rent * (group ? 2 : 1)) / cost;
    if (!best || score > best.score) best = { prop, score, cost, group };
  }
  if (!best) return null;
  const name = tileOf(g, best.prop.tile).name;
  return {
    action: { type: 'build', tile: best.prop.tile },
    reason: best.group
      ? `${name}所在色组已凑齐，升级回报最高`
      : `${name}每投入一元的租金回报最高，升级后仍留 ${p.cash - best.cost}`,
  };
}

/** Pick a card worth playing now and its best target; the reason names only that card. */
function cardMove(g: GameState, p: PlayerState, reserve: number): BotDecision | null {
  if (p.cardPlayed || !['roll', 'manage', 'jail'].includes(g.phase)) return null;
  const foes = rivals(g, p).sort((a, b) => assetsOf(g, b) - assetsOf(g, a));
  const leader = foes[0];
  const play = (card: CardDefinition, extra: Partial<GameAction>, reason: string) => ({
    action: { type: 'playCard', cardId: card.id, ...extra } as GameAction,
    reason: `使用「${card.name}」：${reason}`,
  });
  for (const id of p.cards) {
    const card = cardById(id)!;
    if (p.jailTurns > 0 && card.category === 'move') continue;
    switch (card.effect) {
      case 'rescue':
        if (p.skipTurns > 0) return play(card, {}, '解除停留');
        continue;
      case 'shield':
        if (p.shield > 0) continue;
        return play(card, {}, '备好一次租金护盾');
      case 'taxShield':
        if (p.taxShield > 0) continue;
        return play(card, {}, '备好一次免税');
      case 'teleport':
        // In the roll phase the salary arrives and the roll still follows.
        if (g.phase === 'roll' && p.cash < reserve + 300) return play(card, {}, '回起点领薪水');
        continue;
      case 'dice': {
        if (g.phase !== 'roll') continue;
        const best = reach(g, p).sort(
          (a, b) => landingScore(g, p, b.tile) - landingScore(g, p, a.tile),
        )[0];
        if (landingScore(g, p, best.tile) < 100) continue;
        return play(
          card,
          { value: best.face },
          `点数 ${best.face} 停在${tileOf(g, best.tile).name}`,
        );
      }
      case 'move':
      case 'swap':
        continue;
      case 'remoteBuy': {
        const target = g.properties
          .filter((x) => !x.owner && p.cash - landPrice(g, x.tile) >= reserve)
          .sort(
            (a, b) => squareValue(g, b.tile, p.id, true) - squareValue(g, a.tile, p.id, true),
          )[0];
        if (target) return play(card, { tile: target.tile }, `买下${tileOf(g, target.tile).name}`);
        continue;
      }
      case 'collect':
        if (foes.length) return play(card, {}, '向对手收钱');
        continue;
      case 'cleanse':
        if (p.skipTurns > 0 || g.properties.some((x) => x.owner === p.id && x.cutUntil >= g.round))
          return play(card, {}, '清除减益');
        continue;
    }
    if (card.target === 'self') return play(card, {}, '立即获得收益');
    if (card.target === 'ownProperty') {
      const prop = g.properties
        .filter(
          (x) =>
            x.owner === p.id &&
            !x.mortgaged &&
            (card.effect !== 'upgrade' || x.level < 3) &&
            (card.effect !== 'protect' || (x.protectedUntil < g.round && x.level > 0)) &&
            (card.effect !== 'rentBoost' || x.boostUntil < g.round),
        )
        .sort((a, b) => rentOf(g, b) - rentOf(g, a))[0];
      if (prop) return play(card, { tile: prop.tile }, `作用于${tileOf(g, prop.tile).name}`);
      continue;
    }
    if (card.target === 'enemyProperty') {
      const prop = g.properties
        .filter((x) => {
          const owner = x.owner && g.players.find((y) => y.id === x.owner);
          return (
            owner &&
            isEnemy(g, p, owner) &&
            x.protectedUntil < g.round &&
            (card.effect !== 'demolish' || x.level > 0) &&
            (card.effect !== 'clearBoost' || x.boostUntil >= g.round)
          );
        })
        .sort((a, b) => rentOf(g, b) - rentOf(g, a))[0];
      if (prop) return play(card, { tile: prop.tile }, `削弱${tileOf(g, prop.tile).name}`);
      continue;
    }
    if (card.target === 'tile' && leader) {
      // Road works a few squares ahead of the leader, on a square nobody on our side owns.
      const ahead = reach(g, leader)
        .map((r) => propertyAt(g, r.tile))
        .find((x) => x && (!x.owner || x.owner === leader.id));
      if (ahead) return play(card, { tile: ahead.tile }, `在${leader.name}前方设施工点`);
      continue;
    }
    if (card.target === 'player' && leader) {
      if (card.effect === 'stealCard' && leader.cards.length === 0) continue;
      return play(card, { targetId: leader.id }, `针对领先的${leader.name}`);
    }
  }
  return null;
}

/**
 * Worth of a square to `receiver`: its price, much more if it completes the receiver's colour
 * group (rent +30% on the whole set and cheap building from then on).
 */
export function squareValue(g: GameState, tile: number, receiver: string, gaining: boolean) {
  const price = tileOf(g, tile).price;
  const group = groupLots(g, tile);
  const completes = group.every((x) => x.tile === tile || x.owner === receiver);
  // A set is worth little when there are no rounds left to collect the extra rent.
  const late = g.settings.end === 'rounds' && g.round >= g.settings.rounds - 1;
  return Math.round(price * (gaining && completes && !late ? 1.8 : 1));
}
/** Occasionally offer cash for the last square a bot needs to complete a colour group. */
function groupOffer(g: GameState, p: PlayerState): GameAction | null {
  if (g.phase !== 'manage' || g.trade) return null;
  const memo = g.tradeMemo[p.id];
  // At most one offer every three rounds, and never inside the post-rejection cooldown
  // (decisionAt is a lower bound for the current time).
  if (memo && (g.round - memo.round < 3 || memo.until > g.decisionAt)) return null;
  for (const prop of g.properties) {
    if (!prop.owner || prop.owner === p.id || prop.level || prop.mortgaged) continue;
    const owner = g.players.find((x) => x.id === prop.owner)!;
    if (owner.bankrupt || !isEnemy(g, p, owner)) continue;
    if (!groupLots(g, prop.tile).every((x) => x.tile === prop.tile || x.owner === p.id)) continue;
    const cash = Math.round((tileOf(g, prop.tile).price * 1.7) / 10) * 10;
    if (p.cash < cash + 500) continue;
    return {
      type: 'tradeOffer',
      to: owner.id,
      giveCash: cash,
      wantCash: 0,
      giveTiles: [],
      wantTiles: [prop.tile],
    };
  }
  return null;
}
