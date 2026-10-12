import { z } from 'zod';

export type Mode = 'free' | 'quick' | 'team';
export interface RoomSettings {
  mapId: string;
  mode: Mode;
  minutes: number;
  initialCash: number;
  maxPlayers: number;
}
export type TileKind =
  | 'start'
  | 'property'
  | 'bank'
  | 'shop'
  | 'event'
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
}
export interface GameEvent {
  id: number;
  at: number;
  kind: string;
  text: string;
  actor?: string;
  amount?: number;
  path?: number[];
}
export interface DebtDecision {
  playerId: string;
  amount: number;
  creditorId: string | null;
  reason: string;
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
  giveTile: number | null;
  wantTile: number | null;
  expiresAt: number;
}
export interface GameState {
  version: 2;
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
};
export interface PropertyView extends PropertyState {
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
export interface GameView extends Omit<GameState, 'players' | 'traps' | 'properties'> {
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
  aiActivity: {
    playerId: string;
    state: 'thinking' | 'ready' | 'fallback';
    message: string;
    at: number;
  } | null;
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
    giveTile: tile.nullable(),
    wantTile: tile.nullable(),
  }),
]);
export type GameAction = z.infer<typeof actionSchema>;
export const commandSchema = z.object({
  id: z.string().min(8).max(80),
  revision: z.number().int().min(0),
  action: actionSchema,
});
export type GameCommand = z.infer<typeof commandSchema>;
export const settingsSchema = z.object({
  mapId: z.enum(['town', 'islands', 'neon', 'ancient']),
  mode: z.enum(['free', 'quick', 'team']),
  minutes: z.number().int().min(5).max(60),
  initialCash: z.number().int().min(1000).max(10000),
  maxPlayers: z.number().int().min(2).max(6),
});
export const DEFAULT_SETTINGS: RoomSettings = {
  mapId: 'town',
  mode: 'free',
  minutes: 30,
  initialCash: 3000,
  maxPlayers: 6,
};
export interface CommandResult {
  id: string;
  ok: boolean;
  revision: number;
  error?: string;
}
