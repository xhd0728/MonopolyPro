import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CARDS, countryFlag, deckCardById, newsById } from '../../../packages/content/src/index.ts';
import type { GameEvent, GameView, MapDefinition } from '../../../packages/shared/src/index.ts';
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
  className = '',
}: {
  game: GameView;
  map: MapDefinition;
  className?: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const list = useRef<HTMLDivElement>(null);
  const anchor = useRef({ height: 0, top: 0 });
  // Lines that arrive after the feed mounted glow briefly.
  const firstSeen = useRef({ gameId: game.id, id: game.nextEvent - 1 });
  if (firstSeen.current.gameId !== game.id)
    firstSeen.current = { gameId: game.id, id: game.nextEvent - 1 };
  const index = (id?: string) => game.players.findIndex((p) => p.id === id);
  const rows = useMemo(() => {
    const out: (Row | { separator: string; key: string })[] = [];
    const events = [...game.events].reverse();
    for (const e of events) {
      if (HIDDEN.has(e.kind)) continue;
      if (e.kind === 'turn') {
        out.push({ separator: e.text, key: `s${e.id}` });
        continue;
      }
      if (filter === 'key' && !e.spot && !['finish', 'bankrupt', 'ai'].includes(e.kind)) continue;
      if (filter === 'mine') {
        const owner = e.tile !== undefined && game.properties.find((p) => p.tile === e.tile)?.owner;
        if (e.actor !== game.viewerId && owner !== game.viewerId) continue;
      }
      out.push(describe(e, game, map));
    }
    // Drop separators with nothing under them (filtered views) and a trailing one.
    return out.filter(
      (r, i) => !('separator' in r) || (i + 1 < out.length && !('separator' in out[i + 1])),
    );
  }, [game.revision, game.id, filter, map]);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const { height, top } = anchor.current;
    // Near the top: stay on the newest line. Reading older lines: keep them under the eyes.
    if (top > 40) el.scrollTop = top + (el.scrollHeight - height);
    anchor.current = { height: el.scrollHeight, top: el.scrollTop };
  }, [rows]);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const save = () => (anchor.current = { height: el.scrollHeight, top: el.scrollTop });
    el.addEventListener('scroll', save, { passive: true });
    return () => el.removeEventListener('scroll', save);
  }, []);
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
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </span>
      </header>
      <div className="feed-list" ref={list} role="log" aria-live="polite">
        {rows.length === 0 && <p className="feed-empty">还没有相关动态。</p>}
        {rows.map((r) =>
          'separator' in r ? (
            <div className="feed-turn" key={r.key}>
              <span>{r.separator}</span>
            </div>
          ) : (
            <article
              key={r.e.id}
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
                  <time>
                    <Clock>{(now) => ago(now - r.e.at)}</Clock>
                  </time>
                </span>
                {r.title && <b className="feed-title">{r.title}</b>}
                <span className="feed-text">{r.body}</span>
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
