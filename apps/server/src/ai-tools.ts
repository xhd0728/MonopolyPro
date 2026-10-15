import { CARDS, mapById } from '../../../packages/content/src/index.ts';
import type { GameAction, GameState } from '../../../packages/shared/src/index.ts';
import {
  applyAction,
  exitsFor,
  actingPlayerId,
  assetsOf,
  isEnemy,
  rentOf,
  viewFor,
} from '../../../packages/engine/src/index.ts';
import { observe } from './ai-observe.ts';
import { botDecision } from '../../../packages/engine/src/bot.ts';

/**
 * Read-only tools an AI seat may call while it thinks. Everything they return is public
 * information or the seat's own; previews never run anything random (dice, draws), so the
 * hidden deck order and future rolls cannot leak through them.
 */
export interface AiTool {
  description: string;
  purpose?: string;
  publicFacts?: (args: Record<string, unknown>, result: unknown) => string[];
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
    state: {
      description:
        '重新查看全局局面：结束条件、轮次、当前行动者、新闻、奖池、所有玩家公开财务与地块，并含自己的可用手牌',
      purpose: '核对胜利目标、全场资产分布和当前待处理事项。',
      label: () => '查看全局状态',
      run: () => observe(game, seatId),
      publicFacts: () => [
        `第 ${game.round} 轮 · ${game.phase} · 行动者 ${view.players.find((p) => p.id === actingPlayerId(game))?.name ?? '无'}`,
        `停车场奖池 ${game.pot} · 地块 ${game.properties.length}`,
        ...view.players.map(
          (p) =>
            `${p.name}：现金 ${p.cash} / 存款 ${p.deposit} / 净资产 ${p.assets} / 地产 ${p.propertyCount}`,
        ),
      ],
    },
    look_ahead: {
      description:
        '按当前地图出口与分岔枚举掷出 1–6 点（漫游者 +1）的所有落点与即时租金；不预测后续事件卡、陷阱或二次移动',
      purpose: '比较不同骰面及分岔路线的即时租金风险，决定是否需要保留现金。',
      publicFacts: (_args, result) =>
        (result as { face: number; outcomes: { square: string; rent: number }[] }[]).map(
          (x) =>
            `${x.face} 点 → ${x.outcomes.map((y) => `${y.square}（租金 ${y.rent}）`).join(' / ')}`,
        ),
      label: () => '估算前方 6 格风险',
      run: () => {
        const extra = me.characterId === 'runner' ? 1 : 0;
        return [1, 2, 3, 4, 5, 6].map((face) => {
          let positions = new Set([me.position]);
          for (let step = 0; step < face + extra; step++)
            positions = new Set([...positions].flatMap((index) => exitsFor(game, index)));
          return {
            face,
            outcomes: [...positions].map((index) => {
              const info = squareInfo(index) as Record<string, unknown>;
              return {
                index,
                square: String(info.name),
                kind: info.kind,
                owner: info.owner ?? null,
                rent: Number(info.rentIfILand ?? 0),
              };
            }),
            caveat: '仅即时落点租金；不含事件、陷阱、护盾消耗和后续移动',
          };
        });
      },
    },
    square: {
      description: '查看一个格子：{"index":格子序号}，含地主、等级、租金与同色组归属',
      purpose: '比较地价、租金与同色组归属，评估购地和建筑价值。',
      publicFacts: (args) => {
        const tile = map.tiles[Number(args.index)],
          prop = view.properties.find((p) => p.tile === Number(args.index));
        return tile
          ? [
              `格子 ${tile.index}：${tile.name}`,
              ...(prop
                ? [
                    `地主：${view.players.find((p) => p.id === prop.owner)?.name ?? '空置'} / 等级 ${prop.level}`,
                    `现租 ${prop.rent} / 地价 ${prop.price} / 升级 ${prop.upgradeCost}${prop.mortgaged ? ' / 已抵押' : ''}`,
                  ]
                : [tile.kind]),
            ]
          : ['格子序号无效'];
      },
      label: (args) => `查看${map.tiles[Number(args.index)]?.name ?? '格子'}`,
      run: (args) => squareInfo(Number(args.index)),
    },
    player: {
      description: '查看一位玩家的公开资产：{"id":玩家ID}',
      purpose: '查看对方现金、地产与队伍关系，比较经营实力。',
      publicFacts: (args) => {
        const p = view.players.find((p) => p.id === args.id);
        return p
          ? [
              `${p.name}：净资产 ${p.assets}`,
              `现金 ${p.cash} / 存款 ${p.deposit} / 地产 ${p.propertyCount} / 建筑 ${p.buildingCount}`,
            ]
          : ['玩家不存在'];
      },
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
        '预演一个候选（不含掷骰、抽卡等随机操作）：{"choice":"a2"}，编号与 act 一致，返回模拟后的现金、资产与最坏对手租金',
      purpose: '在副本上核对候选对现金与净资产的影响；不会在棋盘执行。',
      publicFacts: (_args, result) => [
        result && typeof result === 'object' && 'error' in result
          ? '该候选当前无法预演，已反馈模型；对局未改变。'
          : '服务器已在副本上预演；未改变对局。候选内容与模拟财务保留在该席位上下文中。',
      ],
      label: () => '预演一项候选',
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
                .filter(
                  (x) =>
                    x.owner &&
                    !x.mortgaged &&
                    isEnemy(
                      after,
                      p,
                      after.players.find((player) => player.id === x.owner)!,
                    ),
                )
                .map((x) => rentOf(after, x, p)),
            ),
          };
        } catch (error) {
          return { error: (error as Error).message };
        }
      },
    },
    advice: {
      description: '规则机器人的建议与理由，可作参考；choice 使用与 act 一致的 a1 格式',
      purpose: '对照本地规则策略，模型仍负责选择本次动作。',
      publicFacts: () => ['策略建议已返回模型；具体候选可能涉及未使用的手牌，因此不广播。'],
      label: () => '参考规则建议',
      run: () => {
        const d = botDecision(game, seatId);
        if (!d) return { advice: null };
        const index = choices.findIndex((c) => JSON.stringify(c) === JSON.stringify(d.action));
        return { choice: index >= 0 ? `a${index + 1}` : null, action: d.action, reason: d.reason };
      },
    },
  };
}
