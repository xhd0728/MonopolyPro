import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { GameView, MapDefinition, RoomView } from '../../../packages/shared/src/index.ts';
import { DecisionTrace } from './AgentTrace.tsx';
import { activityRows, type Filter } from './activity.ts';
import { Clock } from './clock.tsx';
import { money, playerColor } from './game-ui.ts';

const FILTERS: [Filter, string][] = [
  ['all', '全部'],
  ['key', '重要'],
  ['mine', '与我相关'],
];

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 8) return '刚刚';
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} 分钟前` : `${Math.floor(m / 60)} 小时前`;
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
  const rows = useMemo(
    () => activityRows(game, map, filter),
    [game.id, game.revision, game.nextEvent, game.viewerId, filter, map],
  );
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
      {(ai?.state === 'thinking' || ai?.state === 'queued') && index(ai.playerId) >= 0 && (
        <div
          className="feed-thinking"
          role="status"
          style={{ '--who': playerColor(index(ai.playerId)) } as CSSProperties}
        >
          <i aria-hidden="true" />
          <span>
            <b>{game.players[index(ai.playerId)].name}</b>{' '}
            {ai.state === 'queued' ? '排队中' : '思考中'} · {ai.message}
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
                  {r.e.kind === 'ai' && <em className="feed-tag">AI 决策</em>}
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
                {!!(r.trace ?? r.e.aiTrace)?.length && (
                  <DecisionTrace trace={(r.trace ?? r.e.aiTrace)!} />
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
