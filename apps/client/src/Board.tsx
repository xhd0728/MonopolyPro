import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  characterById,
  countryFlag,
  shortCountryName,
} from '../../../packages/content/src/index.ts';
import type {
  GameView,
  MapDefinition,
  TileDefinition,
} from '../../../packages/shared/src/index.ts';
import { groupColor, playerColor } from './game-ui.ts';
import './board.css';

/** Seal characters for corners and special squares, read like stamps in a passport. */
const SEALS: Partial<Record<TileDefinition['kind'], string>> = {
  start: '起',
  jail: '拘',
  parking: '停',
  gotojail: '遣',
  bank: '银',
  shop: '卡',
  tax: '税',
  event: '?',
  transit: '港',
};

// Ring geometry: corners are 1.5 units, the eight side squares 1 unit, 11 units in total.
const CORNER = 1.5,
  SPAN = 8 + CORNER * 2;
const cellStart = (i: number) => (i === 0 ? 0 : CORNER + i - 1);
const cellSize = (i: number) => (i === 0 || i === 9 ? CORNER : 1);
/** Centre of a grid cell as a fraction of the board side (0–1). */
export const cellCentre = (i: number) => (cellStart(i) + cellSize(i) / 2) / SPAN;
const sideOf = (t: TileDefinition) =>
  t.z === 0 && t.x > 0 && t.x < 9
    ? 'top'
    : t.x === 9 && t.z > 0 && t.z < 9
      ? 'right'
      : t.z === 9 && t.x > 0 && t.x < 9
        ? 'bottom'
        : t.x === 0 && t.z > 0 && t.z < 9
          ? 'left'
          : 'corner';

function tileCaption(t: TileDefinition, game: GameView | null | undefined) {
  switch (t.kind) {
    case 'start':
      return '经过 +300';
    case 'jail':
      return '探访 / 拘留';
    case 'parking':
      return `奖池 ${game?.pot ?? 0}`;
    case 'gotojail':
      return '前往拘留所';
    case 'bank':
      return '利息 3%';
    case 'shop':
      return '购买卡牌';
    case 'tax':
      return '缴税';
    case 'transit':
      return '船票 80';
    case 'event':
      return '抽取机遇';
    default:
      return '';
  }
}

