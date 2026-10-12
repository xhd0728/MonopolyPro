import { z } from 'zod';

export type Mode = 'free' | 'quick' | 'team';
export interface RoomSettings {
  mapId: string;
  mode: Mode;
  minutes: number;
  initialCash: number;
  maxPlayers: number;
  /** Seconds a human gets per decision before the server plays a safe default. 0 = no limit. */
  turnSeconds: number;
  /** How the match ends: after a number of rounds, on the clock, or when someone hits a target. */
  end: EndMode;
  rounds: number;
  target: number;
}
export type EndMode = 'rounds' | 'time' | 'target';
export type TileKind =
  | 'start'
  | 'property'
  | 'bank'
  | 'shop'
  | 'chance'
  | 'fate'
  | 'tax'
  | 'jail'
  | 'parking'
  | 'gotojail'
  | 'transit';
export interface TileDefinition {
  id: string;
  index: number;
  name: string;
  kind: TileKind;
  countryCode?: string;
  x: number;
  z: number;
  group: number;
  price: number;
  rent: number;
  buildCost: number;
  exits: number[];
}
export interface MapDefinition {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  theme: string;
  color: string;
  recommended: string;
  mechanic: 'none' | 'ferry' | 'metro' | 'gates';
  /** Route shortcuts drawn across the board: metro forks, trade gates or the ferry pair. */
  shortcuts: [number, number][];
  tiles: TileDefinition[];
}
export interface CharacterDefinition {
  id: string;
  name: string;
  title: string;
  description: string;
  ability: string;
  color: string;
  icon: string;
}
export type CardCategory = 'move' | 'economy' | 'build' | 'disrupt' | 'defense';
export type CardEffect =
  | 'move'
  | 'teleport'
  | 'dice'
  | 'swap'
  | 'money'
  | 'steal'
  | 'deposit'
  | 'interest'
  | 'collect'
  | 'upgrade'
  | 'discount'
  | 'demolish'
  | 'rentBoost'
  | 'remoteBuy'
  | 'protect'
  | 'trap'
  | 'skip'
  | 'stealCard'
  | 'clearBoost'
  | 'rentCut'
  | 'shield'
  | 'cleanse'
  | 'rescue'
  | 'insure'
  | 'taxShield';
export interface CardDefinition {
  id: string;
  name: string;
  category: CardCategory;
  description: string;
  effect: CardEffect;
  amount: number;
  target: 'self' | 'player' | 'ownProperty' | 'enemyProperty' | 'emptyProperty' | 'tile';
  price: number;
  icon: string;
}
/** 机会 (chance) leans on surprise movement; 命运 (fate) on money and the whole table. */
export type DeckId = 'chance' | 'fate';
export type DeckEffect =
  | 'gain'
  | 'pay'
  | 'advanceTo'
  | 'move'
  | 'jail'
  | 'jailCard'
  | 'repairs'
  | 'payEach'
  | 'collectEach'
  | 'shield'
  | 'drawCard'
  | 'upgradeRandom'
  | 'everyone'
  | 'robinHood'
  | 'potHalf';
export interface DeckCardDefinition {
  id: string;
  deck: DeckId;
  name: string;
  text: string;
  icon: string;
  effect: DeckEffect;
  amount: number;
  /** Destination for advanceTo: a square index or a named rule. */
  target?: number | 'start' | 'parking' | 'priciest' | 'nearestEmpty';
  /** How good the card is for the drawer (0–5); used by the trailing player's best-of-two draw. */
  value: number;
}
/** World news flipped at the start of every round; effects last for that round only. */
export type NewsEffect =
  | 'calm'
  | 'groupBoom'
  | 'groupSlump'
  | 'rateCut'
  | 'rateHike'
  | 'buildSale'
  | 'taxHoliday'
  | 'landRush'
  | 'landSale'
  | 'doubleSalary'
  | 'strictCustoms'
  | 'festival'
  | 'wealthTax'
  | 'luckyDraw';
export interface NewsDefinition {
  id: string;
  name: string;
  text: string;
  icon: string;
  effect: NewsEffect;
  amount: number;
}
export interface NewsState {
  id: string;
  round: number;
  /** Colour group affected by groupBoom / groupSlump. */
  group?: number;
}
export interface PropertyState {
  tile: number;
  owner: string | null;
  level: number;
  mortgaged: boolean;
  boostUntil: number;
  cutUntil: number;
  protectedUntil: number;
}
export interface PlayerState {
  id: string;
  name: string;
  characterId: string;
  team: number;
  cash: number;
  deposit: number;
  position: number;
  cards: string[];
  bankrupt: boolean;
  shield: number;
  taxShield: number;
  skipTurns: number;
  /** Turns still to be served in the jail corner; 0 when free. */
  jailTurns: number;
  nextDice: number | null;
  discount: boolean;
  abilityRound: number;
  bot: boolean;
  /** Correct free roll guesses this match (rewarded up to a small cap). */
  prophet: number;
}
/** Moments every seat should notice; the client spotlights them on the board. */
export type SpotKind =
  | 'purchase'
  | 'build'
  | 'rent'
  | 'jail'
  | 'release'
  | 'bankrupt'
  | 'pot'
  | 'trade'
  | 'offer'
  | 'card'
  | 'chance'
  | 'fate'
  | 'news'
  | 'guess';
