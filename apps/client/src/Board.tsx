import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BOARD,
  characterById,
  countryFlag,
  shortCountryName,
} from '../../../packages/content/src/index.ts';
import type {
  EmoteView,
  GameView,
  MapDefinition,
  TileDefinition,
} from '../../../packages/shared/src/index.ts';
import { groupColor, money, playerColor } from './game-ui.ts';
import './board.css';
import { play } from './sound.ts';

/** Seal characters for corners and special squares, read like stamps in a passport. */
const SEALS: Partial<Record<TileDefinition['kind'], string>> = {
  start: '起',
  jail: '拘',
  parking: '停',
  gotojail: '遣',
  bank: '银',
  shop: '卡',
  tax: '税',
  chance: '机',
  fate: '命',
  transit: '港',
};

// Ring geometry: corners are 1.5 units, the eight side squares 1 unit, 11 units in total.
// Ring geometry for a board with `side` squares per edge: corners are 1.5 units wide and the
// side squares 1 unit, so an edge spans side + 1 units.
const CORNER = 1.5;
const cellStart = (i: number) => (i === 0 ? 0 : CORNER + i - 1);
const cellSize = (i: number, side: number) => (i === 0 || i === side - 1 ? CORNER : 1);
/** Centre of a grid cell as a fraction of the board side (0–1). */
export const cellCentre = (i: number, side = 10) =>
  (cellStart(i) + cellSize(i, side) / 2) / (side + 1);
const sideOf = (t: TileDefinition, side: number) => {
  const last = side - 1;
  return t.z === 0 && t.x > 0 && t.x < last
    ? 'top'
    : t.x === last && t.z > 0 && t.z < last
      ? 'right'
      : t.z === last && t.x > 0 && t.x < last
        ? 'bottom'
        : t.x === 0 && t.z > 0 && t.z < last
          ? 'left'
          : 'corner';
};

