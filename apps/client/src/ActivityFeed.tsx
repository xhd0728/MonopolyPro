import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CARDS, countryFlag, deckCardById, newsById } from '../../../packages/content/src/index.ts';
import type {
  GameEvent,
  GameView,
  MapDefinition,
  RoomView,
} from '../../../packages/shared/src/index.ts';
import { Clock } from './clock.tsx';
import { money, playerColor } from './game-ui.ts';

/** Fallback icon per event kind when no card, news or country flag applies. */
const KIND_ICONS: Record<string, string> = {
  start: '🧭',
  purchase: '🏠',
  build: '🏗',
  downgrade: '🏚',
  mortgage: '📄',
  redeem: '🔓',
  payment: '💸',
  debt: '⚠️',
  money: '💰',
  bank: '🏦',
  card: '🃏',
  shield: '🛡',
  ability: '✨',
  skip: '⏳',
  jail: '🚔',
  map: '🗺',
  trade: '⇄',
  news: '📰',
  guess: '🎯',
  bankrupt: '💥',
  finish: '🏁',
  ai: '🤖',
  move: '👣',
  dice: '🎲',
  auction: '🔨',
  bid: '🙋',
};
type Filter = 'all' | 'key' | 'mine';
const FILTERS: [Filter, string][] = [
  ['all', '全部'],
  ['key', '重要'],
  ['mine', '与我相关'],
];
const HIDDEN = new Set(['move']);

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 8) return '刚刚';
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} 分钟前` : `${Math.floor(m / 60)} 小时前`;
}

interface Row {
  e: GameEvent;
  icon: string;
  title?: string;
  body: string;
  /** An AI seat's reason for this move, folded in from the 'ai' event that follows it. */
  why?: string;
  detail?: string;
}
function describe(e: GameEvent, game: GameView, map: MapDefinition): Row {
  const drawn = e.card ? deckCardById(e.card) : undefined;
  const hand = e.card ? CARDS.find((c) => c.id === e.card) : undefined;
  const news = e.spot === 'news' && game.news ? newsById(game.news.id) : undefined;
  const tile = e.tile === undefined ? undefined : map.tiles[e.tile];
  const icon =
    news?.icon ||
    drawn?.icon ||
    hand?.icon ||
    (e.spot && countryFlag(tile?.countryCode)) ||
    KIND_ICONS[e.spot ?? e.kind] ||
    KIND_ICONS[e.kind] ||
    '•';
  // Chance and fate read like the card itself, so the table remembers what it did.
  if (drawn)
    return {
      e,
      icon,
      title: `${drawn.deck === 'chance' ? '机会' : '命运'} · ${drawn.name}`,
      body: drawn.text,
    };
  if (news) return { e, icon, title: `世界新闻 · ${news.name}`, body: news.text };
  // The name is already shown in colour above the line; do not repeat it in the text.
  const name = game.players.find((p) => p.id === e.actor)?.name;
  let body = e.text;
  if (name && body.startsWith(name) && body[name.length] !== '的')
    body = body.slice(name.length).replace(/^[：:，,\s]+/, '') || e.text;
  return { e, icon, body };
}

/**
 * The table's running record: every public action, newest first, kept on screen so nobody
 * misses what happened while they looked away. Scroll position is anchored like a chat log:
 * pinned to the newest line at the top, otherwise the text under the reader stays put.
 */
export function ActivityFeed({
  game,
  map,
  ai = null,
  className = '',
}: {
  game: GameView;
  map: MapDefinition;
  /** Live progress of an AI seat that is thinking right now. */
  ai?: RoomView['aiActivity'];
  className?: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  // Scroll anchor: the first row the reader can see and how far it sat from the top.
  const anchor = useRef<{ key: string; offset: number } | null>(null);
  // Lines that arrive after the feed mounted glow briefly.
  const firstSeen = useRef({ gameId: game.id, id: game.nextEvent - 1 });
  if (firstSeen.current.gameId !== game.id)
    firstSeen.current = { gameId: game.id, id: game.nextEvent - 1 };
  const index = (id?: string) => game.players.findIndex((p) => p.id === id);
  const rows = useMemo(() => {
    // Group events by turn in time order, then show the newest turn first with its header on
    // top and its lines newest first.
    const turns: { header?: { separator: string; key: string }; rows: Row[] }[] = [{ rows: [] }];
    let last: Row | null = null;
    for (const e of game.events) {
      if (HIDDEN.has(e.kind)) continue;
      if (e.kind === 'turn') {
        turns.push({ header: { separator: e.text, key: `s${e.id}` }, rows: [] });
        last = null;
        continue;
      }
      // An AI seat logs its reason right after the move; fold it into that line.
      if (e.kind === 'ai' && last && last.e.actor === e.actor && !last.why) {
        last.why = describe(e, game, map).body;
        if (e.detail) last.detail = e.detail;
        continue;
      }
      const row = describe(e, game, map);
      last = e.kind === 'ai' ? null : row;
      const keep =
        filter === 'all' ||
        (filter === 'key' && (!!e.spot || ['finish', 'bankrupt', 'ai'].includes(e.kind))) ||
        (filter === 'mine' &&
          (e.actor === game.viewerId ||
            (e.tile !== undefined &&
              game.properties.find((p) => p.tile === e.tile)?.owner === game.viewerId)));
      if (keep) turns.at(-1)!.rows.push(row);
    }
    const out: (Row | { separator: string; key: string })[] = [];
    for (const turn of turns.reverse()) {
      if (!turn.rows.length) continue;
      if (turn.header) out.push(turn.header);
      out.push(...turn.rows.reverse());
    }
    return out;
  }, [game.revision, game.id, filter, map]);
  useLayoutEffect(() => {
    const el = list.current;
    const saved = anchor.current;
    if (!el || !saved) return;
    // Put the line the reader was looking at back where it was, whatever was added on top
    // or trimmed below.
    const row = el.querySelector<HTMLElement>(`[data-key="${saved.key}"]`);
    if (row) el.scrollTop = row.offsetTop - el.offsetTop - saved.offset;
  }, [rows]);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const save = () => {
      // Near the top the feed follows the newest line.
      if (el.scrollTop < 40) {
        anchor.current = null;
        return;
      }
      const top = el.scrollTop + el.offsetTop;
      const first = [...el.querySelectorAll<HTMLElement>('[data-key]')].find(
        (r) => r.offsetTop + r.offsetHeight > top,
      );
      anchor.current = first
        ? { key: first.dataset.key!, offset: first.offsetTop - el.offsetTop - el.scrollTop }
        : null;
    };
    el.addEventListener('scroll', save, { passive: true });
    return () => el.removeEventListener('scroll', save);
  }, []);
  const choose = (next: Filter) => {
    setFilter(next);
    anchor.current = null;
    if (list.current) list.current.scrollTop = 0;
  };
  return (
    <section className={`activity-feed ${className}`} aria-label="实时动态">
      <header>
        <b>实时动态</b>
        <span className="feed-filters" role="group" aria-label="筛选动态">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              className={filter === id ? 'on' : ''}
              onClick={() => choose(id)}
            >
              {label}
            </button>
          ))}
        </span>
      </header>
      {ai?.state === 'thinking' && index(ai.playerId) >= 0 && (
        <div
          className="feed-thinking"
          role="status"
          style={{ '--who': playerColor(index(ai.playerId)) } as CSSProperties}
        >
          <i aria-hidden="true" />
          <span>
            <b>{game.players[index(ai.playerId)].name}</b> 思考中 · {ai.message}
            {!!ai.steps?.length && (
              <span className="feed-steps">
                {ai.steps.map((s, i) => (
                  <em key={i}>{s}</em>
                ))}
              </span>
            )}
          </span>
        </div>
      )}
      <div className="feed-list" ref={list} role="log" aria-live="polite" aria-relevant="additions">
        {rows.length === 0 && <p className="feed-empty">还没有相关动态。</p>}
        {rows.map((r) =>
          'separator' in r ? (
            <div className="feed-turn" key={r.key} data-key={r.key}>
              <span>{r.separator}</span>
            </div>
          ) : (
            <article
              key={r.e.id}
              data-key={r.e.id}
              className={`feed-row kind-${r.e.kind} ${r.e.spot ? 'key' : ''} ${
                r.e.id > firstSeen.current.id ? 'fresh' : ''
              } ${r.e.actor && r.e.actor === game.viewerId ? 'mine' : ''}`}
              style={
                {
                  '--who': r.e.actor ? playerColor(Math.max(0, index(r.e.actor))) : '#163a5c',
                } as CSSProperties
              }
            >
              <span className="feed-icon" aria-hidden="true">
                {r.icon}
              </span>
              <span className="feed-copy">
                <span className="feed-meta">
                  {r.e.actor && index(r.e.actor) >= 0 && (
                    <b className="feed-who">
                      {r.e.actor === game.viewerId ? '你' : game.players[index(r.e.actor)].name}
                    </b>
                  )}
                  {r.e.kind === 'ai' && <em className="feed-tag">AI 思路</em>}
                  <time aria-hidden="true">
                    <Clock>{(now) => ago(now - r.e.at)}</Clock>
                  </time>
                </span>
                {r.title && <b className="feed-title">{r.title}</b>}
                <span className="feed-text">{r.body}</span>
                {r.why && <span className="feed-why">💭 {r.why}</span>}
                {(r.detail ?? r.e.detail) && (
                  <small className="feed-detail">{r.detail ?? r.e.detail}</small>
                )}
              </span>
              {r.e.amount !== undefined && r.e.amount !== 0 && (
                <strong className={r.e.amount < 0 ? 'expense' : 'income'}>
                  {r.e.amount > 0 ? '+' : '−'}
                  {money(Math.abs(r.e.amount))}
                </strong>
              )}
            </article>
          ),
        )}
      </div>
    </section>
  );
}
