import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { Client, Room, Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ZodError } from 'zod';
import { GameService, RequestError } from './service.ts';
import { Store } from './store.ts';

const numberEnv = (key: string, fallback: number, min = 1) => {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`Invalid ${key}`);
  return value;
};
const port = numberEnv('PORT', 8788),
  host = process.env.HOST ?? '127.0.0.1';
const store = new Store(resolve(process.env.DATA_DIR ?? 'data', 'monopoly.sqlite'));
const service = new GameService(store, {
  takeoverMs: numberEnv('DISCONNECT_TAKEOVER_MS', 15000),
  botStepMs: numberEnv('BOT_STEP_MS', 1200),
  decisionTimeoutMs: numberEnv('DECISION_TIMEOUT_MS', 45000),
  maxRooms: numberEnv('MAX_ROOMS', 200),
  roomIdleMs: numberEnv('ROOM_IDLE_MS', 86400000),
});
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
const http = createServer(app);
const publicOrigin = process.env.PUBLIC_ORIGIN;
const allowedOrigin = (origin: string | undefined) =>
  !origin ||
  origin === publicOrigin ||
  (process.env.NODE_ENV !== 'production' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
const buckets = new Map<string, { count: number; until: number }>();
function allowed(key: string, limit: number, window = 60000) {
  let b = buckets.get(key);
  if (!b || b.until < Date.now()) {
    b = { count: 0, until: Date.now() + window };
    buckets.set(key, b);
  }
  return ++b.count <= limit;
}
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) {
    res.status(403).json({ error: '来源不被允许' });
    return;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  if (
    (req.path.startsWith('/api') || req.path.startsWith('/matchmake')) &&
    !allowed(`http:${req.ip}`, 600)
  ) {
    res.status(429).json({ error: '请求过于频繁，请稍后重试' });
    return;
  }
  next();
});
app.use(express.json({ limit: '8kb' }));
const rooms = new Map<string, MonopolyRoom>(),
  creating = new Map<string, Promise<string>>();
