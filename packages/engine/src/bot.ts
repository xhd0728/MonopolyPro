import { cardById, mapById } from '../../content/src/index.ts';
import type { GameAction, GameState, PlayerState } from '../../shared/src/index.ts';
import { actionsFor, actingPlayerId, assetsOf, bailOf, propertyAt } from './index.ts';

/** Uses only public opponent information and this seat's own cards. No network/LLM calls. */
export function botAction(g: GameState, id: string): GameAction | null {
  const p = g.players.find((x) => x.id === id);
  if (!p || p.bankrupt || g.phase === 'finished') return null;
  if (g.trade?.to === id) {
    const t = g.trade;
    // What the bot receives versus what it gives, valuing colour-group effects.
    const gets = t.giveCash + t.giveTiles.reduce((n, x) => n + squareValue(g, x, id, true), 0);
    const pays = t.wantCash + t.wantTiles.reduce((n, x) => n + squareValue(g, x, t.from, true), 0);
    return { type: gets >= pays * 1.08 + 20 ? 'tradeAccept' : 'tradeReject' };
  }
  if (actingPlayerId(g) !== id) return null;
  const options = actionsFor(g, id);
  if (g.phase === 'auction') {
    const bid = options.find((x) => x.action.type === 'bid');
    return bid && g.auction!.highBid < Math.min(300, Math.floor(p.cash * 0.25))
      ? bid.action
      : { type: 'auctionPass' };
  }
  if (g.phase === 'debt') {
    return (
      options.find((x) => x.action.type === 'bank')?.action ??
      options.find((x) => x.action.type === 'downgrade')?.action ??
      options.find((x) => x.action.type === 'mortgage')?.action ?? { type: 'surrender' }
    );
  }
  if (g.phase === 'purchase')
    return p.cash > 600 && options.some((x) => x.action.type === 'buy')
      ? { type: 'buy' }
      : { type: 'pass' };
  if (g.phase === 'jail') {
    const rescue = p.cards.find((c) => cardById(c)?.effect === 'rescue');
    if (rescue && !p.cardPlayed) return { type: 'playCard', cardId: rescue };
    // Leaving early matters most while unowned land is still on the board.
    const landLeft = g.properties.some((x) => !x.owner);
    return p.cash >= bailOf(g) + (landLeft ? 500 : 1500) &&
      options.some((x) => x.action.type === 'bail')
      ? { type: 'bail' }
      : { type: 'jailRoll' };
  }
  if (g.phase === 'path')
    return (
      [...options].sort((a, b) => {
        const value = (x: typeof a) => {
          const tile = 'tile' in x.action ? (x.action.tile ?? 0) : 0;
          const prop = propertyAt(g, tile);
          return prop?.owner === id ? -100 : prop?.owner ? prop.level * 100 : 0;
        };
        return value(a) - value(b);
      })[0]?.action ?? null
    );
  const ability = options.find((x) => x.action.type === 'ability');
  if (ability) return ability.action;
  // One card per turn; cards gained this turn are not in `cards` yet.
  for (const id of p.cardPlayed ? [] : p.cards) {
    const card = cardById(id)!;
    if (p.jailTurns > 0 && card.category === 'move') continue;
    // Keep the jail key for when it is needed.
    if (card.effect === 'rescue' && p.skipTurns === 0 && p.jailTurns === 0) continue;
    if (card.effect === 'shield' && p.shield > 0) continue;
    if (card.effect === 'taxShield' && p.taxShield > 0) continue;
    if (card.target === 'self' && !['move', 'teleport', 'dice'].includes(card.effect))
      return { type: 'playCard', cardId: id };
    if (card.target === 'ownProperty') {
      const prop = g.properties.find(
        (x) =>
          x.owner === p.id &&
          !x.mortgaged &&
          (card.effect !== 'upgrade' || x.level < 3) &&
          (card.effect !== 'protect' || x.protectedUntil < g.round) &&
          (card.effect !== 'rentBoost' || x.boostUntil < g.round),
      );
      if (prop) return { type: 'playCard', cardId: id, tile: prop.tile };
    }
    if (card.target === 'player') {
      const opponent = g.players
        .filter(
          (x) => !x.bankrupt && x.id !== p.id && (g.settings.mode !== 'team' || x.team !== p.team),
        )
        .sort((a, b) => assetsOf(g, b) - assetsOf(g, a))[0];
      if (
        opponent &&
        (card.effect !== 'stealCard' || opponent.cards.length > 0) &&
        (card.effect !== 'swap' || opponent.jailTurns === 0)
      )
        return { type: 'playCard', cardId: id, targetId: opponent.id };
    }
  }
  // A blind draw at the market when cash is comfortable.
  const draw = options.find((x) => x.action.type === 'buyCard');
  if (draw && p.cash > 900) return draw.action;
  const offer = groupOffer(g, p);
  if (offer) return offer;
  const build = options.find(
    (x) => x.action.type === 'build' && p.cash > 1000 && propertyAt(g, x.action.tile)!.level < 2,
  );
  if (build) return build.action;
  return options.find((x) => x.primary)?.action ?? null;
}

const groupOf = (g: GameState, tile: number) =>
  mapById(g.settings.mapId, g.settings.size).tiles[tile].group;
/**
 * Worth of a square to `receiver`: its price, much more if it completes the receiver's colour
 * group (rent +30% on the whole set and cheap building from then on).
 */
export function squareValue(g: GameState, tile: number, receiver: string, gaining: boolean) {
  const price = mapById(g.settings.mapId, g.settings.size).tiles[tile].price;
  const group = g.properties.filter((x) => groupOf(g, x.tile) === groupOf(g, tile));
  const completes = group.every((x) => x.tile === tile || x.owner === receiver);
  return Math.round(price * (gaining && completes ? 1.8 : 1));
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
    if (owner.bankrupt || (g.settings.mode === 'team' && owner.team === p.team)) continue;
    const group = g.properties.filter((x) => groupOf(g, x.tile) === groupOf(g, prop.tile));
    if (!group.every((x) => x.tile === prop.tile || x.owner === p.id)) continue;
    const price = mapById(g.settings.mapId, g.settings.size).tiles[prop.tile].price;
    const cash = Math.round((price * 1.7) / 10) * 10;
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