function tileCaption(t: TileDefinition, game: GameView | null | undefined, salary: number) {
  switch (t.kind) {
    case 'start':
      return `经过 +${salary}`;
    case 'jail':
      return '探访 / 拘留';
    case 'parking':
      return `奖池 ${game?.pot ?? 0}`;
    case 'gotojail':
      return '前往拘留所';
    case 'bank':
      return `利息 ${money((game?.bankInterestRate ?? BOARD.interest) * 100)}%`;
    case 'shop':
      return '随机抽卡';
    case 'tax':
      return '缴税';
    case 'transit':
      return '船票 80';
    case 'chance':
      return '抽机会卡';
    case 'fate':
      return '抽命运卡';
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
  // This round's news may lift or cut one colour group's rent.
  const newsGroup =
    game?.news && game.news.round === game.round && game.news.group !== undefined
      ? { group: game.news.group, boom: game.news.id === 'boom' }
      : undefined;
  const forkChoices = new Set(
    game?.phase === 'path' && game.activeId === game.viewerId ? game.pendingPath!.choices : [],
  );
  return (
    <>
      {map.tiles.map((t) => {
        const property = properties.get(t.index);
        const owner = property?.owner ? ownerIndex.get(property.owner) : undefined;
        const ownerName = owner === undefined ? undefined : game!.players[owner].name;
        const here = occupants.get(t.index);
        const trap = game?.traps[t.index];
        const gate = gates.get(t.index);
        const side = sideOf(t, map.side);
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
              newsGroup?.group === t.group &&
                t.kind === 'property' &&
                (newsGroup.boom ? 'news-boom' : 'news-slump'),
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
            aria-label={forkChoices.has(t.index) ? `选择路线前往${t.name}` : `查看${t.name}`}
            title={[
              t.name,
              t.kind === 'property'
                ? ownerName
                  ? `${ownerName}所有，${property!.level} 级${property!.mortgaged ? '，已抵押' : `，租金 ${property!.rent}`}`
                  : `地价 ${t.price}，待售`
                : tileCaption(t, game, map.salary),
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
                      : (property?.price ?? t.price)}
                </span>
              </>
            ) : (
              <>
                <span className="tile-seal" aria-hidden="true">
                  {SEALS[t.kind]}
                </span>
                <b className="tile-name">{t.name}</b>
                <span className="tile-price">{tileCaption(t, game, map.salary)}</span>
              </>
            )}
            {newsGroup?.group === t.group && t.kind === 'property' && (
              <span className="tile-news" aria-hidden="true">
                {newsGroup.boom ? '旺' : '淡'}
              </span>
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
/**
 * Pawns live above the grid so they can hop square by square without re-rendering tiles.
 * Each pawn has its own queue: when bots act faster than the animation, new steps are
 * appended instead of cutting the current hop short.
 */
function TokenLayer({
  game,
  map,
  reduced,
  emotes,
}: {
  game: GameView;
  map: MapDefinition;
  reduced: boolean;
  emotes: Record<string, EmoteView>;
}) {
  const live = game.players.filter((p) => !p.bankrupt);
  const [shown, setShown] = useState<Record<string, number>>(() =>
    Object.fromEntries(live.map((p) => [p.id, p.position])),
  );
  const [moving, setMoving] = useState<string[]>([]);
  const lanes = useRef(
    new Map<
      string,
      { queue: number[]; timer?: ReturnType<typeof setTimeout>; target: number; partial?: number[] }
    >(),
  );
  const seen = useRef({ gameId: game.id, event: game.nextEvent - 1 });
  useEffect(() => {
    const sameGame = seen.current.gameId === game.id;
    const fresh = sameGame ? game.events.filter((e) => e.id > seen.current.event) : [];
    seen.current = { gameId: game.id, event: game.nextEvent - 1 };
    // A fresh roll waits for the die to land before the pawn starts hopping.
    const lead = fresh.some((e) => e.kind === 'dice') && !reduced ? 520 : 0;
    const step = (id: string) => {
      const lane = lanes.current.get(id)!;
      const next = lane.queue.shift();
      if (next === undefined) {
        lane.timer = undefined;
        setMoving((m) => m.filter((x) => x !== id));
        return;
      }
      setShown((s) => ({ ...s, [id]: next }));
      play('hop');
      // Long routes speed up so a whole move stays around two seconds.
      lane.timer = setTimeout(() => step(id), Math.min(190, 2000 / (lane.queue.length + 1)));
    };
    for (const p of live) {
      let lane = lanes.current.get(p.id);
      if (!lane || !sameGame || reduced) {
        if (lane?.timer) clearTimeout(lane.timer);
        lanes.current.set(p.id, { queue: [], target: p.position });
        setShown((s) => ({ ...s, [p.id]: p.position }));
        continue;
      }
      const pending = game.pendingPath && game.activeId === p.id ? game.pendingPath.path : [];
      if (lane.target === p.position && !pending.length) continue;
      let route = [
        ...fresh.filter((e) => e.actor === p.id && e.path?.length).flatMap((e) => e.path!),
        ...pending,
      ];
      // At a fork the partial path was already animated; skip it when the full path arrives.
      const done = lane.partial;
      if (done?.length && done.every((tile, i) => route[i] === tile))
        route = route.slice(done.length);
      lane.partial = pending.length ? pending : undefined;
      if (route.at(-1) !== p.position) route.push(p.position);
      lane.target = p.position;
      lane.queue.push(...route);
      setMoving((m) => (m.includes(p.id) ? m : [...m, p.id]));
      if (!lane.timer) {
        const id = p.id;
        lane.timer = setTimeout(() => step(id), lead);
      }
    }
  }, [game.id, game.revision, reduced]);
  useEffect(
    () => () => {
      for (const lane of lanes.current.values()) if (lane.timer) clearTimeout(lane.timer);
    },
    [],
  );
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
        const [ix, iy] = INNER[sideOf(tile, map.side)] ?? [
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
                '--cx': cellCentre(tile.x, map.side).toFixed(4),
                '--cy': cellCentre(tile.z, map.side).toFixed(4),
                '--dx': (ix + Math.cos(angle) * spread).toFixed(3),
                '--dy': (iy + Math.sin(angle) * spread).toFixed(3),
                '--pawn': playerColor(index),
                zIndex: 10 + (game.activeId === p.id ? 10 : slot),
              } as CSSProperties
            }
          >
            {emotes[p.id] && (
              <span key={emotes[p.id].id} className="pawn-emote">
                {emotes[p.id].emote}
              </span>
            )}
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
  attention = false,
  emotes = {},
}: {
  map: MapDefinition;
  game?: GameView | null;
  onTile: (i: number) => void;
  reduced: boolean;
  highlight?: number[];
  center?: ReactNode;
  /** The viewing seat must act: the board frame glows. */
  attention?: boolean;
  emotes?: Record<string, EmoteView>;
}) {
  const gatesOpen = map.mechanic !== 'gates' || (game?.round ?? 1) % 2 === 0;
  const at = (i: number) => map.tiles[i];
  return (
    <div className="board-frame" role="group" aria-label={`${map.name}二维国家棋盘`}>
      <div
        className={`board-square ${attention ? 'attention' : ''}`}
        data-map={map.id}
        data-size={map.tiles.length}
        style={
          {
            '--span': map.side + 1,
            gridTemplateColumns: `1.5fr repeat(${map.side - 2}, minmax(0, 1fr)) 1.5fr`,
            gridTemplateRows: `1.5fr repeat(${map.side - 2}, minmax(0, 1fr)) 1.5fr`,
          } as CSSProperties
        }
      >
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
                        : `顺时针前进，经过起点领取 ${map.salary}`}
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
                  d={`M${cellCentre(a.x, map.side)},${cellCentre(a.z, map.side)} Q0.5,0.5 ${cellCentre(b.x, map.side)},${cellCentre(b.z, map.side)}`}
                />
              );
            })}
          </svg>
        )}
        <TileGrid map={map} game={game} highlight={highlight.join(',')} onTile={onTile} />
        {game && <TokenLayer game={game} map={map} reduced={reduced} emotes={emotes} />}
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
