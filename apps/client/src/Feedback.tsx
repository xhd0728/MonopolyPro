import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CARDS, countryFlag, deckCardById, newsById } from '../../../packages/content/src/index.ts';
import {
  EMOTES,
  type Emote,
  type EmoteView,
  type GameEvent,
  type GameView,
  type MapDefinition,
  type RoomView,
  type SpotKind,
} from '../../../packages/shared/src/index.ts';
import { serverTime } from './clock.tsx';
import { play, type Cue } from './sound.ts';
/**
 * Sound for an event: everything that involves the viewer, plus a few table-wide moments
 * (purchases, card draws, news) so six-player games do not turn into noise.
 */
function cueFor(e: GameEvent, game: GameView): Cue | null {
  const mine = e.actor === game.viewerId;
  const ownsSquare =
    e.tile !== undefined && game.properties.find((p) => p.tile === e.tile)?.owner === game.viewerId;
  switch (e.spot) {
    case 'purchase':
      return 'buy';
    case 'build':
      return mine ? 'build' : null;
    case 'rent':
      return mine ? 'pay' : ownsSquare ? 'earn' : null;
    case 'jail':
    case 'bankrupt':
      return mine ? 'jail' : null;
    case 'pot':
      return mine ? 'earn' : null;
    case 'chance':
    case 'fate':
    case 'card':
      return 'card';
    case 'news':
      return 'news';
    case 'offer':
      return game.trade?.to === game.viewerId ? 'offer' : null;
    case 'trade':
      return 'buy';
    default:
      return e.kind === 'finish' ? 'win' : null;
  }
}
import { money, playerColor } from './game-ui.ts';

/** Events added since the previous revision this component saw (empty after a new match). */
function useFreshEvents(game: GameView) {
  const seen = useRef({ gameId: game.id, event: game.nextEvent - 1 });
  const [fresh, setFresh] = useState<{ events: GameEvent[]; revision: number }>({
    events: [],
    revision: game.revision,
  });
  useEffect(() => {
    const same = seen.current.gameId === game.id;
    const events = same ? game.events.filter((e) => e.id > seen.current.event) : [];
    seen.current = { gameId: game.id, event: game.nextEvent - 1 };
    setFresh({ events, revision: game.revision });
  }, [game.id, game.revision]);
  return fresh;
}

const SPOT_TITLES: Record<SpotKind, string> = {
  purchase: '新地产',
  build: '建筑升级',
  rent: '支付租金',
  jail: '进入拘留所',
  release: '离开拘留所',
  bankrupt: '结束经营',
  pot: '奖池到手',
  trade: '交易达成',
  offer: '交易提案',
  card: '卡牌出击',
  chance: '机会卡',
  fate: '命运卡',
  news: '世界新闻',
  guess: '猜中点数',
};
const SPOT_SEALS: Record<SpotKind, string> = {
  purchase: '购',
  build: '建',
  rent: '租',
  jail: '拘',
  release: '释',
  bankrupt: '终',
  pot: '奖',
  trade: '易',
  offer: '⇄',
  card: '卡',
  chance: '机',
  fate: '命',
  news: '闻',
  guess: '猜',
};
interface Headline {
  key: string;
  tone: SpotKind | 'turn' | 'myturn';
  title: string;
  text: string;
  amount?: number;
  color: string;
  mark: string;
}
const playerIndex = (game: GameView, id?: string) =>
  Math.max(
    0,
    game.players.findIndex((p) => p.id === id),
  );

/**
 * A single headline strip at the top of the ocean that every seat sees: whose turn it is,
 * purchases, rent, jail, cards and news. Headlines queue so fast bot turns never overlap.
 */