export interface GameEvent {
  id: number;
  at: number;
  kind: string;
  text: string;
  actor?: string;
  amount?: number;
  path?: number[];
  spot?: SpotKind;
  /** Board square the moment happened on, for flags and highlights. */
  tile?: number;
  /** Deck or hand card id behind the moment. */
  card?: string;
}
export interface DebtDecision {
  playerId: string;
  amount: number;
  creditorId: string | null;
  reason: string;
  /** Creditors who share the amount equally instead of a single creditor. */
  split?: string[];
}
export interface AuctionDecision {
  tile: number;
  bidderIds: string[];
  passedIds: string[];
  highBid: number;
  highBidderId: string | null;
  bidderIndex: number;
}
export interface PathDecision {
  choices: number[];
  remaining: number;
  path: number[];
}
export interface TradeOffer {
  id: string;
  from: string;
  to: string;
  giveCash: number;
  wantCash: number;
  /** Squares the proposer hands over / asks for (unbuilt, unmortgaged). */
  giveTiles: number[];
  wantTiles: number[];
  /** True when this offer answers an earlier one (还价). */
  counter?: boolean;
  expiresAt: number;
}
export interface GameState {
  version: 3;
  id: string;
  revision: number;
  settings: RoomSettings;
  players: PlayerState[];
  properties: PropertyState[];
  turn: number;
  round: number;
  phase: 'roll' | 'jail' | 'path' | 'purchase' | 'auction' | 'manage' | 'debt' | 'finished';
  startedAt: number;
  endsAt: number;
  decisionAt: number;
  pendingPath: PathDecision | null;
  auction: AuctionDecision | null;
  debt: DebtDecision | null;
  trade: TradeOffer | null;
  traps: Record<number, { owner: string; until: number; amount: number }>;
  /** Free Parking jackpot: taxes, public fees and bail collected by the bank. */
  pot: number;
  /** Remaining draw order of each deck; drawn cards return to the bottom. */
  decks: Record<DeckId, string[]>;
  news: NewsState | null;
  /** Waiting players' free guesses on the current player's next roll. */
  guesses: Record<string, 'high' | 'low'>;
  /** Per player: no new offers before `until` (after a rejection); last round a bot offered. */
  tradeMemo: Record<string, { until: number; round: number }>;
  /** 终局冲刺: the last stretch of the match, when rent is raised to force a decision. */
  finale: boolean;
  events: GameEvent[];
  nextEvent: number;
  lastDice: number[];
  winners: string[];
  finishReason: string;
}
export type PlayerView = Omit<PlayerState, 'cards' | 'nextDice'> & {
  cards?: string[];
  cardCount: number;
  nextDice?: number | null;
  assets: number;
  propertyValue: number;
  propertyCount: number;
  buildingCount: number;
  debt: number;
  /** Most recent notable action text, computed from the full authoritative log. */
  lastAction: string | null;
};
export interface PropertyView extends PropertyState {
  /** Current purchase price for unowned land, after this round's news. */
  price: number;
  rent: number;
  payableRent: number;
  upgradeCost: number;
}
export interface ActionOption {
  action: GameAction;
  label: string;
  hint: string;
  disabled?: string;
  primary?: boolean;
}
export interface GameView extends Omit<GameState, 'players' | 'traps' | 'properties' | 'decks'> {
  players: PlayerView[];
  properties: PropertyView[];
  actions: ActionOption[];
  viewerId: string | null;
  activeId: string | null;
  traps: Record<number, { until: number; amount: number }>;
}
export interface Seat {
  id: string;
  name: string;
  characterId: string;
  team: number;
  bot: boolean;
  botMode?: 'rule' | 'llm';
  ready: boolean;
  spectator: boolean;
  tokenHash: string;
  connected: boolean;
  disconnectedAt: number | null;
  controlEpoch: number;
  /** The player switched on auto-play: the rule bot plays this seat until they act again. */
  afk?: boolean;
}
export interface RoomRecord {
  version: 1;
  code: string;
  createdAt: number;
  updatedAt: number;
  hostId: string;
  settings: RoomSettings;
  passwordHash: string | null;
  passwordSalt: string | null;
  seats: Seat[];
  game: GameState | null;
  chat: { id: string; name: string; text: string; at: number }[];
}
export interface SeatView extends Omit<Seat, 'tokenHash' | 'controlEpoch'> {
  takeover: boolean;
}
export interface RoomView {
  code: string;
  settings: RoomSettings;
  hostId: string;
  viewerId: string;
  isHost: boolean;
  seats: SeatView[];
  game: GameView | null;
  chat: RoomRecord['chat'];
  locked: boolean;
  serverNow: number;
  takeoverAfterMs: number;
  decisionTimeoutMs: number;
  ai: { configured: boolean; model: string | null };
  /** Reactions from the last few seconds (memory only, never persisted). */
  emotes: EmoteView[];
  aiActivity: {
    playerId: string;
    state: 'thinking' | 'ready' | 'fallback';
    message: string;
    at: number;
  } | null;
}
/** Fixed, wordless reactions; nothing to moderate. */
export const EMOTES = ['👍', '😂', '😮', '😭', '😤', '🎉', '🙏', '💸'] as const;
export type Emote = (typeof EMOTES)[number];
export interface EmoteView {
  id: string;
  seatId: string;
  emote: Emote;
  at: number;
}
export interface RoomListing {
  code: string;
  mapId: string;
  mode: Mode;
  players: number;
  humans: number;
  bots: number;
  spectators: number;
  maxPlayers: number;
  locked: boolean;
  status: 'waiting' | 'playing' | 'finished';
}

