import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { serverTime, useServerNow } from './clock.tsx';
import type {
  EmoteView,
  GameView,
  MapDefinition,
  PlayerView,
  RoomView,
  SeatView,
} from '../../../packages/shared/src/index.ts';
import { characterById, countryFlag } from '../../../packages/content/src/index.ts';
import { money, pingBand, playerColor } from './game-ui.ts';
function connectionName(
  player: PlayerView,
  seat: SeatView | undefined,
  room: RoomView,
  now: number,
) {
  if (player.bankrupt) return '已破产 · 观战';
  if (seat?.bot)
    return room.aiActivity?.playerId === player.id && room.aiActivity.state === 'thinking'
      ? 'LLM 思考中'
      : room.aiActivity?.playerId === player.id &&
          room.aiActivity.state === 'fallback' &&
          now - room.aiActivity.at < 30000
        ? 'LLM · 规则回退'
        : seat.botMode === 'llm'
          ? 'LLM 机器人'
          : '规则机器人';
  if (seat?.afk) return '挂机托管中';
  if (seat?.connected) return '在线';
  return seat &&
    (seat.takeover ||
      (seat.disconnectedAt !== null && now - seat.disconnectedAt >= room.takeoverAfterMs))
    ? '断线 · 机器人托管'
    : '断线 · 等待恢复';
}
function OfflineClock({ children }: { children: (now: number) => string }) {
  return <>{children(useServerNow())}</>;
}
export const PlayerRoster = memo(function PlayerRoster({
  room,
  inspect,
  emotes = {},
}: {
  room: RoomView;
  inspect: (id: string) => void;
  emotes?: Record<string, EmoteView>;
}) {
  const g = room.game!;
  const gallery = useRef<HTMLDivElement>(null);
  const leaderWorth = Math.max(...g.players.filter((p) => !p.bankrupt).map((p) => p.assets));
  // Floating +/− on every card whenever a player's cash and savings change.
  const totals = useRef<{ gameId: string; by: Map<string, number> }>({ gameId: '', by: new Map() });
  const [deltas, setDeltas] = useState<{ key: string; id: string; amount: number }[]>([]);
  useEffect(() => {
    const now = new Map(g.players.map((p) => [p.id, p.cash + p.deposit]));
    const before = totals.current;
    if (before.gameId === g.id) {
      const added = g.players
        .map((p) => ({
          key: `${g.revision}-${p.id}`,
          id: p.id,
          amount: now.get(p.id)! - (before.by.get(p.id) ?? 0),
        }))
        .filter((d) => d.amount !== 0);
      if (added.length)
        setDeltas((list) => [...list.filter((d) => !added.some((a) => a.id === d.id)), ...added]);
    }
    totals.current = { gameId: g.id, by: now };
  }, [g.id, g.revision]);
  useEffect(() => {
    if (!deltas.length) return;
    const timer = setTimeout(() => setDeltas([]), 1900);
    return () => clearTimeout(timer);
  }, [deltas]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)');
    const showSelf = () => {
      if (!media.matches || !gallery.current) return;
      const card = gallery.current.querySelector<HTMLElement>('[data-self="true"]');
      if (card) gallery.current.scrollLeft = card.offsetLeft - gallery.current.offsetLeft;
    };
    showSelf();
    media.addEventListener('change', showSelf);
    return () => media.removeEventListener('change', showSelf);
  }, [room.viewerId, g.id]);
  return (
    <section className="player-panel" aria-label="玩家与资产">
      <div className="roster-heading">
        <h2>
          旅行伙伴 <small>{g.players.length} 人</small>
        </h2>
        <span>点击玩家查看地产与资产明细</span>
      </div>
      <div
        className="player-cards"
        ref={gallery}
        style={
          {
            '--player-count': g.players.length,
            '--compact-count': Math.min(g.players.length, 3),
          } as CSSProperties
        }
      >
        {g.players.map((p, index) => {
          const character = characterById(p.characterId),
            seat = room.seats.find((s) => s.id === p.id),
            delta = deltas.find((d) => d.id === p.id);
          return (
            <button
              key={p.id}
              data-self={p.id === room.viewerId}
              className={`player-card ${g.activeId === p.id ? 'active' : ''} ${p.bankrupt ? 'bankrupt' : ''} ${delta ? (delta.amount > 0 ? 'gain' : 'loss') : ''}`}
              style={{ '--player-color': playerColor(index) } as CSSProperties}
              onClick={() => inspect(p.id)}
              aria-label={`查看${index + 1}号玩家${p.name}的资产`}
            >
              {emotes[p.id] && (
                <span
                  key={emotes[p.id].id}
                  className="card-emote"
                  aria-label={`${p.name}发送了${emotes[p.id].emote}`}
                >
                  {emotes[p.id].emote}
                </span>
              )}
              {delta && (
                <span
                  key={delta.key}
                  className={`cash-delta ${delta.amount > 0 ? 'up' : 'down'}`}
                  aria-label={`${p.name}资金${delta.amount > 0 ? '增加' : '减少'} ${money(Math.abs(delta.amount))}`}
                >
                  {delta.amount > 0 ? '+' : '−'}
                  {money(Math.abs(delta.amount))}
                </span>
              )}
              <div className="player-card-top">
                <span className="player-number">{index + 1}</span>
                <b>
                  {p.name}
                  {p.id === room.viewerId && <em>我</em>}
                </b>
                <strong>
                  <small>净资产</small>
                  {money(p.assets)}
                </strong>
              </div>
              <div className="player-state">
                <i />
                {seat && !seat.bot && !seat.connected ? (
                  <OfflineClock>{(now) => connectionName(p, seat, room, now)}</OfflineClock>
                ) : (
                  connectionName(p, seat, room, serverTime())
                )}
                {seat?.latency !== undefined && (
                  <span className={`ping-mini ${pingBand(seat.latency)}`}> · {seat.latency}ms</span>
                )}
                {g.settings.mode === 'team' && <span> · {p.team === 0 ? '青' : '橙'}队</span>}
                {g.activeId === p.id && <b>{g.phase === 'auction' ? '正在竞拍' : '当前回合'}</b>}
              </div>
              <div className="player-metrics">
                <span>
                  现金 <b>{money(p.cash)}</b>
                </span>
                <span>
                  存款 <b>{money(p.deposit)}</b>
                </span>
              </div>
              <div className="player-inventory">
                <span>
                  地产 <b>{p.propertyCount}</b>
                </span>
                <span>
                  建筑 <b>{p.buildingCount}</b>
                </span>
                <span>
                  手牌 <b>{p.cardCount}</b>
                </span>
                {p.debt > 0 && <span className="debt-label">待付 {money(p.debt)}</span>}
                {!p.bankrupt && p.assets < leaderWorth * 0.6 && (
                  <span
                    className="catchup-label"
                    title="净资产低于领先者的 60%：经过起点多领 50%，环球补助加倍"
                  >
                    追赶中
                  </span>
                )}
              </div>
              <span className="player-last-action" title={p.lastAction ?? '尚未行动'}>
                {p.lastAction?.replace(p.name, '').replace(/^[：:，,\s]+/, '') || '等待出发'}
              </span>
              <span className="player-character">
                {character.icon} {character.name}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
});
export function PlayerDetails({
  player,
  game,
  map,
  select,
}: {
  player: PlayerView;
  game: GameView;
  map: MapDefinition;
  select: (index: number) => void;
}) {
  const owned = game.properties.filter((p) => p.owner === player.id);
  return (
    <>
      <div className="finance-summary" aria-label="资产明细">
        {[
          ['净资产', player.assets],
          ['可用现金', player.cash],
          ['银行存款', player.deposit],
          ['地产估值', player.propertyValue],
          ['待付债务', player.debt],
          ['建筑等级合计', player.buildingCount],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{money(Number(value))}</strong>
          </div>
        ))}
      </div>
      <p className="hint">
        净资产 = 现金 + 存款 + 地产估值 − 待付债务。地产按地价计，抵押地产只计赎回后的余值（地价的
        45%），建筑按建设费的 75% 计；私有手牌仅本人可见。
      </p>
      <div className="section-heading profile-properties-heading">
        <h3>国家地产</h3>
        <span>
          {owned.length} 处 · {player.cardCount} 张手牌 · {player.shield} 次护盾
        </span>
      </div>
      <div className="player-action-history">
        <h3>最近行动</h3>
        {[...game.events]
          .reverse()
          .filter((e) => e.actor === player.id && !['turn', 'start', 'move', 'ai'].includes(e.kind))
          .slice(0, 4)
          .map((e) => (
            <p key={e.id}>{e.text}</p>
          ))}
      </div>
      <div className="public-property-list">
        {owned.map((p) => (
          <button key={p.tile} onClick={() => select(p.tile)}>
            <span className="property-flag">{countryFlag(map.tiles[p.tile].countryCode)}</span>
            <span>
              <b>{map.tiles[p.tile].name}</b>
              <small>{p.mortgaged ? '已抵押 · 暂停收租' : `${p.level} 级建筑`}</small>
            </span>
            <span className="property-rent">
              租金 <b>{money(p.rent)}</b>
              <small>查看详情 ↗</small>
            </span>
          </button>
        ))}
        {!owned.length && <div className="empty-state">还没有国家地产。</div>}
      </div>
    </>
  );
}