export function Headlines({
  game,
  map,
  reduced,
}: {
  game: GameView;
  map: MapDefinition;
  reduced: boolean;
}) {
  const fresh = useFreshEvents(game);
  const [queue, setQueue] = useState<Headline[]>([]);
  const shown = useRef<{ key: string; until: number } | null>(null);
  // Empty at first so the opening turn (or the turn in progress after a refresh) is announced.
  const turnKey = useRef('');
  useEffect(() => {
    const next: Headline[] = [];
    for (const e of fresh.events) {
      if (!e.spot) continue;
      const tile = e.tile === undefined ? undefined : map.tiles[e.tile];
      const card = e.card ? CARDS.find((c) => c.id === e.card) : undefined;
      const drawn = e.card ? deckCardById(e.card) : undefined;
      const news = e.spot === 'news' && game.news ? newsById(game.news.id) : undefined;
      const who = game.players.find((p) => p.id === e.actor);
      next.push({
        key: `e${e.id}`,
        tone: e.spot,
        // A drawn card reads like the card itself: deck, name, then what it does.
        title: drawn
          ? `${SPOT_TITLES[e.spot]} · ${drawn.name}`
          : news
            ? `${SPOT_TITLES.news} · ${news.name}`
            : SPOT_TITLES[e.spot],
        text: drawn
          ? `${who?.id === game.viewerId ? '你' : (who?.name ?? '')}：${drawn.text}`
          : news
            ? e.text.replace(/^第 \d+ 轮世界新闻「[^」]+」：/, '')
            : e.text,
        ...(e.amount !== undefined ? { amount: e.amount } : {}),
        color: news ? '#163a5c' : playerColor(playerIndex(game, e.actor)),
        mark:
          news?.icon ||
          drawn?.icon ||
          countryFlag(tile?.countryCode) ||
          card?.icon ||
          SPOT_SEALS[e.spot],
      });
    }
    const key = `${game.id}:${game.round}:${game.turn}`;
    if (key !== turnKey.current && ['roll', 'jail'].includes(game.phase)) {
      const active = game.players[game.turn];
      const mine = active.id === game.viewerId;
      next.push({
        key: `t${key}`,
        tone: mine ? 'myturn' : 'turn',
        title: mine ? '轮到你了' : `轮到${active.name}`,
        text: game.phase === 'jail' ? '先决定如何离开拘留所' : `第 ${game.round} 轮 · 掷骰出发`,
        color: playerColor(game.turn),
        mark: String(game.turn + 1),
      });
    }
    turnKey.current = key;
    for (const e of fresh.events) {
      const cue = cueFor(e, game);
      if (cue) play(cue);
    }
    if (next.some((n) => n.tone === 'myturn')) play('myturn');
    if (!next.length) return;
    // The viewer's own turn matters more than anything still waiting: show it right away.
    const mine = next.find((n) => n.tone === 'myturn');
    if (mine) {
      // Keep the round's news with it, so the first player of a round still sees the news.
      shown.current = null;
      setQueue([mine, ...next.filter((n) => n.tone === 'news')]);
      return;
    }
    setQueue((q) => [...q, ...next.filter((n) => !q.some((x) => x.key === n.key))].slice(-3));
  }, [fresh]);
  const current = queue[0];
  // Each headline gets an absolute deadline when it reaches the front. One interval drops it,
  // so re-renders, duplicate keys or bursts of views can never keep a headline up.
  if (current && shown.current?.key !== current.key) {
    // Readable when calm; when more is waiting, keep pace with the board (bots act ~1.2s apart).
    const read = ['chance', 'fate', 'news'].includes(current.tone) ? 3000 : 2200;
    shown.current = { key: current.key, until: Date.now() + (queue.length > 1 ? 1000 : read) };
  }
  const busy = queue.length > 0;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      if (shown.current && Date.now() >= shown.current.until) {
        shown.current = null;
        setQueue((q) => q.slice(1));
      }
    }, 200);
    return () => clearInterval(timer);
  }, [busy]);
  if (!current) return null;
  return (
    <div className="headline-slot" aria-live="polite" aria-label="全场提示">
      <div
        key={current.key}
        className={`headline tone-${current.tone} ${reduced ? '' : 'animate'}`}
        style={{ '--who': current.color } as CSSProperties}
      >
        <span className="headline-mark" aria-hidden="true">
          {current.mark}
        </span>
        <span className="headline-copy">
          <b>{current.title}</b>
          <span>{current.text}</span>
        </span>
        {current.amount !== undefined && current.amount !== 0 && (
          <strong className={current.amount < 0 ? 'expense' : 'income'}>
            {current.amount > 0 ? '+' : '−'}
            {money(Math.abs(current.amount))}
          </strong>
        )}
      </div>
    </div>
  );
}

const QUIET = new Set(['turn', 'start', 'move', 'ai']);
const TICKER_MS = 6000;
/**
 * Rolling log of smaller actions. New lines append and each line expires on its own, so the
 * list never blinks when several actions arrive quickly.
 */
