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
} from '../../../packages/engine/src/index.ts';
import { botAction } from '../../../packages/engine/src/bot.ts';
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
  RoomRecord,
  RoomView,
  Seat,
} from '../../../packages/shared/src/index.ts';
import { Store } from './store.ts';
import type { BotBrain, AiDecision } from './ai.ts';
import { botChoices } from './bot-choices.ts';

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
  roomIdleMs: number;
  now?: () => number;
  brain?: BotBrain;
  aiMaxConcurrent?: number;
  /** Upper bound for one AI decision (default two minutes). */
  aiDecisionCapMs?: number;
}
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
      roomIdleMs: 86400000,
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
    this.checkPassword(record, data.password);
    const players = record.seats.filter((s) => !s.spectator);
    const spectator =
      data.spectator || !!record.game || players.length >= record.settings.maxPlayers;
    ensure(!spectator || record.seats.filter((s) => s.spectator).length < 20, '观战席已满');
    const { seat, token } = this.newSeat(data, players.length, spectator);
    record.seats.push(seat);
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
  list(): RoomListing[] {
    return [...this.store.peekAll()].map((r) => ({
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
    }));
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
        ]),
        afk: z.boolean().optional(),
        name: nameSchema.optional(),
        ready: z.boolean().optional(),
        characterId: z.string().optional(),
        team: z.number().int().min(0).max(1).optional(),
        botMode: z.enum(['rule', 'llm']).optional(),
        settings: settingsSchema.optional(),
        seatId: z.string().optional(),
      })
      .parse(input);
    const r = this.record(code),
      seat = r.seats.find((s) => s.id === id);
    ensure(seat && !seat.bot, '席位不存在');
    const host = r.hostId === id;
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
      return;
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
      return;
    }
    if (data.type === 'afk') {
      ensure(r.game && r.game.phase !== 'finished' && !seat.spectator, '对局进行中才能挂机托管');
      seat.afk = data.afk ?? !seat.afk;
      this.save(r);
      return;
    }
    if (data.type === 'rename') {
      ensure(data.name, '请输入新昵称');
      seat.name = data.name;
      const player = r.game?.players.find((p) => p.id === id);
      if (player) player.name = data.name;
      this.save(r);
      return;
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
      return target.id;
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
      const index = r.seats.filter((s) => !s.spectator).length;
      r.seats.push({
        id: randomUUID(),
        name: `AI · ${index + 1}`,
        characterId: CHARACTERS[index % 6].id,
        team: index % 2,
        bot: true,
        botMode,
        ready: true,
        spectator: false,
        tokenHash: '',
        connected: true,
        disconnectedAt: null,
        controlEpoch: 0,
      });
    }
    if (data.type === 'removeBot') {
      ensure(host, '只有房主能移除机器人');
      r.seats = r.seats.filter((s) => !(s.bot && s.id === data.seatId));
    }
    if (data.type === 'start') {
      ensure(host, '只有房主能开始比赛');
      const players = r.seats.filter((s) => !s.spectator);
      ensure(players.length >= 2 && players.every((s) => s.ready), '请等待所有玩家准备');
      ensure(
        players.every((s) => s.bot || s.connected),
        '请等待断线玩家重新连接',
      );
      r.game = createGame(r.settings, r.seats, randomUUID(), this.env());
    }
    this.save(r);
  }
  command(code: string, id: string, input: unknown): CommandResult {
    const cmd = commandSchema.parse(input),
      r = this.record(code),
      seat = r.seats.find((s) => s.id === id);
    ensure(seat && !seat.spectator && !seat.bot, '观众或机器人席位不能执行游戏动作', 403);
    // A player who acts is back at the table.
    if (seat.afk && cmd.action.type !== 'guess') seat.afk = false;
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
    r.chat = r.chat.slice(-40);
    this.save(r);
  }
  /** Whether a tick has real work: expiry/finish, or a seat the server must act for. */
  private tickWork(r: Readonly<RoomRecord>): boolean {
    const g = r.game;
    if (!g || g.phase === 'finished') return false;
    if (tickGame(g, this.env()) !== null) return true;
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
          const action =
            timeout && !seat.bot && !seat.afk && !takeover
              ? this.timeoutAction(r.game, seat.id)
              : botAction(r.game, seat.id);
          if (action) {
            if (seat.bot && seat.botMode === 'llm' && this.options.brain) {
              if (!this.botJobs.has(code)) {
                if (this.botJobs.size < (this.options.aiMaxConcurrent ?? 4)) {
                  const choices = botChoices(r.game, seat.id);
                  if (choices.length > 1) {
                    this.startBotJob(r, seat, choices, action);
                    feedback = true;
                    if (changed) this.save(r);
                    return changed || feedback;
                  }
                } else {
                  this.aiActivity.set(code, {
                    playerId: seat.id,
                    state: 'fallback',
                    message: '模型忙，规则机器人继续',
                    at: this.now(),
                  });
                  feedback = true;
                }
              } else {
                if (changed) this.save(r);
                return changed || feedback;
              }
            }
            try {
              r.game = applyAction(r.game, seat.id, action, this.env());
              changed = true;
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
  private startBotJob(r: RoomRecord, seat: Seat, choices: GameAction[], fallback: GameAction) {
    const game = r.game!,
      code = r.code;
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
    }, this.options.aiDecisionCapMs ?? AI_DECISION_CAP_MS);
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
      try {
        try {
          latest.game = applyAction(latest.game!, seat.id, decision.action, this.env());
        } catch {
          latest.game = applyAction(latest.game!, seat.id, fallback, this.env());
          decision = { action: fallback, source: 'rule', message: '模型操作无效，规则机器人继续' };
        }
        log(
          latest.game,
          this.env(),
          'ai',
          `${seat.name}：${decision.source === 'llm' ? 'LLM 已完成决策' : '规则机器人接管本次决策'}`,
          seat.id,
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
    void this.options
      .brain!.choose(viewFor(game, seat.id), choices, fallback, job.controller.signal)
      .then(finish, () =>
        finish({
          action: fallback,
          source: 'rule',
          message: job.capped
            ? '模型超过两分钟未决定，规则机器人继续'
            : '模型暂不可用，规则机器人继续',
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
  cleanup(): string[] {
    for (const [key, grant] of this.grants) if (grant.expires < this.now()) this.grants.delete(key);
    const removed: string[] = [];
    for (const r of [...this.store.peekAll()]) {
      if (r.seats.some((s) => s.connected && !s.bot)) continue;
      if (
        this.now() - r.updatedAt > this.options.roomIdleMs ||
        (this.now() - r.createdAt > 60000 && !r.game && !r.seats.some((s) => s.connected || s.bot))
      ) {
        this.store.remove(r.code);
        this.takeoverSignatures.delete(r.code);
        this.botJobs.get(r.code)?.controller.abort();
        this.botJobs.delete(r.code);
        this.aiActivity.delete(r.code);
        this.emotes.delete(r.code);
        for (const key of this.latency.keys())
          if (key.startsWith(`${r.code}:`)) this.latency.delete(key);
        for (const key of this.emoteAt.keys())
          if (key.startsWith(`${r.code}:`)) this.emoteAt.delete(key);
        removed.push(r.code);
      }
    }
    return removed;
  }
  content() {
    return { maps: MAPS, characters: CHARACTERS, cards: CARDS };
  }
}