class MonopolyRoom extends Room {
  code = '';
  private occupants = new Map<string, Client>();
  private timer?: ReturnType<typeof setInterval>;
  onCreate(options: { code: string }) {
    service.record(options.code);
    if (rooms.has(options.code)) throw new RequestError('房间运行实例已存在');
    this.code = options.code;
    this.maxClients = 32;
    this.autoDispose = false;
    rooms.set(this.code, this);
    const guard = (client: Client, fn: () => void) => {
      if (this.occupants.get(client.auth as string) !== client) return;
      if (!allowed(`ws:${client.sessionId}`, 60, 10000)) {
        client.send('error', '消息过于频繁');
        return;
      }
      try {
        fn();
      } catch (error) {
        client.send('error', error instanceof ZodError ? '请求格式无效' : (error as Error).message);
      }
    };
    this.onMessage('sync', (c) => guard(c, () => this.sendView(c)));
    this.onMessage('ping', (c, data) => guard(c, () => c.send('pong', data)));
    this.onMessage('command', (c, data) =>
      guard(c, () => {
        const result = service.command(this.code, c.auth, data);
        c.send('ack', result);
        this.views();
      }),
    );
    this.onMessage('lobby', (c, data) =>
      guard(c, () => {
        service.lobby(this.code, c.auth, data);
        this.views();
      }),
    );
    this.onMessage('chat', (c, data) =>
      guard(c, () => {
        service.chat(this.code, c.auth, data);
        this.views();
      }),
    );
    this.timer = setInterval(() => {
      try {
        if (service.tick(this.code)) this.views();
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'room_tick',
            code: this.code,
            message: (error as Error).message,
          }),
        );
      }
    }, service.options.botStepMs);
  }
  onAuth(_client: Client, options: { key?: string }) {
    return service.consumeGrant(this.code, options.key);
  }
  onJoin(client: Client) {
    const id = client.auth as string;
    const old = this.occupants.get(id);
    this.occupants.set(id, client);
    if (old) old.leave(4001, '席位已在其他窗口恢复');
    service.connected(this.code, id);
    this.views();
  }
  onLeave(client: Client) {
    if (!store.get(this.code)) return;
    const id = client.auth as string;
    if (this.occupants.get(id) !== client) return;
    this.occupants.delete(id);
    service.disconnected(this.code, id);
    this.views();
  }
  onDispose() {
    if (this.timer) clearInterval(this.timer);
    if (rooms.get(this.code) === this) rooms.delete(this.code);
  }
  sendView(client: Client) {
    client.send('view', service.view(this.code, client.auth));
  }
  views() {
    for (const client of this.occupants.values()) this.sendView(client);
  }
}
const transport = new WebSocketTransport({
  server: http,
  maxPayload: 8192,
  pingInterval: 5000,
  pingMaxRetries: 3,
  beforeUpgrade: (context) => {
    if (!allowedOrigin(context.headers.get('origin') ?? undefined))
      return new Response('Origin denied', { status: 403 });
  },
});
const gameServer = new Server({ transport, gracefullyShutdown: false, greet: false });
gameServer.define('monopoly', MonopolyRoom);
async function ensureRoom(code: string): Promise<string> {
  const existing = rooms.get(code);
  if (existing) return existing.roomId;
  const pending = creating.get(code);
  if (pending) return pending;
  const creation = matchMaker
    .createRoom('monopoly', { code })
    .then((r) => r.roomId)
    .finally(() => creating.delete(code));
  creating.set(code, creation);
  return creation;
}
async function credentials(input: { code: string; seatId: string; token: string }) {
  return {
    ...input,
    roomId: await ensureRoom(input.code),
    ...service.grant(input.code, input.token),
  };
}
app.get('/healthz', (_req, res) => {
  store.db.prepare('SELECT 1').get();
  res.json({
    ok: true,
    version: '0.1.0',
    rooms: store.all().length,
    uptime: Math.floor(process.uptime()),
  });
});
app.get('/api/content', (_req, res) => res.json(service.content()));
app.get('/api/rooms', (_req, res) => res.json(service.list()));
app.post('/api/rooms', async (req, res) => {
  if (!allowed(`create:${req.ip}`, 30)) {
    res.status(429).json({ error: '建房过于频繁' });
    return;
  }
  res.json(await credentials(service.create(req.body)));
});
app.post('/api/rooms/:code/join', async (req, res) =>
  res.json(await credentials(service.join(String(req.params.code).toUpperCase(), req.body))),
);
app.post('/api/rooms/:code/resume', async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  service.authenticate(code, req.body?.token);
  res.json({
    code,
    token: req.body.token,
    roomId: await ensureRoom(code),
    ...service.grant(code, req.body.token),
  });
});
const clientDir = resolve('dist/client');
if (existsSync(clientDir)) {
  app.use(express.static(clientDir, { index: 'index.html', maxAge: '1h' }));
  app.get('/', (_req, res) => res.sendFile(resolve(clientDir, 'index.html')));
}
app.use(
  (error: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status =
      error instanceof RequestError ? error.status : error instanceof ZodError ? 400 : 500;
    console.error(
      JSON.stringify({
        level: status < 500 ? 'warn' : 'error',
        event: 'http_error',
        path: req.path,
        message: error.message,
      }),
    );
    res.status(status).json({
      error:
        error instanceof ZodError
          ? '请求格式无效'
          : status === 500
            ? '服务暂时不可用'
            : error.message,
    });
  },
);
const cleanup = setInterval(() => {
  for (const code of service.cleanup()) {
    void rooms.get(code)?.disconnect();
  }
  for (const [key, b] of buckets) if (b.until < Date.now()) buckets.delete(key);
}, 30000);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanup);
  console.log(JSON.stringify({ level: 'info', event: 'shutdown' }));
  await gameServer.gracefullyShutdown(false);
  store.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
await gameServer.listen(port, host);
console.log(
  JSON.stringify({
    level: 'info',
    event: 'listening',
    host,
    port,
    node: process.version,
    restoredRooms: store.all().length,
  }),
);
