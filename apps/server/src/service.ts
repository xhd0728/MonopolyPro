import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import { CARDS, CHARACTERS, MAPS } from '../../../packages/content/src/index.ts';
import {
  actingPlayerId,
  applyAction,
  createGame,
  tickGame,
  viewFor,
  log,
  currentPlayer,
  endMatch,
  SIDE_TRADE_MS,
} from '../../../packages/engine/src/index.ts';
import { botAction, botDecision, squareValue } from '../../../packages/engine/src/bot.ts';
import {
  AI_DECISION_CAP_MS,
  commandSchema,
  DEFAULT_SETTINGS,
  EMOTES,
  settingsSchema,
} from '../../../packages/shared/src/index.ts';
import type {
  CommandResult,
  EmoteView,
  GameAction,
  GameView,
  RoomListing,
  RoomSummary,
  RoomRecord,
  RoomView,
  Seat,
} from '../../../packages/shared/src/index.ts';
import { Store } from './store.ts';
import type { BotBrain, AiDecision } from './ai.ts';
import { botChoices } from './bot-choices.ts';
import { aiTools } from './ai-tools.ts';
import { labelActions, observe, validator } from './ai-observe.ts';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .refine((s) => !/[\u0000-\u001f<>]/.test(s), '昵称包含无效字符');
const EMOTE_COOLDOWN_MS = 2500,
  EMOTE_SHOW_MS = 6000;
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function ensure(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new RequestError(message, status);
}
export interface ServiceOptions {
  takeoverMs: number;
  botStepMs: number;
  maxRooms: number;
  /** A room closes after this long without any human interaction (default 30 minutes). */
  roomIdleMs: number;
  /** A room closes once no human (player or spectator) has been connected this long. */
  emptyCloseMs?: number;
  /** Closed rooms are deleted this long after closing (default 10 minutes). */
  closedTtlMs?: number;
  now?: () => number;
  brain?: BotBrain;
  aiMaxConcurrent?: number;
  /** Upper bound for one AI decision (default two minutes). */
  aiDecisionCapMs?: number;
}
/** How long an LLM seat waits for a free model slot before the rule bot plays. */
const AI_QUEUE_MAX_MS = 20000;
/** How long a bot on turn waits before skipping an offer between two other players. */
const SIDE_TRADE_GRACE_MS = 10000;
/** Bot moves whose reason is worth showing to the table (not routine rolls or turn ends). */
const EXPLAINED = new Set<GameAction['type']>([
  'buy',
  'pass',
  'build',
  'bid',
  'auctionPass',
  'playCard',
  'buyCard',
  'bail',
  'tradeOffer',
  'tradeAccept',
  'tradeReject',
  'mortgage',
  'downgrade',
  'surrender',
  'choosePath',
]);
export class GameService {
  private botJobs = new Map<
    string,
    {
      controller: AbortController;
      gameId: string;
      revision: number;
      seatId: string;
      epoch: number;
      startedAt: number;
      capped: boolean;
    }
  >();
  private aiActivity = new Map<string, NonNullable<RoomView['aiActivity']>>();
  /** When an LLM seat started waiting for a free model slot, per room (for one decision). */
  private queuedSince = new Map<string, { key: string; since: number }>();
  /** Follow-up moves an LLM seat planned for the rest of its turn, per room. */
  private plans = new Map<
    string,
    {
      gameId: string;
      seatId: string;
      round: number;
      turn: number;
      phase: string;
      actions: GameAction[];
    }
  >();
  private dirtyRooms = new Set<string>();
  private takeoverSignatures = new Map<string, string>();
  private grants = new Map<string, { code: string; seatId: string; expires: number }>();
  private emotes = new Map<string, EmoteView[]>();
  /** Last reported round trip per room:seat, memory only. */
  private latency = new Map<string, number>();
  private emoteAt = new Map<string, number>();
  readonly options: ServiceOptions;
  constructor(
    readonly store: Store,
    options: Partial<ServiceOptions> = {},
  ) {
    this.options = {
      takeoverMs: 15000,
      botStepMs: 1200,
      maxRooms: 200,
      roomIdleMs: 30 * 60000,
      emptyCloseMs: 3 * 60000,
      closedTtlMs: 10 * 60000,
      ...options,
    };
    const now = this.now();
    for (const record of store.all()) {
      for (const seat of record.seats) {
        seat.connected = seat.bot;
        seat.disconnectedAt = seat.bot ? null : now;
        seat.controlEpoch++;
      }
      store.save(record);
    }
  }
  now() {
    return this.options.now?.() ?? Date.now();
  }
  env() {
    return { now: this.now(), randomInt };
  }
  /** Mutable copy for a transaction; save() commits it. */
  record(code: string) {
    const record = this.store.get(code.toUpperCase());
    ensure(record, '房间不存在或已解散', 404);
    return record;
  }
  /** Read-only committed record for views and checks. */
  private peek(code: string): Readonly<RoomRecord> {
    const record = this.store.peek(code.toUpperCase());
    ensure(record, '房间不存在或已解散', 404);
    return record;
  }
  private save(record: RoomRecord) {
    record.updatedAt = this.now();
    this.store.save(record);
  }
  /** A human did something: the room is in use. */
  private touch(record: RoomRecord) {
    record.lastActiveAt = this.now();
  }
  private ensureOpen(record: Readonly<RoomRecord>) {
    ensure(
      !record.closedAt,
      `房间已结束${record.closedReason ? `：${record.closedReason}` : ''}`,
      410,
    );
  }
  /**
   * End the room: an unfinished match is ranked as it stands, everyone is disconnected by the
   * caller, and the record is deleted `closedTtlMs` later.
   */
  private close(record: RoomRecord, reason: string) {
    if (record.closedAt) return;
    if (record.game && record.game.phase !== 'finished')
      record.game = endMatch(record.game, reason, this.env());
    record.closedAt = this.now();
    record.closedReason = reason;
    this.botJobs.get(record.code)?.controller.abort();
    this.botJobs.delete(record.code);
    this.aiActivity.delete(record.code);
    this.plans.delete(record.code);
    this.queuedSince.delete(record.code);
    this.save(record);
  }
  /**
   * Whether a trade an AI seat wrote gives away clearly more than it gets, judged like the
   * rule bot judges offers (colour-group completion counts extra).
   */
  private givesAway(
    g: NonNullable<RoomRecord['game']>,
    seatId: string,
    action: Extract<GameAction, { type: 'tradeOffer' | 'tradeCounter' }>,
  ) {
    const other = action.type === 'tradeOffer' ? action.to : g.trade?.from;
    if (!other) return false;
    const gives =
      action.giveCash +
      (action.giveTiles ?? []).reduce((n, t) => n + squareValue(g, t, other, true), 0);
    const gets =
      action.wantCash +
      (action.wantTiles ?? []).reduce((n, t) => n + squareValue(g, t, seatId, true), 0);
    return gives > gets * 1.3 + 50;
  }
  private newSeat(input: unknown, index: number, spectator = false): { seat: Seat; token: string } {
    const data = z
      .object({
        name: nameSchema,
        characterId: z
          .enum(['builder', 'landlord', 'runner', 'guardian', 'dealer', 'explorer'])
          .default('builder'),
      })
      .parse(input);
    const token = randomBytes(32).toString('base64url');
    return {
      seat: {
        id: randomUUID(),
        name: data.name,
        characterId: data.characterId,
        team: index % 2,
        bot: false,
        ready: false,
        spectator,
        tokenHash: tokenHash(token),
        connected: false,
        disconnectedAt: this.now(),
        controlEpoch: 0,
      },
      token,
    };
  }
  create(input: unknown) {
    const body = z
      .object({
        name: nameSchema,
        characterId: z.string().optional(),
        password: z.string().max(64).default(''),
        settings: settingsSchema.default(settingsSchema.parse(DEFAULT_SETTINGS)),
      })
      .parse(input);
    ensure(this.store.size < this.options.maxRooms, '房间数量达到上限，请稍后再试', 503);
    let code: string;
    do {
      code = Array.from(randomBytes(6))
        .map((n) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[n % 30])
        .join('');
    } while (this.store.get(code));
    const { seat, token } = this.newSeat(body, 0);
    const salt = body.password ? randomBytes(16).toString('hex') : null;
    const record: RoomRecord = {
      version: 1,
      code,
      createdAt: this.now(),
      updatedAt: this.now(),
      hostId: seat.id,
      settings: body.settings,
      passwordSalt: salt,
      passwordHash: salt ? scryptSync(body.password, salt, 32).toString('hex') : null,
      seats: [seat],
      game: null,
      chat: [],
      lastActiveAt: this.now(),
      closedAt: null,
    };
    this.save(record);
    return { code, seatId: seat.id, token };
  }
  private checkPassword(record: RoomRecord, password: string) {
    if (!record.passwordHash) return;
    const hash = scryptSync(password, record.passwordSalt!, 32);
    ensure(timingSafeEqual(hash, Buffer.from(record.passwordHash, 'hex')), '房间密码错误', 403);
  }
  join(code: string, input: unknown) {
    const data = z
      .object({
        name: nameSchema,
        characterId: z.string().optional(),
        password: z.string().max(64).default(''),
        spectator: z.boolean().default(false),
      })
      .parse(input);
    const record = this.record(code);
    this.ensureOpen(record);
    this.checkPassword(record, data.password);
    const players = record.seats.filter((s) => !s.spectator);
    const spectator =
      data.spectator || !!record.game || players.length >= record.settings.maxPlayers;
    ensure(!spectator || record.seats.filter((s) => s.spectator).length < 20, '观战席已满');
    const { seat, token } = this.newSeat(data, players.length, spectator);
    record.seats.push(seat);
    this.touch(record);
    this.save(record);
    return { code: record.code, seatId: seat.id, token };
  }
  authenticate(code: string, token: unknown) {
    ensure(
      typeof token === 'string' && token.length >= 32 && token.length <= 100,
      '恢复凭证无效',
      403,
    );
    const record = this.record(code),
      hash = tokenHash(token),
      seat = record.seats.find((s) => s.tokenHash === hash);
    this.ensureOpen(record);
    ensure(seat && !seat.bot, '无法恢复此席位', 403);
    return { record, seat };
  }
  grant(code: string, token: unknown) {
    const { seat } = this.authenticate(code, token);
    const key = randomBytes(24).toString('base64url');
    this.grants.set(key, { code, seatId: seat.id, expires: this.now() + 30000 });
    return { key, seatId: seat.id };
  }
  consumeGrant(code: string, key: unknown): string {
    ensure(typeof key === 'string', '连接凭证无效', 403);
    const grant = this.grants.get(key);
    this.grants.delete(key);
    ensure(
      grant && grant.code === code && grant.expires >= this.now(),
      '连接凭证已过期，请重试',
      403,
    );
    // A seat handed to a bot (or removed) can no longer be taken back with an old grant.
    const seat = this.peek(code).seats.find((s) => s.id === grant.seatId);
    ensure(seat && !seat.bot, '席位已交给机器人或已移出', 403);
    return grant.seatId;
  }
  connected(code: string, id: string) {
    const record = this.record(code),
      seat = record.seats.find((s) => s.id === id);
    ensure(seat, '席位不存在');
    seat.connected = true;
    seat.disconnectedAt = null;
    seat.controlEpoch++;
    this.touch(record);
    this.save(record);
  }
  disconnected(code: string, id: string) {
    const record = this.record(code),
      seat = record.seats.find((s) => s.id === id);
    if (!seat) return;
    seat.connected = false;
    seat.disconnectedAt = this.now();
    seat.controlEpoch++;
    if (record.hostId === id) {
      const next =
        record.seats.find((s) => !s.bot && s.connected && !s.spectator) ??
        record.seats.find((s) => !s.bot && s.connected);
      if (next) record.hostId = next.id;
    }
    this.save(record);
  }
  /**
   * Open rooms someone is actually in: closed rooms, and rooms where no human is connected,
   * stay off the home page. Waiting rooms come first.
   */
  list(): RoomListing[] {
    const order = { waiting: 0, playing: 1, finished: 2 };
    return [...this.store.peekAll()]
      .filter((r) => !r.closedAt && r.seats.some((s) => !s.bot && s.connected))
      .map((r) => this.listing(r))
      .sort((a, b) => order[a.status] - order[b.status])
      .slice(0, 30);
  }
  /** Public facts about one room for the join form. */
  summary(code: string): RoomSummary {
    const r = this.peek(code);
    this.ensureOpen(r);
    const l = this.listing(r);
    return {
      code: l.code,
      locked: l.locked,
      status: l.status,
      players: l.players,
      maxPlayers: l.maxPlayers,
      host: l.host,
      mapId: l.mapId,
      spectatorOnly: !!r.game || l.players >= l.maxPlayers,
    };
  }
  private listing(r: Readonly<RoomRecord>): RoomListing {
    return {
      code: r.code,
      mapId: r.settings.mapId,
      mode: r.settings.mode,
      players: r.seats.filter((s) => !s.spectator).length,
      humans: r.seats.filter((s) => !s.spectator && !s.bot).length,
      bots: r.seats.filter((s) => s.bot).length,
      spectators: r.seats.filter((s) => s.spectator && s.connected).length,
      maxPlayers: r.settings.maxPlayers,
      locked: !!r.passwordHash,
      status: !r.game ? 'waiting' : r.game.phase === 'finished' ? 'finished' : 'playing',
      host: r.seats.find((s) => s.id === r.hostId)?.name ?? '',
    };
  }
  /**
   * Room view for one seat. Pass the same cache map while broadcasting one revision so
   * spectators (who all see the public game) share a single computed game view.
   */
  view(code: string, id: string, cache?: Map<string, GameView | null>): RoomView {
    const r = this.peek(code);
    const viewer = r.seats.find((s) => s.id === id)?.spectator ? null : id;
    const key = viewer ?? '\u0000spectator';
    let game = cache?.get(key);
    if (game === undefined) {
      game = r.game ? viewFor(r.game, viewer) : null;
      cache?.set(key, game);
    }
    return {
      code: r.code,
      settings: { ...r.settings },
      hostId: r.hostId,
      viewerId: id,
      isHost: r.hostId === id,
      seats: r.seats.map((s) => {
        const { tokenHash, controlEpoch, ...pub } = s;
        const latency = this.latency.get(`${r.code}:${s.id}`);
        return {
          ...pub,
          ...(s.connected && !s.bot && latency !== undefined ? { latency } : {}),
          takeover:
            !s.bot &&
            !s.spectator &&
            !!r.game &&
            !s.connected &&
            s.disconnectedAt !== null &&
            this.now() - s.disconnectedAt >= this.options.takeoverMs,
        };
      }),
      game,
      chat: [...r.chat],
      locked: !!r.passwordHash,
      serverNow: this.now(),
      takeoverAfterMs: this.options.takeoverMs,
      decisionTimeoutMs: (r.settings.turnSeconds ?? 0) * 1000,
      ai: { configured: !!this.options.brain, model: this.options.brain?.model ?? null },
      emotes: (this.emotes.get(r.code) ?? []).filter((e) => this.now() - e.at < EMOTE_SHOW_MS),
      aiActivity: this.aiActivity.get(code) ?? null,
      closedReason: r.closedAt ? (r.closedReason ?? '房间已结束') : null,
    };
  }
  lobby(code: string, id: string, input: unknown) {
    const data = z
      .object({
        type: z.enum([
          'ready',
          'character',
          'team',
          'settings',
          'addBot',
          'removeBot',
          'start',
          'newMatch',
          'leave',
          'afk',
          'rename',
          'kick',
          'close',
          'password',
          'botSettings',
        ]),
        password: z.string().max(64).optional(),
        afk: z.boolean().optional(),
        name: nameSchema.optional(),
        ready: z.boolean().optional(),
        characterId: z.string().optional(),
        team: z.number().int().min(0).max(1).optional(),
        botMode: z.enum(['rule', 'llm']).optional(),
        botLevel: z.enum(['easy', 'normal', 'hard']).optional(),
        settings: settingsSchema.optional(),
        seatId: z.string().optional(),
      })
      .parse(input);
    const r = this.record(code),
      seat = r.seats.find((s) => s.id === id);
    ensure(seat && !seat.bot, '席位不存在');
    const host = r.hostId === id;
    this.ensureOpen(r);
    this.touch(r);
    if (data.type === 'close') {
      ensure(host, '只有房主能结束房间');
      this.close(r, `房主${seat.name}结束了房间`);
      return { closed: r.closedReason! };
    }
    if (data.type === 'password') {
      ensure(host, '只有房主能设置密码');
      const password = data.password ?? '';
      r.passwordSalt = password ? randomBytes(16).toString('hex') : null;
      r.passwordHash = password ? scryptSync(password, r.passwordSalt!, 32).toString('hex') : null;
      this.save(r);
      return {};
    }
    if (data.type === 'leave') {
      if (
        r.game &&
        r.game.phase !== 'finished' &&
        !seat.spectator &&
        !r.game.players.find((p) => p.id === id)?.bankrupt
      )
        r.game = applyAction(r.game, id, { type: 'surrender' }, this.env());
      if (!r.game || r.game.phase === 'finished' || seat.spectator)
        r.seats = r.seats.filter((s) => s.id !== id);
      else {
        seat.connected = false;
        seat.disconnectedAt = this.now();
        seat.spectator = true;
      }
      if (host)
        r.hostId =
          r.seats.find((s) => !s.bot && s.connected)?.id ?? r.seats.find((s) => !s.bot)?.id ?? '';
      this.save(r);
      return {};
    }
    if (data.type === 'newMatch') {
      ensure(host && r.game?.phase === 'finished', '仅房主能在结算后开启新局');
      r.game = null;
      for (const s of r.seats) {
        s.ready = s.bot;
        s.afk = false;
        if (s.spectator) continue;
        s.controlEpoch++;
      }
      this.save(r);
      return {};
    }
    if (data.type === 'afk') {
      ensure(r.game && r.game.phase !== 'finished' && !seat.spectator, '对局进行中才能挂机托管');
      seat.afk = data.afk ?? !seat.afk;
      this.save(r);
      return {};
    }
    if (data.type === 'rename') {
      ensure(data.name, '请输入新昵称');
      seat.name = data.name;
      const player = r.game?.players.find((p) => p.id === id);
      if (player) player.name = data.name;
      this.save(r);
      return {};
    }
    if (data.type === 'kick') {
      const target = r.seats.find((s) => s.id === data.seatId);
      ensure(host && target && target.id !== id && !target.bot, '只有房主能移出其他真人玩家');
      const playing =
        r.game &&
        r.game.phase !== 'finished' &&
        !target.spectator &&
        !r.game.players.find((p) => p.id === target.id)?.bankrupt;
      if (playing) {
        // Mid-match the seat is handed to a rule bot so the game keeps going for everyone.
        target.bot = true;
        target.botMode = 'rule';
        target.afk = false;
        target.tokenHash = '';
        target.connected = true;
        target.disconnectedAt = null;
        target.controlEpoch++;
        log(r.game!, this.env(), 'room', `房主把${target.name}的席位交给机器人代打`);
        for (const [key, grant] of this.grants)
          if (grant.code === r.code && grant.seatId === target.id) this.grants.delete(key);
      } else r.seats = r.seats.filter((s) => s.id !== target.id);
      this.save(r);
      return { removed: target.id };
    }
    ensure(!r.game, '对局开始后不能修改房间设置');
    if (data.type === 'ready') {
      ensure(!seat.spectator, '观众不需要准备');
      seat.ready = data.ready ?? !seat.ready;
    }
    if (data.type === 'character') {
      ensure(
        CHARACTERS.some((c) => c.id === data.characterId),
        '角色不存在',
      );
      seat.characterId = data.characterId!;
      seat.ready = false;
    }
    if (data.type === 'team') {
      ensure(!seat.spectator, '观众不能选择队伍');
      seat.team = data.team ?? 0;
      seat.ready = false;
    }
    if (data.type === 'settings') {
      ensure(host && data.settings, '仅房主可修改设置');
      ensure(
        r.seats.filter((s) => !s.spectator).length <= data.settings.maxPlayers,
        '当前席位超过人数设置',
      );
      r.settings = data.settings;
      for (const s of r.seats) s.ready = s.bot;
    }
    if (data.type === 'addBot') {
      const botMode = data.botMode ?? (this.options.brain ? 'llm' : 'rule');
      ensure(botMode !== 'llm' || this.options.brain, '服务端尚未配置 LLM API，可选择规则机器人');
      ensure(
        host && r.seats.filter((s) => !s.spectator).length < r.settings.maxPlayers,
        '只有房主能在空位添加机器人',
      );
      const players = r.seats.filter((s) => !s.spectator);
      // Unique name, a character nobody has yet, and the smaller team.
      const names = new Set(r.seats.map((s) => s.name));
      let n = 1;
      while (names.has(`AI · ${n}`)) n++;
      const taken = new Set(players.map((s) => s.characterId));
      const characterId =
        data.characterId && CHARACTERS.some((c) => c.id === data.characterId)
          ? data.characterId
          : (CHARACTERS.find((c) => !taken.has(c.id)) ?? CHARACTERS[players.length % 6]).id;
      const team0 = players.filter((s) => s.team === 0).length;
      r.seats.push({
        id: randomUUID(),
        name: `AI · ${n}`,
        characterId,
        team: team0 <= players.length - team0 ? 0 : 1,
        bot: true,
        botMode,
        botLevel: data.botLevel ?? 'normal',
        ready: true,
        spectator: false,
        tokenHash: '',
        connected: true,
        disconnectedAt: null,
        controlEpoch: 0,
      });
    }
    if (data.type === 'botSettings') {
      const bot = r.seats.find((s) => s.id === data.seatId && s.bot);
      ensure(host && bot, '只有房主能调整机器人');
      if (data.botMode) {
        ensure(
          data.botMode !== 'llm' || this.options.brain,
          '服务端尚未配置 LLM API，可选择规则机器人',
        );
        bot.botMode = data.botMode;
      }
      if (data.characterId) {
        ensure(
          CHARACTERS.some((c) => c.id === data.characterId),
          '角色不存在',
        );
        bot.characterId = data.characterId;
      }
      if (data.team !== undefined && r.settings.mode === 'team') bot.team = data.team;
      if (data.botLevel) bot.botLevel = data.botLevel;
    }
    if (data.type === 'removeBot') {
      ensure(host, '只有房主能移除机器人');
      r.seats = r.seats.filter((s) => !(s.bot && s.id === data.seatId));
    }
    if (data.type === 'start') {
      ensure(host, '只有房主能开始比赛');
      const players = r.seats.filter((s) => !s.spectator);
      // The host starting the match is their "ready".
      ensure(
        players.length >= 2 && players.every((s) => s.ready || s.id === r.hostId),
        '请等待所有玩家准备',
      );
      ensure(
        players.every((s) => s.bot || s.connected),
        '请等待断线玩家重新连接',
      );
      r.game = createGame(r.settings, r.seats, randomUUID(), this.env());
    }
    this.save(r);
    return {};
  }
  command(code: string, id: string, input: unknown): CommandResult {
    const cmd = commandSchema.parse(input),
      r = this.record(code),
      seat = r.seats.find((s) => s.id === id);
    ensure(seat && !seat.spectator && !seat.bot, '观众或机器人席位不能执行游戏动作', 403);
    // A player who acts is back at the table.
    if (seat.afk && cmd.action.type !== 'guess') seat.afk = false;
    this.touch(r);
    ensure(r.game, '对局尚未开始');
    const fingerprint = tokenHash(JSON.stringify(cmd));
    const old = this.store.command(code, id, cmd.id);
    if (old) {
      ensure(old.fingerprint === fingerprint, '同一动作 ID 不得用于不同内容');
      return old.result;
    }
    let result: CommandResult;
    try {
      // Side guesses never change the revision, so they are accepted against any revision.
      if (cmd.action.type !== 'guess')
        ensure(cmd.revision === r.game.revision, '局面已更新，请按最新提示重新操作', 409);
      r.game = applyAction(r.game, id, cmd.action, this.env());
      result = { id: cmd.id, ok: true, revision: r.game.revision };
    } catch (error) {
      result = {
        id: cmd.id,
        ok: false,
        revision: r.game.revision,
        error: error instanceof Error ? error.message : '操作失败',
      };
    }
    r.updatedAt = this.now();
    this.store.save(r, { playerId: id, id: cmd.id, fingerprint, result });
    return result;
  }
  /**
   * Store a client's round trip. Returns true when the seat moved between good / ok / poor,
   * which is worth a broadcast; smaller changes ride along with the next view.
   */
  reportLatency(code: string, id: string, rtt: unknown): boolean {
    if (typeof rtt !== 'number' || !Number.isFinite(rtt) || rtt < 0 || rtt > 60000) return false;
    const key = `${code}:${id}`,
      before = this.latency.get(key);
    this.latency.set(key, Math.round(rtt));
    const band = (n: number | undefined) => (n === undefined ? -1 : n < 100 ? 0 : n < 250 ? 1 : 2);
    return band(before) !== band(rtt);
  }
  /** Rate-limited reactions; kept in memory for a few seconds and broadcast with views. */
  emote(code: string, id: string, input: unknown) {
    const emote = z.enum(EMOTES).parse(input);
    const r = this.peek(code),
      seat = r.seats.find((s) => s.id === id);
    ensure(seat, '席位不存在');
    const key = `${r.code}:${id}`,
      now = this.now();
    const last = this.emoteAt.get(key);
    ensure(last === undefined || now - last >= EMOTE_COOLDOWN_MS, '表情发送太快，稍等一下');
    this.emoteAt.set(key, now);
    const list = (this.emotes.get(r.code) ?? []).filter((e) => now - e.at < EMOTE_SHOW_MS);
    list.push({ id: randomUUID(), seatId: id, emote, at: now });
    this.emotes.set(r.code, list.slice(-12));
  }
  chat(code: string, id: string, input: unknown) {
    const text = z.string().trim().min(1).max(200).parse(input),
      r = this.record(code),
      seat = r.seats.find((s) => s.id === id);
    ensure(seat, '席位不存在');
    r.chat.push({ id: randomUUID(), name: seat.name, text, at: this.now() });
    this.touch(r);
    r.chat = r.chat.slice(-40);
    this.save(r);
  }
  /** Whether a tick has real work: expiry/finish, or a seat the server must act for. */
  private tickWork(r: Readonly<RoomRecord>): boolean {
    const g = r.game;
    if (!g || g.phase === 'finished' || r.closedAt) return false;
    if (tickGame(g, this.env()) !== null) return true;
    if (g.trade && this.sideTradeDue(r)) return true;
    const actorId = g.trade ? g.trade.to : actingPlayerId(g);
    const seat = r.seats.find((s) => s.id === actorId);
    if (!seat) return false;
    return (
      seat.bot ||
      !!seat.afk ||
      (!seat.connected &&
        seat.disconnectedAt !== null &&
        this.now() - seat.disconnectedAt >= this.options.takeoverMs) ||
      this.humanTimedOut(r)
    );
  }
  /** An offer between two others has held up a bot's (or away player's) turn long enough. */
  private sideTradeDue(r: Readonly<RoomRecord>) {
    const trade = r.game?.phase !== 'finished' ? r.game?.trade : null;
    if (!trade) return false;
    const turnSeat = r.seats.find((s) => s.id === currentPlayer(r.game!).id);
    return (
      !!turnSeat &&
      ![trade.from, trade.to].includes(turnSeat.id) &&
      (turnSeat.bot || !!turnSeat.afk) &&
      this.now() >= trade.expiresAt - SIDE_TRADE_MS + SIDE_TRADE_GRACE_MS
    );
  }
  /** Human decision limit from the room settings; rooms without one never force a move. */
  private humanTimedOut(r: Readonly<RoomRecord>) {
    const limit = (r.settings.turnSeconds ?? 0) * 1000;
    return !!r.game && limit > 0 && this.now() - r.game.decisionAt >= limit;
  }
  tick(code: string): boolean {
    const committed = this.peek(code);
    let feedback = this.dirtyRooms.delete(code);
    const takeoverSignature =
      committed.game && committed.game.phase !== 'finished'
        ? committed.seats
            .filter(
              (s) =>
                !s.bot &&
                !s.spectator &&
                !s.connected &&
                s.disconnectedAt !== null &&
                this.now() - s.disconnectedAt >= this.options.takeoverMs,
            )
            .map((s) => s.id)
            .sort()
            .join(',')
        : '';
    if ((this.takeoverSignatures.get(code) ?? '') !== takeoverSignature) feedback = true;
    this.takeoverSignatures.set(code, takeoverSignature);
    const pending = this.botJobs.get(code);
    if (pending && !this.validJob(committed, pending)) {
      pending.controller.abort();
      this.botJobs.delete(code);
      this.aiActivity.delete(code);
      feedback = true;
    }
    // Idle rooms (a human is thinking) skip the deep copy entirely.
    if (!this.tickWork(committed)) return feedback;
    const r = this.record(code);
    let changed = false;
    if (r.game) {
      const ticked = tickGame(r.game, this.env());
      if (ticked) {
        r.game = ticked;
        changed = true;
      }
      const job = this.botJobs.get(code);
      if (job && !this.validJob(r, job)) {
        job.controller.abort();
        this.botJobs.delete(code);
        this.aiActivity.delete(code);
        feedback = true;
      }
      // A bot (or an away player) on turn gives an offer between two others ten seconds,
      // then waves it away so humans cannot park the table on a bot's turn.
      if (this.sideTradeDue(r)) {
        try {
          r.game = applyAction(
            r.game,
            currentPlayer(r.game).id,
            { type: 'tradeReject' },
            this.env(),
          );
          changed = true;
        } catch {
          // The offer changed meanwhile; the next tick looks again.
        }
      }
      if (r.game.phase !== 'finished') {
        const offerTarget = r.game.trade && r.seats.find((s) => s.id === r.game!.trade!.to);
        const actorId = offerTarget ? offerTarget.id : actingPlayerId(r.game);
        const seat = r.seats.find((s) => s.id === actorId);
        const takeover =
          seat &&
          !seat.connected &&
          seat.disconnectedAt !== null &&
          this.now() - seat.disconnectedAt >= this.options.takeoverMs;
        const timeout = this.humanTimedOut(r);
        if (seat && (seat.bot || seat.afk || takeover || timeout)) {
          const level = seat.bot ? (seat.botLevel ?? 'normal') : 'normal';
          const decision =
            timeout && !seat.bot && !seat.afk && !takeover
              ? null
              : botDecision(r.game, seat.id, level);
          const action = decision ? decision.action : this.timeoutAction(r.game, seat.id);
          let detail: string | undefined;
          if (action) {
            if (seat.bot && seat.botMode === 'llm' && this.options.brain) {
              if (this.botJobs.has(code)) {
                if (changed) this.save(r);
                return changed || feedback;
              }
              // The rest of a turn the model already planned: play it without another request.
              const plan = this.plans.get(code);
              if (plan) {
                const g = r.game;
                if (
                  plan.seatId === seat.id &&
                  plan.gameId === g.id &&
                  plan.round === g.round &&
                  plan.turn === g.turn &&
                  plan.phase === g.phase &&
                  !g.trade &&
                  plan.actions.length
                ) {
                  const next = plan.actions.shift()!;
                  if (!plan.actions.length) this.plans.delete(code);
                  try {
                    r.game = applyAction(g, seat.id, next, this.env());
                    this.save(r);
                    return true;
                  } catch {
                    // The plan no longer fits the board: ask the model again.
                    this.plans.delete(code);
                  }
                } else if (plan.gameId !== g.id || plan.round !== g.round || plan.turn !== g.turn)
                  this.plans.delete(code);
              }
              const choices = botChoices(r.game, seat.id);
              // The rule bot's own idea (e.g. an offer for the last square of a set) is always
              // on the list, so the model can take it.
              if (!choices.some((c) => JSON.stringify(c) === JSON.stringify(action)))
                try {
                  applyAction(r.game, seat.id, action, this.env());
                  choices.unshift(action);
                } catch {
                  // Not legal right now; the model chooses from the rest.
                }
              if (choices.length > 1) {
                // One decision is this seat at this revision; a new decision waits afresh.
                const key = `${seat.id}:${r.game.revision}`;
                const queued = this.queuedSince.get(code);
                const since = queued?.key === key ? queued.since : this.now();
                if (this.botJobs.size < (this.options.aiMaxConcurrent ?? 4)) {
                  this.queuedSince.delete(code);
                  // The two-minute cap counts the time spent queueing.
                  this.startBotJob(r, seat, choices, action, decision?.reason, since);
                  feedback = true;
                  if (changed) this.save(r);
                  return changed || feedback;
                }
                // Every model slot is busy: wait a little instead of handing over at once.
                this.queuedSince.set(code, { key, since });
                if (this.now() - since < AI_QUEUE_MAX_MS) {
                  this.aiActivity.set(code, {
                    playerId: seat.id,
                    state: 'queued',
                    message: '排队等待模型',
                    at: this.now(),
                  });
                  if (changed) this.save(r);
                  return true;
                }
                this.queuedSince.delete(code);
                this.aiActivity.set(code, {
                  playerId: seat.id,
                  state: 'fallback',
                  message: '模型排队超过 20 秒，规则机器人继续',
                  at: this.now(),
                });
                detail = '规则兜底';
                feedback = true;
              } else detail = '只有一个可选动作';
            }
            try {
              r.game = applyAction(r.game, seat.id, action, this.env());
              changed = true;
              if (decision?.reason && EXPLAINED.has(action.type))
                log(
                  r.game,
                  this.env(),
                  'ai',
                  `${seat.name}：${decision.reason}`,
                  seat.id,
                  undefined,
                  undefined,
                  detail ? { detail } : undefined,
                );
            } catch (error) {
              console.error(
                JSON.stringify({
                  level: 'warn',
                  event: 'bot_rejected',
                  code,
                  action: action.type,
                  message: (error as Error).message,
                }),
              );
              // Last line of defence: the plain timeout move keeps the table moving.
              const safe = this.timeoutAction(r.game, seat.id);
              if (safe && safe.type !== action.type)
                try {
                  r.game = applyAction(r.game, seat.id, safe, this.env());
                  changed = true;
                } catch {
                  // Nothing safe to do now; the next tick sees a fresh state.
                }
            }
          }
        }
      }
    }
    if (changed) this.save(r);
    return changed || feedback;
  }
  private validJob(
    r: Readonly<RoomRecord>,
    job: { gameId: string; revision: number; seatId: string; epoch: number },
  ) {
    const seat = r.seats.find((s) => s.id === job.seatId);
    return (
      r.game?.id === job.gameId &&
      r.game.revision === job.revision &&
      r.game.phase !== 'finished' &&
      !!seat?.bot &&
      seat.botMode === 'llm' &&
      seat.controlEpoch === job.epoch &&
      (r.game.trade?.to ?? actingPlayerId(r.game)) === seat.id
    );
  }
  private startBotJob(
    r: RoomRecord,
    seat: Seat,
    choices: GameAction[],
    fallback: GameAction,
    fallbackReason?: string,
    queuedAt = this.now(),
  ) {
    const game = r.game!,
      code = r.code;
    const fullCap = this.options.aiDecisionCapMs ?? AI_DECISION_CAP_MS;
    const capMs = Math.max(Math.min(fullCap, 5000), fullCap - (this.now() - queuedAt));
    const job = {
      controller: new AbortController(),
      gameId: game.id,
      revision: game.revision,
      seatId: seat.id,
      epoch: seat.controlEpoch,
      startedAt: this.now(),
      capped: false,
    };
    this.botJobs.set(code, job);
    // Hard cap: an AI seat never holds the table longer than two minutes.
    const cap = setTimeout(() => {
      job.capped = true;
      job.controller.abort();
    }, capMs);
    job.controller.signal.addEventListener('abort', () => clearTimeout(cap), { once: true });
    const clearCap = () => clearTimeout(cap);
    this.aiActivity.set(code, {
      playerId: seat.id,
      state: 'thinking',
      message: 'LLM 正在思考，服务端会校验操作',
      at: this.now(),
    });
    const finish = (decision: AiDecision) => {
      clearCap();
      if (this.botJobs.get(code) !== job) return;
      this.botJobs.delete(code);
      const latest = this.store.get(code);
      // Aborted jobs are stale (another action, shutdown) unless the two-minute cap fired:
      // then the rule bot plays instead.
      if (
        !latest ||
        !this.validJob(latest, job) ||
        (job.controller.signal.aborted && !job.capped)
      ) {
        this.aiActivity.delete(code);
        this.dirtyRooms.add(code);
        return;
      }
      // Trades are where a manipulated model could give assets away: the rule bot's value
      // check has the final word on accepting one.
      if (
        decision.source === 'llm' &&
        ((decision.action.type === 'tradeAccept' && fallback.type === 'tradeReject') ||
          ((decision.action.type === 'tradeOffer' || decision.action.type === 'tradeCounter') &&
            this.givesAway(latest.game!, seat.id, decision.action)))
      )
        decision = {
          action: fallback,
          source: 'rule',
          message: '交易估值不划算，规则机器人否决',
          ...(fallbackReason ? { reason: fallbackReason } : {}),
          steps: decision.steps ?? [],
        };
      try {
        try {
          latest.game = applyAction(latest.game!, seat.id, decision.action, this.env());
        } catch {
          try {
            latest.game = applyAction(latest.game!, seat.id, fallback, this.env());
            decision = {
              action: fallback,
              source: 'rule',
              message: '模型操作无效，规则机器人继续',
              ...(fallbackReason ? { reason: fallbackReason } : {}),
              steps: decision.steps ?? [],
            };
          } catch {
            // The state moved under the rule move too: fall back to the plain timeout move.
            const safe = this.timeoutAction(latest.game!, seat.id);
            if (!safe) throw Error('no safe move');
            latest.game = applyAction(latest.game!, seat.id, safe, this.env());
            decision = { action: safe, source: 'rule', message: '采用保守操作继续' };
          }
        }
        const steps = decision.steps ?? [];
        // Remember the rest of the turn the model planned; each move is re-checked when used.
        if (decision.source === 'llm' && decision.plan?.length)
          this.plans.set(code, {
            gameId: latest.game!.id,
            seatId: seat.id,
            round: latest.game!.round,
            turn: latest.game!.turn,
            phase: latest.game!.phase,
            actions: [...decision.plan],
          });
        log(
          latest.game,
          this.env(),
          'ai',
          `${seat.name}：${
            decision.reason ??
            (decision.source === 'llm' ? 'LLM 已完成决策' : '规则机器人接管本次决策')
          }`,
          seat.id,
          undefined,
          undefined,
          {
            detail: [
              decision.source === 'llm' ? 'LLM' : '规则兜底',
              ...(steps.length ? [steps.join(' → ')] : []),
            ].join(' · '),
          },
        );
        this.save(latest);
        this.aiActivity.set(code, {
          playerId: seat.id,
          state: decision.source === 'llm' ? 'ready' : 'fallback',
          message: decision.message,
          at: this.now(),
        });
      } catch {
        this.aiActivity.set(code, {
          playerId: seat.id,
          state: 'fallback',
          message: '操作尚未确认，将按最新局面重试',
          at: this.now(),
        });
      }
      this.dirtyRooms.add(code);
    };
    const tools = aiTools(game, seat.id, choices);
    const advice = choices.findIndex((c) => JSON.stringify(c) === JSON.stringify(fallback));
    void this.options
      .brain!.choose(viewFor(game, seat.id), choices, fallback, job.controller.signal, {
        tools,
        level: seat.botLevel ?? 'normal',
        observation: observe(game, seat.id),
        labels: labelActions(game, seat.id, choices),
        validate: validator(game, seat.id, () => this.now()),
        ...(advice >= 0 ? { advice } : {}),
        deadline: Date.now() + capMs - 5000,
        ...(fallbackReason ? { fallbackReason } : {}),
        onStep: (label, steps) => {
          if (this.botJobs.get(code) !== job) return;
          this.aiActivity.set(code, {
            playerId: seat.id,
            state: 'thinking',
            message: `正在${label}`,
            steps,
            at: this.now(),
          });
          this.dirtyRooms.add(code);
        },
      })
      .then(finish, () =>
        finish({
          action: fallback,
          source: 'rule',
          message: job.capped
            ? '模型超过两分钟未决定，规则机器人继续'
            : '模型暂不可用，规则机器人继续',
          ...(fallbackReason ? { reason: fallbackReason } : {}),
        }),
      );
  }
  dispose() {
    for (const job of this.botJobs.values()) job.controller.abort();
    this.botJobs.clear();
    this.takeoverSignatures.clear();
  }
  private timeoutAction(g: NonNullable<RoomRecord['game']>, id: string): GameAction | null {
    // A trade offer that runs out of time is declined, never answered with a game move.
    if (g.trade?.to === id) return { type: 'tradeReject' };
    if (actingPlayerId(g) !== id) return null;
    if (g.phase === 'roll') return { type: 'roll' };
    if (g.phase === 'jail') return { type: 'jailRoll' };
    if (g.phase === 'purchase') return { type: 'pass' };
    if (g.phase === 'manage') return { type: 'end' };
    if (g.phase === 'auction') return { type: 'auctionPass' };
    if (g.phase === 'path') return { type: 'choosePath', tile: g.pendingPath!.choices[0] };
    return botAction(g, id);
  }
  /**
   * Room lifecycle, run every 30 s:
   * - open rooms close after `roomIdleMs` without human interaction, or once no human
   *   (player or spectator) has been connected for `emptyCloseMs` (an all-bot table nobody
   *   watches);
   * - closed rooms are deleted `closedTtlMs` after closing.
   * Returns the codes whose sockets the caller must close.
   */
  cleanup(): { closed: { code: string; reason: string }[]; removed: string[] } {
    for (const [key, grant] of this.grants) if (grant.expires < this.now()) this.grants.delete(key);
    const now = this.now();
    const closed: { code: string; reason: string }[] = [];
    const removed: string[] = [];
    for (const peeked of [...this.store.peekAll()]) {
      if (peeked.closedAt) {
        if (now - peeked.closedAt >= (this.options.closedTtlMs ?? 600000)) {
          this.forget(peeked.code);
          removed.push(peeked.code);
        }
        continue;
      }
      const humans = peeked.seats.filter((s) => !s.bot);
      // When the last human was seen: their last action or the moment they disconnected.
      const lastHuman = Math.max(
        peeked.lastActiveAt ?? peeked.createdAt,
        ...humans.map((s) => s.disconnectedAt ?? 0),
      );
      const connected = humans.some((s) => s.connected);
      const idle = now - (peeked.lastActiveAt ?? peeked.createdAt) >= this.options.roomIdleMs;
      const empty = !connected && now - lastHuman >= (this.options.emptyCloseMs ?? 180000);
      if (!idle && !empty) continue;
      const record = this.record(peeked.code);
      this.close(
        record,
        idle
          ? `${Math.round(this.options.roomIdleMs / 60000)} 分钟没有人操作，房间已自动结束`
          : '房间里没有真人玩家或观众，已自动结束',
      );
      closed.push({ code: record.code, reason: record.closedReason! });
    }
    return { closed, removed };
  }
  private forget(code: string) {
    this.store.remove(code);
    this.plans.delete(code);
    this.queuedSince.delete(code);
    this.takeoverSignatures.delete(code);
    this.botJobs.get(code)?.controller.abort();
    this.botJobs.delete(code);
    this.aiActivity.delete(code);
    this.emotes.delete(code);
    for (const key of this.latency.keys()) if (key.startsWith(`${code}:`)) this.latency.delete(key);
    for (const key of this.emoteAt.keys()) if (key.startsWith(`${code}:`)) this.emoteAt.delete(key);
  }
  content() {
    return { maps: MAPS, characters: CHARACTERS, cards: CARDS };
  }
}
