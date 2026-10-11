import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { countryFlag } from '../../../packages/content/src/index.ts';
import type { GameView, MapDefinition } from '../../../packages/shared/src/index.ts';
import { playerColor } from './game-ui.ts';
const groupColors = ['#d5b67e', '#83a9b9', '#94b08b', '#af9abd'];
const symbols = {
  start: '↗',
  bank: '▤',
  shop: '♧',
  hospital: '☕',
  tax: '¤',
  event: '✦',
  transit: '⚓',
  property: '',
};
export function Board({
  map,
  game,
  onTile,
  follow,
  reduced,
  highlight = [],
}: {
  map: MapDefinition;
  game?: GameView | null;
  onTile: (i: number) => void;
  follow: boolean;
  reduced: boolean;
  highlight?: number[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 620));
    observer.observe(root.current!);
    return () => observer.disconnect();
  }, []);
  const active = game?.players.find((p) => p.id === game.activeId);
  useEffect(() => {
    if (!follow || !compact || !active) return;
    const element = root.current?.querySelector<HTMLElement>(`[data-tile="${active.position}"]`);
    if (!element || !root.current) return;
    // Scroll the board's own viewport, without moving the page or covering another panel.
    root.current.scrollTo({
      top: Math.max(
        0,
        element.offsetTop - root.current.clientHeight / 2 + element.clientHeight / 2,
      ),
      behavior: reduced ? 'instant' : 'smooth',
    });
  }, [active?.position, active?.id, compact, follow, reduced]);
  const columns = compact ? 4 : 8,
    rows = compact ? 7 : 8;
  const point = (i: number) => {
    if (!compact) return { x: map.tiles[i].x, y: map.tiles[i].z };
    const row = Math.floor(i / 4);
    return { x: row % 2 ? 3 - (i % 4) : i % 4, y: row };
  };
  const shortcuts =
    map.mechanic === 'metro'
      ? [
          [9, 18],
          [23, 4],
        ]
      : map.mechanic === 'gates'
        ? [
            [9, 20],
            [23, 6],
          ]
        : map.mechanic === 'ferry'
          ? [[11, 25]]
          : [];
  const open = map.mechanic !== 'gates' || (game?.round ?? 1) % 2 === 0;
  return (
    <div
      ref={root}
      className={`board-canvas board-viewport ${compact ? 'compact' : ''}`}
      role="group"
      aria-label={`${map.name}二维国家棋盘`}
    >
      <div
        className="country-board"
        style={{ '--columns': columns, '--rows': rows } as CSSProperties}
      >
        <svg
          className="route-lines"
          viewBox={`0 0 ${columns * 100} ${rows * 100}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id={`arrow-${map.id}`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0 0L8 4L0 8" fill="#a6b5ac" />
            </marker>
          </defs>
          {map.tiles.map((t, i) => {
            const a = point(i),
              b = point((i + 1) % 28);
            if (compact && i === 27) return null;
            return (
              <line
                key={i}
                x1={a.x * 100 + 50}
                y1={a.y * 100 + 50}
                x2={b.x * 100 + 50}
                y2={b.y * 100 + 50}
                markerEnd={`url(#arrow-${map.id})`}
              />
            );
          })}
          {!compact &&
            shortcuts.map(([from, to]) => {
              const a = point(from),
                b = point(to);
              return (
                <path
                  key={from}
                  className={`shortcut ${open ? '' : 'closed'}`}
                  d={`M${a.x * 100 + 50},${a.y * 100 + 50} Q400,400 ${b.x * 100 + 50},${b.y * 100 + 50}`}
                />
              );
            })}
        </svg>
        {!compact && (
          <div className="board-center">
            <span className="board-compass" aria-hidden="true">
              ✥
            </span>
            <small>MONOPOLY PRO</small>
            <h2>{map.name}</h2>
            <p>{map.subtitle}</p>
            <div className="board-legend">
              <span>
                <i style={{ background: groupColors[0] }} />
                同色国家组成地产组
              </span>
              <span>⌂ 建筑 0–3 级 · 点击查看详情</span>
            </div>
            {shortcuts.length > 0 && (
              <div className="route-guide">
                <b>
                  {map.mechanic === 'ferry'
                    ? '轮渡 · 80 金币'
                    : map.mechanic === 'gates'
                      ? `商路${open ? '开放' : '关闭'} · 偶数轮开放`
                      : '国际快线 · 自选岔路'}
                </b>
                {shortcuts.map(([from, to]) => (
                  <span key={from}>
                    {map.tiles[from].name} ⇢ {map.tiles[to].name}
                  </span>
                ))}
              </div>
            )}
            <span className="board-center-note">经过起点 +300 · 最后经营者 / 限时资产胜出</span>
          </div>
        )}
        {map.tiles.map((t) => {
          const pos = point(t.index),
            property = game?.properties.find((p) => p.tile === t.index);
          const ownerIndex = game?.players.findIndex((p) => p.id === property?.owner) ?? -1;
          const owner = ownerIndex >= 0 ? game?.players[ownerIndex] : undefined;
          const occupants =
            game?.players.filter((p) => !p.bankrupt && p.position === t.index) ?? [];
          const gateway = shortcuts.find(([from]) => from === t.index);
          return (
            <button
              key={t.index}
              data-tile={t.index}
              className={`country-tile ${t.kind} ${highlight.includes(t.index) ? 'highlight' : ''} ${active?.position === t.index ? 'current' : ''} ${property?.mortgaged ? 'mortgaged' : ''}`}
              style={
                {
                  gridColumn: pos.x + 1,
                  gridRow: pos.y + 1,
                  '--group-color': groupColors[t.group],
                  '--owner-color': ownerIndex < 0 ? 'transparent' : playerColor(ownerIndex),
                } as CSSProperties
              }
              onClick={() => onTile(t.index)}
              aria-label={`查看${t.name}`}
              title={`${t.name}${t.kind === 'property' ? ` · 地价 ${t.price}${owner ? ` · ${owner.name}所有 · ${property?.level}级` : ' · 待售'}` : ''}`}
            >
              <span className="tile-number">{String(t.index).padStart(2, '0')}</span>
              <span className="tile-flag" aria-hidden="true">
                {countryFlag(t.countryCode) || symbols[t.kind]}
              </span>
              <b className="tile-name">{t.name}</b>
              <span className="tile-price">
                {t.kind === 'property'
                  ? `¤ ${t.price}`
                  : t.kind === 'start'
                    ? '+300'
                    : t.kind === 'transit'
                      ? '船票 80'
                      : t.kind === 'bank'
                        ? '利息 3%'
                        : t.kind === 'tax'
                          ? '税费'
                          : t.kind === 'shop'
                            ? '购买卡牌'
                            : t.kind === 'hospital'
                              ? '+80'
                              : '抽取机遇'}
              </span>
              {property && (
                <span className="tile-owner">
                  {owner
                    ? `${owner.name}${property.mortgaged ? ' · 抵押' : ` · ${'▮'.repeat(property.level) || '空地'}`}`
                    : '待售'}
                </span>
              )}
              {gateway && (
                <span className={`tile-gateway ${open ? '' : 'closed'}`}>
                  {map.mechanic === 'ferry' ? '⚓' : open ? '⇢' : '×'}{' '}
                  {gateway[1].toString().padStart(2, '0')}
                </span>
              )}
              {occupants.length > 0 && (
                <span className="pawn-stack">
                  {occupants.map((p) => (
                    <span
                      key={p.id}
                      className={`flat-pawn ${active?.id === p.id ? 'active' : ''}`}
                      style={{
                        background: playerColor(game!.players.findIndex((x) => x.id === p.id)),
                      }}
                      title={p.name}
                      aria-label={`${p.name}在${t.name}`}
                    >
                      {game!.players.findIndex((x) => x.id === p.id) + 1}
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {compact && (
        <div className="compact-route-guide">
          {map.mechanic === 'none'
            ? '按编号前进，27 → 00 回到起点。'
            : `${map.mechanic === 'ferry' ? '轮渡 80 金币' : map.mechanic === 'gates' ? `商路${open ? '开放' : '关闭'}（偶数轮开放）` : '岔路可选快线'} · ${shortcuts.map(([from, to]) => `${String(from).padStart(2, '0')} → ${String(to).padStart(2, '0')}`).join(' / ')}`}
          <span>上下滑动看国家 · 点击查看费用与归属</span>
        </div>
      )}
    </div>
  );
}
