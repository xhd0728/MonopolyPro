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
} from '../../../packages/engine/src/index.ts';
import { botAction } from '../../../packages/engine/src/bot.ts';
import {
  commandSchema,
  DEFAULT_SETTINGS,
  settingsSchema,
} from '../../../packages/shared/src/index.ts';
import type {
  CommandResult,
  GameAction,
  RoomListing,
  RoomRecord,
  RoomView,
  Seat,
} from '../../../packages/shared/src/index.ts';
import { Store } from './store.ts';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .refine((s) => !/[\u0000-\u001f<>]/.test(s), '昵称包含无效字符');
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
  decisionTimeoutMs: number;
  maxRooms: number;
  roomIdleMs: number;
  now?: () => number;
}
export class GameService {
  private grants = new Map<string, { code: string; seatId: string; expires: number }>();
  readonly options: ServiceOptions;
  constructor(
    readonly store: Store,
    options: Partial<ServiceOptions> = {},
  ) {
    this.options = {
      takeoverMs: 15000,
      botStepMs: 1200,
      decisionTimeoutMs: 45000,
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
  record(code: string) {
    const record = this.store.get(code.toUpperCase());
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
    ensure(this.store.all().length < this.options.maxRooms, '房间数量达到上限，请稍后再试', 503);
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
    ensure(record.seats.filter((s) => s.spectator).length < 20, '观战席已满');
    const spectator =
      data.spectator || !!record.game || players.length >= record.settings.maxPlayers;
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
    return this.store.all().map((r) => ({
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
  view(code: string, id: string): RoomView {
    const r = this.record(code);
    return {
      code: r.code,
      settings: r.settings,
      hostId: r.hostId,
      viewerId: id,
      isHost: r.hostId === id,
      seats: r.seats.map((s) => {
        const { tokenHash, controlEpoch, ...pub } = s;
        return {
          ...pub,
          takeover:
            !s.bot &&
            !s.spectator &&
            !!r.game &&
            !s.connected &&
            s.disconnectedAt !== null &&
            this.now() - s.disconnectedAt >= this.options.takeoverMs,
        };
      }),
      game: r.game
        ? viewFor(r.game, r.seats.find((s) => s.id === id)?.spectator ? null : id)
        : null,
      chat: r.chat,
      locked: !!r.passwordHash,
      serverNow: this.now(),
      takeoverAfterMs: this.options.takeoverMs,
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
        ]),
        ready: z.boolean().optional(),
        characterId: z.string().optional(),
        team: z.number().int().min(0).max(1).optional(),
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
        if (s.spectator) continue;
        s.controlEpoch++;
      }
      this.save(r);
      return;
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
    ensure(seat && !seat.spectator, '观众不能执行游戏动作', 403);
    ensure(r.game, '对局尚未开始');
    const fingerprint = tokenHash(JSON.stringify(cmd));
    const old = this.store.command(code, id, cmd.id);
    if (old) {
      ensure(old.fingerprint === fingerprint, '同一动作 ID 不得用于不同内容');
      return old.result;
    }
    let result: CommandResult;
    try {
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
  chat(code: string, id: string, input: unknown) {
    const text = z.string().trim().min(1).max(200).parse(input),
      r = this.record(code),
      seat = r.seats.find((s) => s.id === id);
    ensure(seat, '席位不存在');
    r.chat.push({ id: randomUUID(), name: seat.name, text, at: this.now() });
    r.chat = r.chat.slice(-40);
    this.save(r);
  }
  tick(code: string): boolean {
    const r = this.record(code);
    let changed = false;
    if (r.game) {
      const ticked = tickGame(r.game, this.env());
      if (ticked) {
        r.game = ticked;
        changed = true;
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
        const timeout = this.now() - r.game.decisionAt >= this.options.decisionTimeoutMs;
        if (seat && (seat.bot || takeover || timeout)) {
          const action =
            timeout && !seat.bot && !takeover
              ? this.timeoutAction(r.game, seat.id)
              : botAction(r.game, seat.id);
          if (action) {
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
    return changed;
  }
  private timeoutAction(g: NonNullable<RoomRecord['game']>, id: string): GameAction | null {
    if (actingPlayerId(g) !== id) return null;
    if (g.phase === 'roll') return { type: 'roll' };
    if (g.phase === 'purchase') return { type: 'pass' };
    if (g.phase === 'manage') return { type: 'end' };
    if (g.phase === 'auction') return { type: 'auctionPass' };
    if (g.phase === 'path') return { type: 'choosePath', tile: g.pendingPath!.choices[0] };
    return botAction(g, id);
  }
  cleanup(): string[] {
    for (const [key, grant] of this.grants) if (grant.expires < this.now()) this.grants.delete(key);
    const removed: string[] = [];
    for (const r of this.store.all()) {
      if (r.seats.some((s) => s.connected && !s.bot)) continue;
      if (
        this.now() - r.updatedAt > this.options.roomIdleMs ||
        (this.now() - r.createdAt > 60000 && !r.game && !r.seats.some((s) => s.connected || s.bot))
      ) {
        this.store.remove(r.code);
        removed.push(r.code);
      }
    }
    return removed;
  }
  content() {
    return { maps: MAPS, characters: CHARACTERS, cards: CARDS };
  }
}
