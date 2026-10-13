import { CARDS, mapById } from '../../../packages/content/src/index.ts';
import type { GameAction, GameState } from '../../../packages/shared/src/index.ts';
import {
  applyAction,
  assetsOf,
  isEnemy,
  rentOf,
  viewFor,
} from '../../../packages/engine/src/index.ts';
import { botDecision } from '../../../packages/engine/src/bot.ts';

/**
 * Read-only tools an AI seat may call while it thinks. Everything they return is public
 * information or the seat's own; previews never run anything random (dice, draws), so the
 * hidden deck order and future rolls cannot leak through them.
 */
export interface AiTool {
  description: string;
  run: (args: Record<string, unknown>) => unknown;
  /** Short public label for the activity feed, e.g. "查看法国". */
  label: (args: Record<string, unknown>) => string;
}
export type AiTools = Record<string, AiTool>;

/** Card effects whose preview is fully deterministic. */
const SAFE_CARD_EFFECTS = new Set([
  'money',
  'steal',
  'deposit',
  'interest',
  'collect',
  'upgrade',
  'discount',
  'demolish',
  'rentBoost',
  'remoteBuy',
  'protect',
  'trap',
  'skip',
  'clearBoost',
  'rentCut',
  'shield',
  'cleanse',
  'insure',
  'taxShield',
]);
const SAFE_ACTIONS = new Set([
  'buy',
  'pass',
  'build',
  'downgrade',
  'mortgage',
  'redeem',
  'bank',
  'bid',
  'auctionPass',
  'bail',
  'tradeOffer',
  'tradeAccept',
  'tradeReject',
  'tradeCounter',
]);
export function previewable(action: GameAction) {
  if (action.type === 'playCard')
    return SAFE_CARD_EFFECTS.has(CARDS.find((c) => c.id === action.cardId)?.effect ?? '');
  return SAFE_ACTIONS.has(action.type);
}

export function aiTools(game: GameState, seatId: string, choices: GameAction[]): AiTools {
  const map = mapById(game.settings.mapId, game.settings.size);
  /** Public wording of a candidate. Card previews stay generic so the hand is not revealed. */
  const actionName = (action?: GameAction): string => {
    if (!action) return '无效候选';
    const square =
      'tile' in action && action.tile !== undefined ? map.tiles[action.tile]?.name : '';
    const who = (id: string) => game.players.find((p) => p.id === id)?.name ?? '对手';
    switch (action.type) {
      case 'buy':
        return `购买${map.tiles[game.players.find((p) => p.id === seatId)!.position].name}`;
      case 'pass':
        return '放弃购买';
      case 'build':
        return `升级${square}`;
      case 'downgrade':
        return `出售${square}的建筑`;
      case 'mortgage':
        return `抵押${square}`;
      case 'redeem':
        return `赎回${square}`;
      case 'bank':
        return action.direction === 'deposit' ? `存入 ${action.amount}` : `取出 ${action.amount}`;
      case 'bid':
        return `出价 ${action.amount}`;
      case 'auctionPass':
        return '退出竞拍';
      case 'bail':
        return '缴纳保释金';
      case 'tradeOffer':
        return `向${who(action.to)}提出交易`;
      case 'tradeAccept':
        return '接受交易';
      case 'tradeReject':
        return '拒绝交易';
      case 'tradeCounter':
        return '还价';
      case 'playCard':
        return '使用一张手牌';
      default:
        return action.type;
    }
  };
  const view = viewFor(game, seatId);
  const me = game.players.find((p) => p.id === seatId)!;
  const squareInfo = (index: number) => {
    const tile = map.tiles[index];
    if (!tile) return { error: '没有这个格子' };
    const prop = view.properties.find((p) => p.tile === index);
    const group = prop
      ? view.properties
          .filter((p) => map.tiles[p.tile].group === tile.group)
          .map((p) => ({ name: map.tiles[p.tile].name, owner: p.owner, level: p.level }))
      : undefined;
    return {
      index,
      name: tile.name,
      kind: tile.kind,
      ...(prop
        ? {
            owner: prop.owner,
            level: prop.level,
            mortgaged: prop.mortgaged,
            price: prop.price,
            rentNow: prop.rent,
            rentIfILand: prop.payableRent,
            upgradeCost: prop.upgradeCost,
            group,
          }
        : {}),
    };
  };
  return {
    look_ahead: {
      description: '我掷出 1–6 点（漫游者 +1）各会停在哪里、需付多少租金',
      label: () => '估算前方 6 格风险',
      run: () => {
        const extra = me.characterId === 'runner' ? 1 : 0;
        return [1, 2, 3, 4, 5, 6].map((face) => {
          const index = (me.position + face + extra) % map.tiles.length;
          const info = squareInfo(index) as Record<string, unknown>;
          return {
            face,
            square: info.name,
            kind: info.kind,
            owner: info.owner ?? null,
            rent: info.rentIfILand ?? 0,
          };
        });
      },
    },
    square: {
      description: '查看一个格子：{"index":格子序号}，含地主、等级、租金与同色组归属',
      label: (args) => `查看${map.tiles[Number(args.index)]?.name ?? '格子'}`,
      run: (args) => squareInfo(Number(args.index)),
    },
    player: {
      description: '查看一位玩家的公开资产：{"id":玩家ID}',
      label: (args) => `查看${game.players.find((p) => p.id === args.id)?.name ?? '玩家'}`,
      run: (args) => {
        const p = view.players.find((x) => x.id === args.id);
        if (!p) return { error: '没有这位玩家' };
        return {
          id: p.id,
          name: p.name,
          cash: p.cash,
          deposit: p.deposit,
          assets: p.assets,
          position: map.tiles[p.position].name,
          squares: view.properties
            .filter((x) => x.owner === p.id)
            .map((x) => `${map.tiles[x.tile].name}·${x.level}级`),
          cardCount: p.cardCount,
          inJail: p.jailTurns > 0,
          opponent: isEnemy(
            game,
            me,
            game.players.find((x) => x.id === p.id)!,
          ),
        };
      },
    },
    preview: {
      description:
        '预演一个候选（不含掷骰、抽卡等随机操作）：{"choice":候选序号}，返回执行后的我方现金与资产',
      label: (args) => `预演：${actionName(choices[Number(args.choice)])}`,
      run: (args) => {
        const action = choices[Number(args.choice)];
        if (!action) return { error: '没有这个候选' };
        if (!previewable(action)) return { error: '这个候选含随机结果，无法预演' };
        try {
          const after = applyAction(game, seatId, action, {
            now: game.decisionAt,
            randomInt: () => 0,
          });
          const p = after.players.find((x) => x.id === seatId)!;
          return {
            cash: p.cash,
            deposit: p.deposit,
            assets: assetsOf(after, p),
            squares: after.properties.filter((x) => x.owner === seatId).length,
            phase: after.phase,
            worstRivalRent: Math.max(
              0,
              ...after.properties
                .filter((x) => x.owner && x.owner !== seatId && !x.mortgaged)
                .map((x) => rentOf(after, x, p)),
            ),
          };
        } catch (error) {
          return { error: (error as Error).message };
        }
      },
    },
    advice: {
      description: '规则机器人的建议与理由，可作参考',
      label: () => '参考规则建议',
      run: () => {
        const d = botDecision(game, seatId);
        if (!d) return { advice: null };
        const index = choices.findIndex((c) => JSON.stringify(c) === JSON.stringify(d.action));
        return { choice: index >= 0 ? index : null, action: d.action, reason: d.reason };
      },
    },
  };
}
