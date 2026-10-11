import { cardById } from '../../content/src/index.ts';
import type { GameAction, GameState } from '../../shared/src/index.ts';
import { actionsFor, actingPlayerId, assetsOf, propertyAt } from './index.ts';

/** Uses only public opponent information and this seat's own cards. No network/LLM calls. */
export function botAction(g: GameState, id: string): GameAction | null {
  const p = g.players.find(x => x.id === id);
  if (!p || p.bankrupt || g.phase === 'finished') return null;
  if (g.trade?.to === id) {
    const trade = g.trade;
    const value = (index: number | null) => index === null ? 0 : (g.properties.find(x => x.tile === index) ? 250 : 0);
    return { type: trade.giveCash + value(trade.giveTile) >= trade.wantCash + value(trade.wantTile) ? 'tradeAccept' : 'tradeReject' };
  }
  if (actingPlayerId(g) !== id) return null;
  const options = actionsFor(g, id);
  if (g.phase === 'auction') { const bid = options.find(x => x.action.type === 'bid'); return bid && g.auction!.highBid < Math.min(300, Math.floor(p.cash * .25)) ? bid.action : { type: 'auctionPass' }; }
  if (g.phase === 'debt') {
    return options.find(x => x.action.type === 'bank')?.action ?? options.find(x => x.action.type === 'downgrade')?.action ?? options.find(x => x.action.type === 'mortgage')?.action ?? { type: 'surrender' };
  }
  if (g.phase === 'purchase') return p.cash > 600 && options.some(x => x.action.type === 'buy') ? { type: 'buy' } : { type: 'pass' };
  if (g.phase === 'path') return options[0]?.action ?? null;
  const ability = options.find(x => x.action.type === 'ability');
  if (ability) return ability.action;
  for (const id of p.cards) {
    const card = cardById(id)!;
    if (card.target === 'self' && !['move','teleport','dice'].includes(card.effect)) return { type: 'playCard', cardId: id };
    if (card.target === 'ownProperty') {
      const prop = g.properties.find(x => x.owner === p.id && !x.mortgaged && (card.effect !== 'upgrade' || x.level < 3) && (card.effect !== 'protect' || x.protectedUntil < g.round) && (card.effect !== 'rentBoost' || x.boostUntil < g.round));
      if (prop) return { type: 'playCard', cardId: id, tile: prop.tile };
    }
    if (card.target === 'player') {
      const opponent = g.players.filter(x => !x.bankrupt && x.id !== p.id && (g.settings.mode !== 'team' || x.team !== p.team)).sort((a,b) => assetsOf(g,b)-assetsOf(g,a))[0];
      if (opponent && (card.effect !== 'stealCard' || opponent.cards.length > 0) && p.cards.length < 8) return { type: 'playCard', cardId: id, targetId: opponent.id };
    }
  }
  const build = options.find(x => x.action.type === 'build' && p.cash > 1000 && propertyAt(g,x.action.tile)!.level < 2);
  if (build) return build.action;
  return options.find(x => x.primary)?.action ?? null;
}
