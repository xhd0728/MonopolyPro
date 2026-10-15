import { useEffect, useMemo, useState } from 'react';
import type {
  GameView,
  RoundPlayerStats,
  RoundSnapshot,
} from '../../../packages/shared/src/index.ts';
import { money, playerColor } from './game-ui.ts';

export type TrendMetric = 'assets' | 'cash' | 'rentIn' | 'netRent';
const valueOf = (p: RoundPlayerStats, metric: TrendMetric) =>
  metric === 'netRent'
    ? p.stats.rentIn - p.stats.rentOut
    : metric === 'rentIn'
      ? p.stats.rentIn
      : p[metric];
const compact = (n: number) =>
  Math.abs(n) >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(Math.round(n));
export function TrendChart({
  game,
  history,
  metric,
  selected,
  select,
}: {
  game: GameView;
  history: RoundSnapshot[];
  metric: TrendMetric;
  selected: number;
  select: (index: number) => void;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 800px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)');
    const update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const shown = game.players.filter((p) => !hidden.includes(p.id));
  const W = narrow ? 420 : 800,
    H = 260,
    L = 55,
    R = 20,
    T = 22,
    B = 34;
  const values = useMemo(
    () =>
      history.flatMap((s) =>
        s.players.filter((p) => !hidden.includes(p.id)).map((p) => valueOf(p, metric)),
      ),
    [history, hidden, metric],
  );
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values);
  const pad = (max - min) * 0.09,
    lo = min < 0 ? min - pad : 0,
    hi = max + pad;
  const x = (i: number) =>
    L +
    ((history[i].round - history[0].round) /
      Math.max(1, history.at(-1)!.round - history[0].round)) *
      (W - L - R);
  const y = (v: number) => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
  const snapshot = history[selected] ?? history.at(-1)!;
  const paths = useMemo(
    () =>
      game.players
        .map((p, index) => ({
          id: p.id,
          color: playerColor(index),
          points: history
            .map((s, i) => {
              const data = s.players.find((x) => x.id === p.id);
              return data ? `${x(i)},${y(valueOf(data, metric))}` : '';
            })
            .filter(Boolean)
            .join(' '),
        }))
        .filter((p) => !hidden.includes(p.id)),
    [history, metric, hidden, game.players, W],
  );
  const selectAt = (clientX: number, svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    const position = ((clientX - box.left) / box.width) * W;
    const nearest = history.reduce(
      (best, _, i) => (Math.abs(x(i) - position) < Math.abs(x(best) - position) ? i : best),
      0,
    );
    select(nearest);
  };
  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="每轮财务趋势图"
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse') selectAt(e.clientX, e.currentTarget);
        }}
        onClick={(e) => selectAt(e.clientX, e.currentTarget)}
      >
        {Array.from({ length: 5 }, (_, i) => {
          const v = lo + ((hi - lo) * i) / 4;
          return (
            <g key={i}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#dbe4ed" strokeDasharray="4 5" />
              <text x={L - 10} y={y(v) + 4} textAnchor="end">
                {compact(v)}
              </text>
            </g>
          );
        })}
        {paths.map((p) => (
          <polyline
            key={p.id}
            points={p.points}
            fill="none"
            stroke={p.color}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <line
          x1={x(selected)}
          x2={x(selected)}
          y1={T}
          y2={H - B}
          stroke="#173b5d"
          strokeDasharray="3 4"
        />
        {shown.map((p) => {
          const data = snapshot.players.find((x) => x.id === p.id);
          return (
            data && (
              <circle
                key={p.id}
                cx={x(selected)}
                cy={y(valueOf(data, metric))}
                r="4.5"
                fill={playerColor(game.players.findIndex((x) => x.id === p.id))}
                stroke="white"
                strokeWidth="2"
              >
                <title>
                  {p.name}：{money(valueOf(data, metric))}
                </title>
              </circle>
            )
          );
        })}
        {[...new Set([0, Math.floor((history.length - 1) / 2), history.length - 1])].map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle">
            {history[i].round === 0 ? '开局' : `第 ${history[i].round} 轮`}
          </text>
        ))}
      </svg>
      <div className="chart-legend">
        {game.players.map((p, i) => {
          const data = snapshot.players.find((x) => x.id === p.id);
          return (
            <button
              key={p.id}
              aria-pressed={!hidden.includes(p.id)}
              onClick={() =>
                setHidden((prev) =>
                  prev.includes(p.id)
                    ? prev.filter((id) => id !== p.id)
                    : prev.length < game.players.length - 1
                      ? [...prev, p.id]
                      : prev,
                )
              }
            >
              <i style={{ background: playerColor(i) }} />
              {p.name}
              <b>{data ? money(valueOf(data, metric)) : '—'}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
}
export function AssetDonut({ player }: { player: RoundPlayerStats }) {
  const parts = [
    { name: '现金', value: Math.max(0, player.cash), color: '#2c8dcc' },
    { name: '银行存款', value: Math.max(0, player.deposit), color: '#29a580' },
    { name: '地产与建筑净值', value: Math.max(0, player.propertyValue), color: '#efb342' },
  ];
  const total = parts.reduce((n, p) => n + p.value, 0),
    C = 2 * Math.PI * 70;
  let before = 0;
  return (
    <div className="donut-chart">
      <svg viewBox="0 0 210 210" role="img" aria-label="资产构成环图">
        <circle cx="105" cy="105" r="70" fill="none" stroke="#e8eef3" strokeWidth="24" />
        {parts.map((p) => {
          const dash = total ? (p.value / total) * C : 0,
            offset = -before;
          before += dash;
          return (
            <circle
              key={p.name}
              cx="105"
              cy="105"
              r="70"
              fill="none"
              stroke={p.color}
              strokeWidth="24"
              strokeDasharray={`${dash} ${C}`}
              strokeDashoffset={offset}
              transform="rotate(-90 105 105)"
            >
              <title>
                {p.name} {money(p.value)} · {total ? Math.round((p.value / total) * 100) : 0}%
              </title>
            </circle>
          );
        })}
        <text x="105" y="100" textAnchor="middle" className="donut-value">
          {money(player.assets)}
        </text>
        <text x="105" y="124" textAnchor="middle">
          净资产
        </text>
      </svg>
      <div>
        {parts.map((p) => (
          <p key={p.name}>
            <i style={{ background: p.color }} />
            <span>{p.name}</span>
            <b>{money(p.value)}</b>
            <small>{total ? Math.round((p.value / total) * 100) : 0}%</small>
          </p>
        ))}
        {player.debt > 0 && <p className="expense">待偿债务 −{money(player.debt)}</p>}
        <small className="report-note">
          占比按正资产计算，债务单列。{total === 0 ? '当前没有资产。' : ''}
        </small>
      </div>
    </div>
  );
}
export function PlayerRadar({
  game,
  snapshot,
  playerId,
}: {
  game: GameView;
  snapshot: RoundSnapshot;
  playerId: string;
}) {
  const axes = [
    { name: '净资产', get: (p: RoundPlayerStats) => p.assets },
    { name: '累计收租', get: (p: RoundPlayerStats) => p.stats.rentIn },
    { name: '购地次数', get: (p: RoundPlayerStats) => p.stats.bought },
    { name: '建设次数', get: (p: RoundPlayerStats) => p.stats.built },
    { name: '使用卡牌', get: (p: RoundPlayerStats) => p.stats.cards },
    { name: '成交交易', get: (p: RoundPlayerStats) => p.stats.trades },
  ];
  const leader = [...snapshot.players].sort((a, b) => b.assets - a.assets)[0];
  const ids = [...new Set([leader?.id, playerId])].filter(Boolean);
  const pt = (i: number, r: number) => [
    180 + Math.sin((i * Math.PI) / 3) * r,
    150 - Math.cos((i * Math.PI) / 3) * r,
  ];
  return (
    <div className="radar-chart">
      <svg viewBox="0 0 360 300" role="img" aria-label="玩家六维能力雷达图">
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <polygon
            key={r}
            points={axes.map((_, i) => pt(i, r * 95).join(',')).join(' ')}
            fill="none"
            stroke="#dce5ed"
          />
        ))}
        {axes.map((axis, i) => {
          const [x, y] = pt(i, 123);
          const [ex, ey] = pt(i, 95);
          return (
            <g key={axis.name}>
              <line x1="180" y1="150" x2={ex} y2={ey} stroke="#dce5ed" />
              <text x={x} y={y + 4} textAnchor="middle">
                {axis.name}
              </text>
            </g>
          );
        })}
        {ids.map((id) => {
          const player = snapshot.players.find((p) => p.id === id)!;
          const color = playerColor(game.players.findIndex((p) => p.id === id));
          return (
            <polygon
              key={id}
              points={axes
                .map((axis, i) =>
                  pt(
                    i,
                    (Math.max(0, axis.get(player)) /
                      Math.max(1, ...snapshot.players.map(axis.get))) *
                      95,
                  ).join(','),
                )
                .join(' ')}
              fill={color}
              fillOpacity=".13"
              stroke={color}
              strokeWidth="2.5"
            />
          );
        })}
      </svg>
      <div className="chart-legend">
        {ids.map((id) => (
          <span key={id}>
            <i style={{ background: playerColor(game.players.findIndex((p) => p.id === id)) }} />
            {game.players.find((p) => p.id === id)?.name}
            {id === leader.id ? ' · 资产领先' : ''}
          </span>
        ))}
      </div>
      <small className="report-note">
        每个维度以本轮全场最高值为 100%，表示相对表现；无该类数据时为 0。
      </small>
    </div>
  );
}
