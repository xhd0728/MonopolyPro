import { CARDS, countryFlag, deckCardById, NEWS } from '../../../packages/content/src/index.ts';
import type { GameEvent, GameView, MapDefinition } from '../../../packages/shared/src/index.ts';
export type Filter = 'all' | 'key' | 'mine';

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
export interface Row {
  e: GameEvent;
  icon: string;
  title?: string;
  body: string;
  /** An AI seat's reason for this move, folded in from the 'ai' event that follows it. */
  why?: string;
  detail?: string;
  trace?: GameEvent['aiTrace'];
}
/** Resolve the event's news, including when a later round has already changed game.news. */
export function newsForEvent(e: GameEvent) {
  return e.kind === 'news' ? NEWS.find((n) => e.text.includes(`世界新闻「${n.name}」`)) : undefined;
}
export function describeActivity(e: GameEvent, game: GameView, map: MapDefinition): Row {
  const drawn = e.card ? deckCardById(e.card) : undefined;
  const hand = e.card ? CARDS.find((c) => c.id === e.card) : undefined;
  const news = newsForEvent(e);
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
  if (news)
    return {
      e,
      icon,
      title: `世界新闻 · ${news.name}`,
      body: e.text.split(`世界新闻「${news.name}」：`)[1] ?? e.text,
    };
  // The name is already shown in colour above the line; do not repeat it in the text.
  const name = game.players.find((p) => p.id === e.actor)?.name;
  let body = e.text;
  if (name && body.startsWith(name) && body[name.length] !== '的')
    body = body.slice(name.length).replace(/^[：:，,\s]+/, '') || e.text;
  return { e, icon, body };
}

/** Fold AI explanations into their actions before filtering so important explanations survive. */
export function activityRows(game: GameView, map: MapDefinition, filter: Filter) {
  const turns: { header?: { separator: string; key: string }; rows: Row[] }[] = [{ rows: [] }];
  let last: Row | null = null;
  for (const e of game.events) {
    if (e.kind === 'move') continue;
    if (e.kind === 'turn') {
      turns.push({ header: { separator: e.text, key: `s${e.id}` }, rows: [] });
      last = null;
      continue;
    }
    if (e.kind === 'ai' && last && last.e.actor === e.actor && !last.why) {
      last.why = describeActivity(e, game, map).body;
      last.detail = e.detail;
      last.trace = e.aiTrace;
      continue;
    }
    const row = describeActivity(e, game, map);
    turns.at(-1)!.rows.push(row);
    last = e.kind === 'ai' ? null : row;
  }
  const out: (Row | { separator: string; key: string })[] = [];
  for (const turn of turns.reverse()) {
    const rows = turn.rows.filter(
      ({ e, why }) =>
        filter === 'all' ||
        (filter === 'key' &&
          (!!e.spot || !!why || ['finish', 'bankrupt', 'ai'].includes(e.kind))) ||
        (filter === 'mine' &&
          (e.actor === game.viewerId ||
            (e.tile !== undefined &&
              game.properties.find((p) => p.tile === e.tile)?.owner === game.viewerId))),
    );
    if (!rows.length) continue;
    if (turn.header) out.push(turn.header);
    out.push(...rows.reverse());
  }
  return out;
}
