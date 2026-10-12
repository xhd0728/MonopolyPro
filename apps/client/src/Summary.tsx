import type { CSSProperties } from 'react';
import { countryFlag } from '../../../packages/content/src/index.ts';
import type { GameView, MapDefinition, PlayerView } from '../../../packages/shared/src/index.ts';
import { money, playerColor } from './game-ui.ts';

/** Titles handed out at the end; each goes to whoever leads that statistic (ties share). */
const TITLES: { title: string; icon: string; value: (p: PlayerView) => number; unit: string }[] = [
  { title: '收租王', icon: '👑', value: (p) => p.stats.rentIn, unit: '收租' },
  { title: '地产大亨', icon: '🏙️', value: (p) => p.stats.bought, unit: '处地产' },
  { title: '建筑师', icon: '🏗️', value: (p) => p.stats.built, unit: '次升级' },
  { title: '环球旅行家', icon: '🧭', value: (p) => p.stats.laps, unit: '圈' },
  { title: '卡牌大师', icon: '🃏', value: (p) => p.stats.cards, unit: '张卡' },
  { title: '交易达人', icon: '🤝', value: (p) => p.stats.trades, unit: '笔交易' },
  { title: '最佳预言家', icon: '🔮', value: (p) => p.prophet, unit: '次猜中' },
  { title: '常驻拘留所', icon: '🚔', value: (p) => p.stats.jailed, unit: '次入狱' },
];
function titlesFor(game: GameView) {
  return TITLES.flatMap((t) => {
    const best = Math.max(0, ...game.players.map(t.value));
    if (!best) return [];
    const who = game.players.filter((p) => t.value(p) === best);
    return [{ ...t, best, who }];
  });
}
export function MatchSummary({
  game,
  map,
  isHost,
  restart,
}: {
  game: GameView;
  map: MapDefinition;
  isHost: boolean;
  restart: () => void;
}) {
  const ranked = [...game.players].sort((a, b) => b.assets - a.assets);
  const top = Math.max(1, ranked[0]?.assets ?? 1);
  const titles = titlesFor(game);
  const prized = (p: PlayerView) => {
    const owned = game.properties.filter((x) => x.owner === p.id);
    return owned.sort((a, b) => b.rent - a.rent)[0];
  };
  return (
    <section className="settlement paper" aria-label="旅程纪念册">
      <div className="eyebrow">
        旅程纪念册 · 第 {Math.min(game.round, game.settings.rounds ?? game.round)} 轮结束
      </div>
      <h2>
        {game.players
          .filter((p) => game.winners.includes(p.id))
          .map((p) => p.name)
          .join('、')}
        获胜！
      </h2>
      <p>{game.finishReason}</p>
      <div className="ranking">
        {ranked.map((p, i) => {
          const index = game.players.findIndex((x) => x.id === p.id);
          const best = prized(p);
          return (
            <div key={p.id} style={{ '--who': playerColor(index) } as CSSProperties}>
              <span>{i + 1}</span>
              <b>
                {p.name} {game.winners.includes(p.id) ? '✦' : ''}
                {p.bankrupt && <small> · 已破产</small>}
              </b>
              <strong>{money(p.assets)}</strong>
              <i className="worth-bar" aria-hidden="true">
                <i style={{ width: `${Math.max(2, (Math.max(0, p.assets) / top) * 100)}%` }} />
              </i>
              <small className="stat-line">
                收租 {money(p.stats.rentIn)} · 付租 {money(p.stats.rentOut)} · 地产{' '}
                {p.propertyCount} 处 · 升级 {p.stats.built} 次 · 绕行 {p.stats.laps} 圈 · 入狱{' '}
                {p.stats.jailed} 次
                {best && (
                  <>
                    {' '}
                    · 最赚钱：{countryFlag(map.tiles[best.tile].countryCode)}
                    {map.tiles[best.tile].name}
                  </>
                )}
                {p.stats.biggestRent > 0 && <> · 单笔最高租金 {money(p.stats.biggestRent)}</>}
              </small>
            </div>
          );
        })}
      </div>
      {titles.length > 0 && (
        <div className="titles">
          {titles.map((t) => (
            <span key={t.title}>
              {t.icon} <b>{t.title}</b> {t.who.map((p) => p.name).join('、')}
              <small>
                {t.title === '收租王' ? money(t.best) : t.best} {t.unit}
              </small>
            </span>
          ))}
        </div>
      )}
      {isHost && (
        <button className="primary" onClick={restart}>
          再开启一段旅程 →
        </button>
      )}
    </section>
  );
}
