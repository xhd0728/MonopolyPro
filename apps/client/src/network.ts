import { Client, type Room } from '@colyseus/sdk';
import type { GameCommand, RoomView, CommandResult } from '../../../packages/shared/src/index.ts';
export interface Credentials {
  code: string;
  seatId: string;
  token: string;
  roomId?: string;
  key?: string;
}
const server = import.meta.env.DEV
  ? `${location.protocol}//${location.hostname}:8788`
  : location.origin;
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `${server}${path}`,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '网络请求失败');
  return result;
}
export class Connection {
  room?: Room;
  credentials?: Credentials;
  private generation = 0;
  private heartbeat?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private stopped = false;
  pending?: GameCommand;
  private leaving?: {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(
    private receive: (view: RoomView) => void,
    private status: (status: string, latency?: number) => void,
    private error: (message: string) => void,
    private acknowledged: (result?: CommandResult) => void,
    /** The host removed this seat or handed it to a bot. */
    private removed?: (message: string) => void,
  ) {}
  async connect(credentials: Credentials, resume = false) {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeat);
    if (this.credentials && this.credentials.code !== credentials.code && this.pending) {
      this.pending = undefined;
      this.acknowledged();
    }
    this.credentials = credentials;
    this.stopped = false;
    const generation = ++this.generation;
    const previous = this.room;
    this.room = undefined;
    void previous?.leave();
    this.status(resume ? '正在恢复席位' : '正在连接');
    try {
      const c =
        credentials.key && !resume
          ? credentials
          : await api<Credentials>(`/api/rooms/${credentials.code}/resume`, {
              token: credentials.token,
            });
      if (generation !== this.generation) return;
      const client = new Client(server.replace(/^http/, 'ws')),
        room = await client.joinById(c.roomId!, { key: c.key });
      if (generation !== this.generation) {
        void room.leave();
        return;
      }
      this.room = room;
      room.reconnection.enabled = false;
      this.attempts = 0;
      const current = () => generation === this.generation && this.room === room && !this.stopped;
      room.onMessage('view', (view: RoomView) => {
        if (!current()) return;
        this.receive(view);
        this.status('已同步');
        if (this.pending) room.send('command', this.pending);
      });
      room.onMessage('ack', (result: CommandResult) => {
        if (!current()) return;
        if (this.pending?.id === result.id) {
          this.pending = undefined;
          this.acknowledged(result);
          if (!result.ok) this.error(result.error ?? '操作失败');
        }
      });
      room.onMessage('error', (message: string) => {
        if (!current()) return;
        if (this.pending) {
          this.pending = undefined;
          this.acknowledged();
        }
        this.rejectLeave(message);
        this.error(message);
      });
      room.onMessage('notice', (message: string) => {
        if (current()) this.error(message);
      });
      room.onMessage('left', () => {
        if (!current() || !this.leaving) return;
        clearTimeout(this.leaving.timer);
        this.leaving.resolve();
        this.leaving = undefined;
      });
      room.onMessage(
        'pong',
        (at: number) => current() && this.status('已同步', Math.round(performance.now() - at)),
      );
      room.onLeave((code) => {
        if (generation !== this.generation || this.stopped) return;
        if (code === 4002) {
          clearInterval(this.heartbeat);
          this.stopped = true;
          this.status('已被房主移出');
          this.removed?.('房主已把你移出房间，或把你的席位交给了机器人代打。');
          return;
        }
        if (code === 4001) {
          clearInterval(this.heartbeat);
          this.rejectLeave('席位已在其他窗口恢复');
          this.stopped = true;
          this.status('席位已在其他窗口恢复');
          return;
        }
        this.schedule();
      });
      room.onError((_code, message) => {
        if (current()) this.error(message ?? '连接出错');
      });
      room.send('sync');
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (this.room === room) {
          room.send('ping', performance.now());
          if (this.pending) room.send('sync');
        }
      }, 5000);
    } catch (error) {
      if (generation !== this.generation || this.stopped) return;
      this.error((error as Error).message);
      this.schedule();
    }
  }
  private schedule() {
    this.rejectLeave('连接已断开，请恢复连接后退出；恢复凭证已保留');
    this.room = undefined;
    clearInterval(this.heartbeat);
    const delay = Math.min(1000 * 2 ** this.attempts++, 10000);
    this.status(`重连中 · 第 ${this.attempts} 次`);
    this.reconnectTimer = setTimeout(() => {
      if (this.credentials && !this.stopped) void this.connect(this.credentials, true);
    }, delay);
  }
  command(command: GameCommand) {
    this.pending = command;
    this.room?.send('command', command);
  }
  send(type: string, data: unknown) {
    this.room?.send(type, data);
  }
  leave(): Promise<void> {
    if (!this.room || this.stopped)
      return Promise.reject(new Error('请恢复连接后退出；恢复凭证已保留'));
    if (this.leaving) return Promise.reject(new Error('正在确认退出'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.rejectLeave('未收到退出确认，恢复凭证已保留，请稍后重试'),
        5000,
      );
      this.leaving = { resolve, reject, timer };
      this.room!.send('lobby', { type: 'leave' });
    });
  }
  private rejectLeave(message: string) {
    if (!this.leaving) return;
    clearTimeout(this.leaving.timer);
    this.leaving.reject(new Error(message));
    this.leaving = undefined;
  }
  stop() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeat);
    this.rejectLeave('连接已关闭，恢复凭证已保留');
    if (this.pending) {
      this.pending = undefined;
      this.acknowledged();
    }
    const room = this.room;
    this.room = undefined;
    void room?.leave();
  }
}