const amount = z.number().int().min(0).max(1000000);
const tile = z.number().int().min(0).max(100);
export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal([
      'roll',
      'buy',
      'pass',
      'end',
      'auctionPass',
      'ability',
      'surrender',
      'tradeAccept',
      'tradeReject',
      'ferry',
      'bail',
      'jailRoll',
    ]),
  }),
  z.object({ type: z.literal('choosePath'), tile }),
  z.object({ type: z.literal('guess'), pick: z.enum(['high', 'low']) }),
  z.object({ type: z.literal('bid'), amount }),
  z.object({ type: z.literal(['build', 'downgrade', 'mortgage', 'redeem']), tile }),
  z.object({ type: z.literal('bank'), amount, direction: z.enum(['deposit', 'withdraw']) }),
  z.object({ type: z.literal('buyCard'), cardId: z.string().max(50) }),
  z.object({
    type: z.literal('playCard'),
    cardId: z.string().max(50),
    targetId: z.string().max(50).optional(),
    tile: tile.optional(),
    value: z.number().int().min(1).max(6).optional(),
  }),
  z.object({
    type: z.literal('tradeOffer'),
    to: z.string().max(50),
    giveCash: amount,
    wantCash: amount,
    giveTiles: z.array(tile).max(16).default([]),
    wantTiles: z.array(tile).max(16).default([]),
    // Older clients sent a single square per side.
    giveTile: tile.nullable().optional(),
    wantTile: tile.nullable().optional(),
  }),
  z.object({
    type: z.literal('tradeCounter'),
    giveCash: amount,
    wantCash: amount,
    giveTiles: z.array(tile).max(16).default([]),
    wantTiles: z.array(tile).max(16).default([]),
  }),
]);
export type GameAction = z.infer<typeof actionSchema>;
export const commandSchema = z.object({
  id: z.string().min(8).max(80),
  revision: z.number().int().min(0),
  action: actionSchema,
});
export type GameCommand = z.infer<typeof commandSchema>;
/** Human decision limits the host can choose; 0 (no limit) is the default. */
export const TURN_SECONDS = [0, 60, 120, 300];
/** AI seats always decide within this bound (LLM requests are cut off and fall back). */
export const AI_DECISION_CAP_MS = 120000;
export const settingsSchema = z.object({
  mapId: z.enum(['town', 'islands', 'neon', 'ancient']),
  mode: z.enum(['free', 'quick', 'team']),
  minutes: z.number().int().min(5).max(60),
  initialCash: z.number().int().min(1000).max(10000),
  maxPlayers: z.number().int().min(2).max(6),
  turnSeconds: z
    .number()
    .int()
    .refine((n) => TURN_SECONDS.includes(n), '无效的操作时限')
    .default(0),
  end: z.enum(['rounds', 'time', 'target']).default('rounds'),
  rounds: z.number().int().min(4).max(40).default(12),
  target: z.number().int().min(5000).max(100000).default(15000),
});
/** Whatever the end mode, a match never runs longer than this. */
export const HARD_CAP_MINUTES = 90;
export const DEFAULT_SETTINGS: RoomSettings = {
  mapId: 'town',
  mode: 'free',
  minutes: 30,
  initialCash: 3000,
  maxPlayers: 6,
  turnSeconds: 0,
  end: 'rounds',
  rounds: 12,
  target: 15000,
};
export interface CommandResult {
  id: string;
  ok: boolean;
  revision: number;
  error?: string;
}