const TileGrid = memo(function TileGrid({
  map,
  game,
  highlight,
  onTile,
}: {
  map: MapDefinition;
  game?: GameView | null;
  highlight: string;
  onTile: (i: number) => void;
}) {
  const lit = new Set(highlight ? highlight.split(',').map(Number) : []);
  const active = game?.players.find((p) => p.id === game.activeId);
  const ownerIndex = new Map(game?.players.map((p, i) => [p.id, i]) ?? []);
  const properties = new Map(game?.properties.map((p) => [p.tile, p]) ?? []);
  const occupants = new Map<number, string[]>();
  for (const p of game?.players ?? [])
    if (!p.bankrupt) occupants.set(p.position, [...(occupants.get(p.position) ?? []), p.name]);
  const gates = new Map(map.shortcuts.map(([from, to]) => [from, to]));
  const gatesOpen = map.mechanic !== 'gates' || (game?.round ?? 1) % 2 === 0;
  return (
    <>
      {map.tiles.map((t) => {
        const property = properties.get(t.index);
        const owner = property?.owner ? ownerIndex.get(property.owner) : undefined;
        const ownerName = owner === undefined ? undefined : game!.players[owner].name;
        const here = occupants.get(t.index);
        const trap = game?.traps[t.index];
        const gate = gates.get(t.index);
        const side = sideOf(t);
        return (
          <button
            key={t.index}
            data-tile={t.index}
            data-side={side}
            className={[
              'country-tile',
              t.kind,
              lit.has(t.index) && 'highlight',
              active?.position === t.index && 'current',
              property?.mortgaged && 'mortgaged',
              owner !== undefined && 'owned',
            ]
              .filter(Boolean)
              .join(' ')}
            style={
              {
                gridColumn: t.x + 1,
                gridRow: t.z + 1,
                '--group': groupColor(t.group),
                '--owner': owner === undefined ? 'transparent' : playerColor(owner),
              } as CSSProperties
            }
            onClick={() => onTile(t.index)}
            aria-label={`查看${t.name}`}
            title={[
              t.name,
              t.kind === 'property'
                ? ownerName
                  ? `${ownerName}所有，${property!.level} 级${property!.mortgaged ? '，已抵押' : `，租金 ${property!.rent}`}`
                  : `地价 ${t.price}，待售`
                : tileCaption(t, game),
              here && `此处：${here.join('、')}`,
            ]
              .filter(Boolean)
              .join('；')}
          >
            {t.kind === 'property' ? (
              <>
                <span className="tile-band">
                  {owner !== undefined && <i className="tile-owner">{owner + 1}</i>}
                  {Array.from({ length: property?.level ?? 0 }, (_, n) => (
                    <i
                      className={`tile-house ${property!.level === 3 ? 'landmark' : ''}`}
                      key={n}
                    />
                  ))}
                </span>
                <span className="tile-flag" aria-hidden="true">
                  {countryFlag(t.countryCode)}
                </span>
                <b className="tile-name">{shortCountryName(t.name)}</b>
                <span className="tile-price">
                  {property?.mortgaged
                    ? '抵押'
                    : owner !== undefined
                      ? `租 ${property!.rent}`
                      : t.price}
                </span>
              </>
            ) : (
              <>
                <span className="tile-seal" aria-hidden="true">
                  {SEALS[t.kind]}
                </span>
                <b className="tile-name">{t.name}</b>
                <span className="tile-price">{tileCaption(t, game)}</span>
              </>
            )}
            {trap && (
              <span className="tile-trap" title={`施工点：对手停靠支付 ${trap.amount}`}>
                ⚠
              </span>
            )}
            {gate !== undefined && (
              <span className={`tile-gateway ${gatesOpen ? '' : 'closed'}`} aria-hidden="true">
                {map.mechanic === 'ferry' ? '⚓' : gatesOpen ? '⇢' : '×'}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
});

// Offset (in side-square units) from a square's centre toward the ocean.
const INNER: Record<string, [number, number]> = {
  top: [0, 0.46],
  bottom: [0, -0.46],
  left: [0.5, 0],
  right: [-0.5, 0],
};
/** Pawns live above the grid so they can hop square by square without re-rendering tiles. */
function TokenLayer({
  game,
  map,
  reduced,
}: {
  game: GameView;
  map: MapDefinition;
  reduced: boolean;
}) {
  const live = game.players.filter((p) => !p.bankrupt);
  const [shown, setShown] = useState<Record<string, number>>(() =>
    Object.fromEntries(live.map((p) => [p.id, p.position])),
  );
  const [moving, setMoving] = useState<string[]>([]);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const seen = useRef({ gameId: game.id, event: game.nextEvent - 1 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const fresh =
      seen.current.gameId === game.id ? game.events.filter((e) => e.id > seen.current.event) : [];
    seen.current = { gameId: game.id, event: game.nextEvent - 1 };
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    // A fresh roll waits for the die to land before the pawn starts hopping.
    const lead = fresh.some((e) => e.kind === 'dice') && !reduced ? 520 : 0;
    const next = { ...shownRef.current };
    const hopping: string[] = [];
    for (const p of live) {
      const from = shownRef.current[p.id];
      if (from === undefined || from === p.position || reduced) {
        next[p.id] = p.position;
        continue;
      }
      let route = fresh.filter((e) => e.actor === p.id && e.path?.length).flatMap((e) => e.path!);
      if (game.pendingPath && game.activeId === p.id) route = [...route, ...game.pendingPath.path];
      const after = route.lastIndexOf(from);
      if (after >= 0) route = route.slice(after + 1);
      if (route.at(-1) !== p.position) route.push(p.position);
      const step = Math.min(190, 2400 / route.length);
      hopping.push(p.id);
      route.forEach((tile, n) =>
        timers.current.push(
          setTimeout(() => setShown((s) => ({ ...s, [p.id]: tile })), lead + n * step),
        ),
      );
      timers.current.push(
        setTimeout(
          () => setMoving((m) => m.filter((id) => id !== p.id)),
          lead + route.length * step + 120,
        ),
      );
    }
    setShown(next);
    setMoving(hopping);
  }, [game.id, game.revision, reduced]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const stacks = new Map<number, string[]>();
  for (const p of live) {
    const at = shown[p.id] ?? p.position;
    stacks.set(at, [...(stacks.get(at) ?? []), p.id]);
  }
  return (
    <div className="token-layer" aria-hidden="true">
      {live.map((p) => {
        const index = game.players.findIndex((x) => x.id === p.id);
        const tile = map.tiles[shown[p.id] ?? p.position];
        const stack = stacks.get(tile.index) ?? [p.id];
        const slot = stack.indexOf(p.id);
        // Stand on the ocean-facing half of the square so the flag and name stay readable,
        // and fan stacked pawns around that spot.
        const [ix, iy] = INNER[sideOf(tile)] ?? [
          tile.x === 0 ? 0.42 : -0.42,
          tile.z === 0 ? 0.42 : -0.42,
        ];
        const angle = (slot / stack.length) * Math.PI * 2 - Math.PI / 2;
        const spread = stack.length > 1 ? 0.22 : 0;
        return (
          <span
            key={p.id}
            className={`pawn ${game.activeId === p.id ? 'active' : ''} ${moving.includes(p.id) ? 'hopping' : ''}`}
            style={
              {
                '--cx': cellCentre(tile.x).toFixed(4),
                '--cy': cellCentre(tile.z).toFixed(4),
                '--dx': (ix + Math.cos(angle) * spread).toFixed(3),
                '--dy': (iy + Math.sin(angle) * spread).toFixed(3),
                '--pawn': playerColor(index),
                zIndex: 10 + (game.activeId === p.id ? 10 : slot),
              } as CSSProperties
            }
          >
            <span className="pawn-body">{characterById(p.characterId).icon}</span>
            <span className="pawn-number">{index + 1}</span>
          </span>
        );
      })}
    </div>
  );
}

export function Board({
  map,
  game,
  onTile,
  reduced,
  highlight = [],
  center,
}: {
  map: MapDefinition;
  game?: GameView | null;
  onTile: (i: number) => void;
  reduced: boolean;
  highlight?: number[];
  center?: ReactNode;
}) {
  const gatesOpen = map.mechanic !== 'gates' || (game?.round ?? 1) % 2 === 0;
  const at = (i: number) => map.tiles[i];
  return (
    <div className="board-frame" role="group" aria-label={`${map.name}二维国家棋盘`}>
      <div className="board-square" data-map={map.id}>
        <div className="board-ocean">
          <div className="board-center">
            {center ?? (
              <div className="board-title">
                <h2>{map.name}</h2>
                <p>{map.subtitle}</p>
                <small>
                  {map.mechanic === 'ferry'
                    ? '虚线是跨洋轮渡航线'
                    : map.mechanic === 'gates'
                      ? '虚线是丝路商路，偶数轮开放'
                      : map.mechanic === 'metro'
                        ? '虚线是国际快线，抵达岔路时自选'
                        : '顺时针前进，经过起点领取 300'}
                </small>
              </div>
            )}
          </div>
        </div>
        {map.shortcuts.length > 0 && (
          <svg
            className="route-arcs"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {map.shortcuts.map(([from, to]) => {
              const a = at(from),
                b = at(to);
              return (
                <path
                  key={from}
                  className={gatesOpen ? '' : 'closed'}
                  d={`M${cellCentre(a.x)},${cellCentre(a.z)} Q0.5,0.5 ${cellCentre(b.x)},${cellCentre(b.z)}`}
                />
              );
            })}
          </svg>
        )}
        <TileGrid map={map} game={game} highlight={highlight.join(',')} onTile={onTile} />
        {game && <TokenLayer game={game} map={map} reduced={reduced} />}
        {game && (
          <span className="sr-only">
            {game.players
              .filter((p) => !p.bankrupt)
              .map((p) => `${p.name}在${map.tiles[p.position].name}`)
              .join('；')}
          </span>
        )}
      </div>
    </div>
  );
}