export function ActionTicker({
  game,
  enabled,
  explain,
}: {
  game: GameView;
  enabled: boolean;
  explain: (e: GameEvent) => string;
}) {
  const fresh = useFreshEvents(game);
  const [items, setItems] = useState<{ e: GameEvent; until: number }[]>([]);
  useEffect(() => {
    const now = Date.now();
    const added: GameEvent[] = [];
    for (const e of fresh.events) {
      if (!e.actor || QUIET.has(e.kind) || e.spot) continue;
      // A card that pays out logs the payout and the card; show them as one line.
      const last = added.at(-1);
      if (e.kind === 'card' && last?.kind === 'money' && last.actor === e.actor) {
        added[added.length - 1] = {
          ...e,
          ...(last.amount !== undefined ? { amount: last.amount } : {}),
        };
        continue;
      }
      added.push(e);
    }
    if (!added.length) return;
    setItems((list) =>
      [
        ...list.filter((i) => i.until > now),
        ...added.map((e) => ({ e, until: now + TICKER_MS })),
      ].slice(-2),
    );
  }, [fresh]);
  useEffect(() => {
    if (!items.length) return;
    const wait = Math.max(50, Math.min(...items.map((i) => i.until)) - Date.now());
    const timer = setTimeout(
      () => setItems((list) => list.filter((i) => i.until > Date.now())),
      wait,
    );
    return () => clearTimeout(timer);
  }, [items]);
  if (!enabled || !items.length) return null;
  return (
    <div className="action-announcements" aria-live="polite" aria-label="实时行动提示">
      {items.map(({ e }, i) => (
        <div key={e.id}>
          <span style={{ background: playerColor(playerIndex(game, e.actor)) }}>
            {e.actor === game.viewerId ? '你的行动' : '对手行动'}
          </span>
          <b>{e.text}</b>
          {e.amount !== undefined && (
            <strong className={e.amount < 0 ? 'expense' : 'income'}>
              {e.amount > 0 ? '+' : ''}
              {money(e.amount)}
            </strong>
          )}
          {i === items.length - 1 && <p>{explain(e)}</p>}
        </div>
      ))}
    </div>
  );
}

/** Tab title and focus cues when the seat needs to act, even if the tab is in the background. */
export function useTurnAttention(needsMe: boolean) {
  useEffect(() => {
    if (!needsMe) return;
    const base = document.title;
    let on = false;
    const timer = setInterval(() => {
      if (!document.hidden) {
        document.title = base;
        return;
      }
      on = !on;
      document.title = on ? '▶ 轮到你了 · 富翁之旅' : base;
    }, 1000);
    return () => {
      clearInterval(timer);
      document.title = base;
    };
  }, [needsMe]);
}

/** Emotes from the last few seconds, keyed by seat. Expires locally even without new views. */
export function useLiveEmotes(emotes: EmoteView[], enabled: boolean) {
  const [, tick] = useState(0);
  const live = enabled ? emotes.filter((e) => serverTime() - e.at < EMOTE_LIFE_MS) : [];
  const key = live.map((e) => e.id).join(',');
  // Wake up when the oldest live emote expires; later ones schedule their own wake-up.
  const oldest = live.length ? Math.min(...live.map((e) => e.at)) : undefined;
  useEffect(() => {
    if (oldest === undefined) return;
    const wait = Math.max(50, oldest + EMOTE_LIFE_MS - serverTime());
    const timer = setTimeout(() => tick((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [key]);
  // Stable identity while the set of live emotes is unchanged keeps memoized panels quiet.
  return useMemo(() => {
    const bySeat: Record<string, EmoteView> = {};
    for (const e of live) bySeat[e.seatId] = e;
    return bySeat;
  }, [key]);
}
const EMOTE_LIFE_MS = 3500;
export function EmoteBar({ send, disabled }: { send: (emote: Emote) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="emote-bar">
      <button
        className="text-button emote-toggle"
        aria-expanded={open}
        aria-label="发送表情"
        onClick={() => setOpen(!open)}
      >
        😊<span className="emote-label"> 表情</span>
      </button>
      {open && (
        <span className="emote-menu" role="menu">
          {EMOTES.map((emote) => (
            <button
              key={emote}
              role="menuitem"
              aria-label={`发送${emote}`}
              disabled={disabled}
              onClick={() => {
                send(emote);
                setOpen(false);
              }}
            >
              {emote}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
