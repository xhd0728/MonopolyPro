import { BOARD, CARDS, characterById, mapById } from '../../../packages/content/src/index.ts';
import type { GameAction, GameState } from '../../../packages/shared/src/index.ts';
import {
  actionsFor,
  actingPlayerId,
  applyAction,
  assetsOf,
  bailOf,
  landPrice,
  newsNow,
  rentOf,
} from '../../../packages/engine/src/index.ts';

/**
 * What an AI seat sees: a compact, public-information summary of the table plus its own
 * hand, instead of the full client view (a few hundred tokens rather than many thousands).
 */
export function observe(game: GameState, seatId: string): Record<string, unknown> {
  const map = mapById(game.settings.mapId, game.settings.size);
  const me = game.players.find((p) => p.id === seatId)!;
  const square = (i: number) => `${i} ${map.tiles[i].name}`;
  const ch = characterById(me.characterId);
  const news = newsNow(game);
  const situation = (): Record<string, unknown> | undefined => {
    if (game.trade) {
      const t = game.trade;
      const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? id;
      return {
        trade: {
          from: `${t.from} ${name(t.from)}`,
          to: `${t.to} ${name(t.to)}`,
          fromGives: { cash: t.giveCash, squares: t.giveTiles.map(square) },
          fromWants: { cash: t.wantCash, squares: t.wantTiles.map(square) },
          counters: t.depth ?? 0,
        },
      };
    }
    if (game.phase === 'purchase')
      return {
        purchase: {
          square: square(me.position),
          price: landPrice(game, me.position),
          cashAfter: me.cash - landPrice(game, me.position),
          baseRent: map.tiles[me.position].rent,
        },
      };
    if (game.phase === 'auction' && game.auction)
      return {
        auction: {
          square: square(game.auction.tile),
          listPrice: map.tiles[game.auction.tile].price,
          highBid: game.auction.highBid,
          highBidder: game.auction.highBidderId,
        },
      };
    if (game.phase === 'debt' && game.debt)
      return { debt: { owe: game.debt.amount, cash: me.cash } };
    if (game.phase === 'path' && game.pendingPath)
      return {
        fork: { steps: game.pendingPath.remaining, choices: game.pendingPath.choices.map(square) },
      };
    if (game.phase === 'jail') return { jail: { bail: bailOf(game) } };
    return undefined;
  };
  return {
    round:
      game.settings.end === 'rounds'
        ? `${Math.min(game.round, game.settings.rounds)}/${game.settings.rounds}`
        : game.round,
    phase: game.phase,
    finalStretch: game.finale || undefined,
    news: news ? `${news.name}：${news.text}` : undefined,
    me: {
      id: me.id,
      character: `${ch.name}（${ch.description} 天赋：${ch.ability}）`,
      cash: me.cash,
      deposit: me.deposit,
      netWorth: assetsOf(game, me),
      at: square(me.position),
      inJail: me.jailTurns > 0 || undefined,
      shield: me.shield || undefined,
      taxWaiver: me.taxShield || undefined,
      cardPlayedThisTurn: me.cardPlayed || undefined,
      hand: me.cards.map((id) => {
        const c = CARDS.find((x) => x.id === id)!;
        return `${c.name}：${c.description}`;
      }),
      lockedCards: me.newCards.length || undefined,
    },
    others: game.players
      .filter((p) => p.id !== seatId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        team: game.settings.mode === 'team' ? p.team : undefined,
        bankrupt: p.bankrupt || undefined,
        cash: p.cash,
        deposit: p.deposit,
        netWorth: assetsOf(game, p),
        at: square(p.position),
        cards: p.cards.length + p.newCards.length,
        inJail: p.jailTurns > 0 || undefined,
      })),
    // [square, colour group, list price, owner, level, rent now, mortgaged]
    squares: game.properties.map((x) => [
      square(x.tile),
      map.tiles[x.tile].group,
      map.tiles[x.tile].price,
      x.owner,
      x.level,
      x.owner ? rentOf(game, x) : map.tiles[x.tile].rent,
      x.mortgaged || undefined,
    ]),
    situation: situation(),
    recent: game.events
      .filter((e) => !['move', 'ai', 'turn'].includes(e.kind))
      .slice(-6)
      .map((e) => e.text),
  };
}

/** One line per candidate, e.g. "购买法国（310，买后现金 2,690）". */
export function labelActions(game: GameState, seatId: string, choices: GameAction[]): string[] {
  const map = mapById(game.settings.mapId, game.settings.size);
  const me = game.players.find((p) => p.id === seatId)!;
  const options = actionsFor(game, seatId);
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? id;
  return choices.map((action) => {
    const match = options.find((o) => JSON.stringify(o.action) === JSON.stringify(action));
    if (action.type === 'playCard') {
      const card = CARDS.find((c) => c.id === action.cardId);
      const target =
        action.targetId !== undefined
          ? `，对象 ${name(action.targetId)}`
          : action.tile !== undefined
            ? `，目标 ${map.tiles[action.tile].name}`
            : action.value !== undefined
              ? `，点数 ${action.value}`
              : '';
      return `使用「${card?.name ?? action.cardId}」${target}`;
    }
    if (action.type === 'buy') {
      const price = landPrice(game, me.position);
      return `购买${map.tiles[me.position].name}（${price}，买后现金 ${me.cash - price}）`;
    }
    if (match) return match.hint ? `${match.label}（${match.hint}）` : match.label;
    return action.type;
  });
}

/** Action types an AI may write itself (beyond the listed candidates). */
const CUSTOM = new Set<GameAction['type']>(['tradeOffer', 'tradeCounter', 'bid', 'bank']);
/**
 * Check an action against the real rules without committing it. Returns null when legal,
 * otherwise the engine's reason, which goes back to the model so it can correct itself.
 */
export function validator(game: GameState, seatId: string, now: () => number) {
  return (action: GameAction, custom = false): string | null => {
    if (custom && !CUSTOM.has(action.type))
      return `自定义动作只支持 ${[...CUSTOM].join(' / ')}，其他动作请从候选中选择`;
    // One self-written offer per round, so a model cannot keep the table waiting on offers.
    if (custom && action.type === 'tradeOffer' && game.tradeMemo[seatId]?.round === game.round)
      return '本轮你已经发起过交易';
    try {
      applyAction(game, seatId, action, { now: now(), randomInt: () => 0 });
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  };
}
export const RULES_SUMMARY = `规则要点：单骰 1–6，经过起点领 ${BOARD.salary}；落在空地可买，买下后别人停留要付租金；同色组全部拥有租金 +30%，还能升级建筑（0–3 级，租金约 1 / 2.5 / 5 / 9 倍）。净资产 = 现金 + 存款 + 地产地价 + 建筑造价的 75%，结束时净资产最高者获胜，所以买地不亏净资产、建筑在收回成本前略亏。每回合最多用一张卡，新得到的卡下回合才能用。对手之间交易必须双方都付出，价值差距不超过一倍。`;
