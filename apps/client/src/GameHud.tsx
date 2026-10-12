import { useEffect, useState } from 'react';
import type { GameView, MapDefinition, RoomView } from '../../../packages/shared/src/index.ts';
import { money, playerColor } from './game-ui.ts';
import { CARDS, countryFlag, newsById } from '../../../packages/content/src/index.ts';
import './match.css';
import { ActionTicker } from './Feedback.tsx';
const pips: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
export function DiceView({ game, rolling = false }: { game: GameView; rolling?: boolean }) {
  const event = [...game.events].reverse().find((e) => e.kind === 'dice');
  const player = game.players.find((p) => p.id === event?.actor);
  const value = game.lastDice[0] ?? 0;
  const bonus = player?.characterId === 'runner' ? 1 : 0;
  const jailRoll = !!event?.text.includes('在拘留所掷出');
  const stayed = jailRoll && value < 6;
  // While a roll is pending, flicker through faces so the die visibly tumbles.
  const [spin, setSpin] = useState(1);
  useEffect(() => {
    if (!rolling) return;
    const timer = setInterval(() => setSpin((n) => (n % 6) + 1), 90);
    return () => clearInterval(timer);
  }, [rolling]);
  const face = rolling ? spin : value;
  return (
    <div
      className={`dice-stage ${rolling ? 'rolling' : ''}`}
      aria-label="骰子结果"
      aria-live="polite"
    >
      <span
        key={rolling ? 'rolling' : (event?.id ?? 0)}
        className={`dice-cube ${face ? 'rolled' : 'unrolled'} ${face === 1 || face === 4 ? 'red' : ''}`}
        aria-label={rolling ? '正在掷骰' : value ? `${value} 点` : '等待掷骰'}
      >
        {face
          ? Array.from({ length: 9 }, (_, i) => (
              <i className={pips[face]?.includes(i) ? 'pip' : ''} key={i} />
            ))
          : '?'}
      </span>
      <div className="dice-caption">
        <b>
          {rolling ? '正在掷骰…' : event ? `${player?.name ?? '玩家'}掷出 ${value} 点` : '等待掷骰'}
        </b>
        <small>
          {rolling
            ? '由服务器裁定点数'
            : stayed
              ? '没有掷出 6，本回合留在拘留所'
              : event
                ? `${jailRoll ? '出狱并' : ''}前进 ${value + bonus} 格${bonus ? '，含漫游者 +1' : ''}`
                : '每回合掷一颗六面骰'}
        </small>
      </div>
    </div>
  );
}
const explanations: Record<string, string> = {
  purchase: '买下国家后支付地价，其他玩家抵达会向你付租金。',
  rent: '租金从来访者现金转给地产主人；建筑越高，租金越高。',
  build: '建设支付现金、提高租金；仍需留钱应付对手的租金。',
  mortgage: '抵押换取现金，但会暂停收租；赎回后恢复。',
  redeem: '支付赎回费用，地产重新开始收租。',
  bank: '存取只改变现金与存款分配，存款每轮产生利息。',
  card: '卡牌会影响移动、资金或地产，已使用的效果由服务器结算。',
  trade: '双方同意后同时交换资产，任何一方拒绝都不交换。',
  auction: '公开轮流竞价，退出本次拍卖后不能再次加入。',
  bankrupt: '无法清偿债务时结束经营，仍可继续观战。',
  map: '地图捷径改变路线或提供额外掷骰机会。',
  tax: '税费交给公共资金；现金不足时进入筹款阶段。',
  reward: '奖励已计入现金，可查看玩家资产确认变化。',
  dice: '按骰子点数前进并处理落点，角色天赋可能改变步数。',
  jail: '拘留所：缴纳保释金、使用「自由通行」或掷出 6 点出狱；否则停留一回合。',
  payment: '税费、维护费和保释金进入免费停车场奖池，下一位停车的玩家全部领取。',
};
function explainEvent(event: GameView['events'][number]) {
  if (event.kind === 'card') {
    const card = CARDS.find((c) => event.text.includes(`「${c.name}」`));
    if (card) return card.description;
  }
  return explanations[event.kind] ?? '资产与局面已更新，可点击玩家或国家查看详情。';
}
export function phaseGuide(game: GameView, map: MapDefinition): { title: string; text: string } {
  const actor = game.players.find((p) => p.id === game.activeId),
    mine = actor?.id === game.viewerId;
  const prefix = mine ? '你' : (actor?.name ?? '伙伴');
  if (game.trade)
    return {
      title: `${game.players.find((p) => p.id === game.trade!.to)?.name}收到交易提案`,
      text: '先检查双方现金和地产；接受后同时交换，拒绝则资产不变。',
    };
  if (game.phase === 'purchase')
    return {
      title: `${prefix}抵达${map.tiles[actor?.position ?? 0].name}`,
      text: `地价 ${money(game.properties.find((p) => p.tile === actor?.position)?.price ?? map.tiles[actor?.position ?? 0].price)}。直接购买，或放弃购买让所有人公开竞拍。`,
    };
  if (game.phase === 'auction')
    return {
      title: `${prefix}正在竞拍${map.tiles[game.auction!.tile].name}`,
      text: `最高 ${money(game.auction!.highBid)}；本次至少加价 10。退出后不能重新出价。`,
    };
  if (game.phase === 'path')
    return {
      title: `${prefix}请选择下一段道路`,
      text: `剩余 ${game.pendingPath!.remaining} 步；高亮国家是可选入口，选路后继续移动。`,
    };
  if (game.phase === 'jail')
    return {
      title: `${prefix}被拘留在${map.tiles[actor?.position ?? 0].name}`,
      text: '掷出 6 点当场出狱；也可缴纳保释金或使用「自由通行」后正常掷骰。未出狱则本回合留下，下回合自由。',
    };
  if (game.phase === 'debt')
    return {
      title: `${prefix}需筹集 ${money(game.debt!.amount)}`,
      text: '可先取银行存款、出售建筑或抵押地产，筹齐后自动付款；无法清偿可宣布破产。',
    };
  if (game.phase === 'manage')
    return {
      title: mine ? '落点处理完成，进入经营' : `${prefix}正在经营`,
      text: mine
        ? '可建设、交易或使用卡牌；点击「结束回合」交给下一位。'
        : '对手可建设、交易和使用卡牌。你可以查看每个人的资产与最近行动。',
    };
  if (game.phase === 'finished')
    return { title: '旅程结束 · 查看结算', text: '按现金、存款和地产回收价值减去债务计算净资产。' };
  return {
    title: mine ? '轮到你了，准备出发' : `${prefix}准备掷骰`,
    text: mine
      ? '先安排卡牌或天赋，再掷骰；系统会说明落点、费用和下一步。'
      : '等待时可看国家费用与玩家资产；对手行动会实时显示在这里。',
  };
}
export interface HudAction {
  label: string;
  run: () => void;
  disabled: boolean;
}
export function MatchHud({
  room,
  map,
  rolling,
  action,
}: {
  room: RoomView;
  map: MapDefinition;
  rolling: boolean;
  action?: HudAction | null;
}) {
  const game = room.game!,
    guide = phaseGuide(game, map);
  const news = game.news && game.news.round === game.round ? newsById(game.news.id) : undefined;
  const thinking =
    room.aiActivity?.state === 'thinking'
      ? game.players.find((p) => p.id === room.aiActivity!.playerId)?.name
      : undefined;
  return (
    <div className="match-hud">
      <span className="hud-route">
        {map.name} · 第 {game.round} 轮{game.pot > 0 && <em>停车场奖池 {money(game.pot)}</em>}
      </span>
      {news && (
        <span className="hud-news" title={news.text}>
          {news.icon} 本轮新闻：{news.name}
          {game.news!.group !== undefined ? (
            <>
              {' '}
              {map.tiles
                .filter((t) => t.kind === 'property' && t.group === game.news!.group)
                .map((t) => countryFlag(t.countryCode))
                .join('')}{' '}
              租金{news.effect === 'groupBoom' ? ' +50%' : ' −40%'}
            </>
          ) : (
            <small>{news.text}</small>
          )}
        </span>
      )}
      <DiceView game={game} rolling={rolling} />
      <div className="phase-guide" aria-label="本阶段说明">
        <h3>{guide.title}</h3>
        <p>{thinking ? `${thinking}正在用 LLM 思考，服务端会校验它的选择。` : guide.text}</p>
      </div>
      {action && (
        <button
          className="hud-action"
          aria-label={`棋盘上${action.label}`}
          disabled={action.disabled}
          onClick={action.run}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
export function ActionAnnouncements({ game, enabled }: { game: GameView; enabled: boolean }) {
  return <ActionTicker game={game} enabled={enabled} explain={explainEvent} />;
}
