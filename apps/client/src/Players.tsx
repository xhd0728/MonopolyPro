import { useEffect, useRef, type CSSProperties } from 'react';
import type {
  GameView,
  MapDefinition,
  PlayerView,
  RoomView,
  SeatView,
} from '../../../packages/shared/src/index.ts';
import { characterById, countryFlag } from '../../../packages/content/src/index.ts';
import { money, playerColor } from './game-ui.ts';
function connectionName(
  player: PlayerView,
  seat: SeatView | undefined,
  room: RoomView,
  now: number,
) {
  if (player.bankrupt) return '已破产 · 观战';
  if (seat?.bot) return '机器人';
  if (seat?.connected) return '在线';
  return seat &&
    (seat.takeover ||
      (seat.disconnectedAt !== null && now - seat.disconnectedAt >= room.takeoverAfterMs))
    ? '断线 · 机器人托管'
    : '断线 · 等待恢复';
}
export function PlayerRoster({
  room,
  now,
  inspect,
}: {
  room: RoomView;
  now: number;
  inspect: (id: string) => void;
}) {
  const g = room.game!;
  const gallery = useRef<HTMLDivElement>(null);
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
            seat = room.seats.find((s) => s.id === p.id);
          return (
            <button
              key={p.id}
              data-self={p.id === room.viewerId}
              className={`player-card ${g.activeId === p.id ? 'active' : ''} ${p.bankrupt ? 'bankrupt' : ''}`}
              style={{ '--player-color': playerColor(index) } as CSSProperties}
              onClick={() => inspect(p.id)}
              aria-label={`查看${index + 1}号玩家${p.name}的资产`}
            >
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
                {connectionName(p, seat, room, now)}
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
              </div>
              <span className="player-character">
                {character.icon} {character.name}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
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
          ['地产回收价值', player.propertyValue],
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
        净资产 = 现金 + 存款 + 地产及建筑回收价值 − 待付债务。抵押地产回收价值为
        0；私有手牌仅本人可见。
      </p>
      <div className="section-heading profile-properties-heading">
        <h3>国家地产</h3>
        <span>
          {owned.length} 处 · {player.cardCount} 张手牌 · {player.shield} 次护盾
        </span>
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
