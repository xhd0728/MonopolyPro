import { useEffect, useRef, useState } from 'react';
import type { GameView, MapDefinition, RoomView } from '../../../packages/shared/src/index.ts';
import { money, playerColor } from './game-ui.ts';
import { CARDS } from '../../../packages/content/src/index.ts';
import './match.css';
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
  return (
    <div
      className={`dice-stage ${rolling ? 'rolling' : ''}`}
      aria-label="骰子结果"
      aria-live="polite"
      key={event?.id ?? 0}
    >
      <div className="dice-caption">
        <b>{rolling ? '正在掷骰' : event ? `${player?.name ?? '玩家'}的骰子` : '掷骰出发'}</b>
        <small>
          {event ? `前进 ${value + bonus} 格${bonus ? '（天赋 +1）' : ''}` : '服务端裁定点数'}
        </small>
      </div>
      <div className="dice-pair">
        <span
          className={`dice-cube ${value ? 'rolled' : 'unrolled'}`}
          aria-label={value ? `${value} 点` : '等待掷骰'}
        >
          {value
            ? Array.from({ length: 9 }, (_, i) => (
                <i className={pips[value]?.includes(i) ? 'pip' : ''} key={i} />
              ))
            : '?'}
        </span>
      </div>
      <strong className="dice-total">
        {event ? value : '—'}
        <small>点数</small>
      </strong>
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
      text: `地价 ${money(map.tiles[actor?.position ?? 0].price)}。直接购买，或放弃购买让所有人公开竞拍。`,
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
export function MatchHud({
  room,
  map,
  rolling,
  compact = false,
}: {
  room: RoomView;
  map: MapDefinition;
  rolling: boolean;
  compact?: boolean;
}) {
  const game = room.game!,
    guide = phaseGuide(game, map);
  const latest = [...game.events]
    .reverse()
    .find((e) => e.actor && !['turn', 'start', 'move', 'ai'].includes(e.kind));
  const playerIndex = game.players.findIndex((p) => p.id === latest?.actor);
  return (
    <div className={`match-hud ${compact ? 'hud-compact' : ''}`}>
      <DiceView game={game} rolling={rolling} />
      {!compact && (
        <div className="phase-guide" aria-label="本阶段说明">
          <span className="eyebrow">
            {game.players.find((p) => p.id === game.activeId)?.id === game.viewerId
              ? '你的下一步'
              : '回合进行中'}
          </span>
          <h3>{guide.title}</h3>
          <p>{guide.text}</p>
        </div>
      )}
      {!compact && room.aiActivity?.state === 'thinking' && (
        <div className="ai-thinking" role="status">
          ✦ {game.players.find((p) => p.id === room.aiActivity!.playerId)?.name} · LLM 正在思考
        </div>
      )}
      {!compact && latest && (
        <div
          className="recent-action"
          style={{ borderLeftColor: playerColor(Math.max(0, playerIndex)) }}
          role="status"
        >
          <small>刚刚发生</small>
          <b>{latest.text}</b>
          {latest.amount !== undefined && (
            <strong className={latest.amount < 0 ? 'expense' : 'income'}>
              {latest.amount > 0 ? '+' : ''}
              {money(latest.amount)}
            </strong>
          )}
          <p>{explainEvent(latest)}</p>
        </div>
      )}
    </div>
  );
}
export function ActionAnnouncements({ game, enabled }: { game: GameView; enabled: boolean }) {
  const seen = useRef({ gameId: game.id, event: game.nextEvent - 1 });
  const [messages, setMessages] = useState<GameView['events']>([]);
  useEffect(() => {
    if (seen.current.gameId !== game.id) {
      seen.current = { gameId: game.id, event: game.nextEvent - 1 };
      setMessages([]);
      return;
    }
    const added = game.events.filter(
      (e) =>
        e.id > seen.current.event && e.actor && !['turn', 'start', 'move', 'ai'].includes(e.kind),
    );
    seen.current.event = game.nextEvent - 1;
    if (added.length) setMessages(added.slice(-2));
  }, [game.id, game.revision]);
  useEffect(() => {
    if (!messages.length) return;
    const timer = setTimeout(() => setMessages([]), 5500);
    return () => clearTimeout(timer);
  }, [messages]);
  if (!enabled || !messages.length) return null;
  return (
    <div className="action-announcements" aria-live="polite" aria-label="实时行动提示">
      {messages.map((e) => (
        <div key={e.id}>
          <span>{e.actor === game.viewerId ? '你的行动' : '对手行动'}</span>
          <b>{e.text}</b>
          {e.amount !== undefined && (
            <strong className={e.amount < 0 ? 'expense' : 'income'}>
              {e.amount > 0 ? '+' : ''}
              {money(e.amount)}
            </strong>
          )}
          <p>{explainEvent(e)}</p>
        </div>
      ))}
    </div>
  );
}
