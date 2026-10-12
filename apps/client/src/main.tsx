import './style.css';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BOARD,
  DECK_CARDS,
  MAPS,
  CHARACTERS,
  CARDS,
  CATEGORY_NAMES,
  mapById,
  characterById,
  cardById,
  countryFlag,
} from '../../../packages/content/src/index.ts';
import {
  DEFAULT_SETTINGS,
  TURN_SECONDS,
  type RoomSettings,
  type RoomListing,
  type RoomView,
  type GameAction,
  type GameView,
  type CardDefinition,
} from '../../../packages/shared/src/index.ts';
import { Board } from './Board.tsx';
import { Assets } from './Assets.tsx';
import { PlayerRoster, PlayerDetails } from './Players.tsx';
import { money, cardTargetReason, validMoney, groupColor } from './game-ui.ts';
import {
  MatchHud,
  ActionAnnouncements,
  adviceFor,
  phaseGuide,
  type HudAction,
} from './GameHud.tsx';
import { api, Connection, type Credentials } from './network.ts';
import { Clock, serverTime, setServerOffset } from './clock.tsx';
import { EmoteBar, Headlines, useLiveEmotes, useTurnAttention } from './Feedback.tsx';
import { TradeDialog, TradeOfferCard, tradeBlock, type TradeDraft } from './Trade.tsx';
import './theme.css';
const phaseNames = {
  roll: '掷骰出发',
  jail: '拘留所',
  manage: '经营时间',
  purchase: '购买地产',
  auction: '公开拍卖',
  path: '选择道路',
  debt: '筹集资金',
  finished: '旅程结算',
};
const kindNames = {
  start: `起点 · 经过领取 ${BOARD.salary}`,
  property: '可购买的地产',
  bank: '银行 · 每轮利息 3%',
  shop: '卡牌商店 · 最多 8 张',
  chance: '机会 · 抽一张机会卡（多为移动与惊喜）',
  fate: '命运 · 抽一张命运卡（多为现金与全场事件）',
  tax: '公共税费 · 进入停车场奖池',
  jail: '拘留所 · 路过只是探访',
  parking: '免费停车场 · 领取全部奖池',
  gotojail: '遣返 · 直接前往拘留所',
  transit: '轮渡 · 船票 80',
};
const NO_EMOTES: RoomView['emotes'] = [];
/** End-condition choices for the lobby, encoded as mode:value. */
const END_CHOICES: [string, string][] = [
  ['rounds:8', '8 轮（约 15 分钟）'],
  ['rounds:12', '12 轮（默认，约 20–25 分钟）'],
  ['rounds:16', '16 轮（约 30 分钟）'],
  ['rounds:24', '24 轮（长局）'],
  ['time:15', '限时 15 分钟'],
  ['time:30', '限时 30 分钟'],
  ['time:45', '限时 45 分钟'],
  ['time:60', '限时 60 分钟'],
  ['target:10000', '净资产先到 10,000'],
  ['target:15000', '净资产先到 15,000'],
  ['target:25000', '净资产先到 25,000'],
];
const endValue = (s: RoomSettings) => {
  const end = s.end ?? 'time';
  const value = `${end}:${end === 'rounds' ? s.rounds : end === 'time' ? s.minutes : s.target}`;
  return END_CHOICES.some(([v]) => v === value) ? value : END_CHOICES[1][0];
};
/** How far along the match is, in the terms of its end condition. */
function MatchProgress({ game }: { game: GameView }) {
  const s = game.settings;
  const leader = Math.max(...game.players.filter((p) => !p.bankrupt).map((p) => p.assets));
  const share =
    s.end === 'rounds'
      ? Math.min(1, (game.round - 1) / s.rounds)
      : s.end === 'target'
        ? Math.min(1, leader / s.target)
        : null;
  return (
    <span className="meta-clock">
      {s.end === 'rounds' ? (
        <>
          第 <b>{Math.min(game.round, s.rounds)}</b> / {s.rounds} 轮
        </>
      ) : s.end === 'target' ? (
        <>
          目标 {money(s.target)} · 领先者 {Math.round(Math.min(1, leader / s.target) * 100)}%
        </>
      ) : (
        <>
          <Clock>
            {(now) => Math.max(0, Math.min(s.minutes, Math.ceil((game.endsAt - now) / 60000)))}
          </Clock>{' '}
          分钟剩余
        </>
      )}
      {share !== null && (
        <i className="meta-bar" aria-hidden="true">
          <i style={{ width: `${share * 100}%` }} />
        </i>
      )}
      {game.finale && <em className="meta-finale">🔥 终局冲刺 · 租金 ×1.5</em>}
    </span>
  );
}
function Modal({
  title,
  children,
  close,
  closeLabel = '关闭',
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  closeLabel?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    root.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const items = [
          ...(root.current?.querySelectorAll<HTMLElement>('button,input,select,[tabindex="0"]') ??
            []),
        ].filter((item) => !item.hasAttribute('disabled') && item.getClientRects().length > 0);
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === root.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={root}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label={closeLabel} onClick={close}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function App() {
  const [room, setRoom] = useState<RoomView | null>(null),
    [status, setStatus] = useState('尚未连接'),
    [latency, setLatency] = useState<number>(),
    [toast, setToast] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [list, setList] = useState<RoomListing[]>([]);
  const [name, setName] = useState(localStorage.getItem('mp-name') ?? '旅行家'),
    [code, setCode] = useState(new URLSearchParams(location.search).get('room') ?? ''),
    [password, setPassword] = useState(''),
    [settings, setSettings] = useState<RoomSettings>(DEFAULT_SETTINGS),
    [role, setRole] = useState('builder');
  const [dialog, setDialog] = useState<
      'create' | 'join' | 'rules' | 'settings' | 'trade' | 'card' | 'shop' | 'exit' | null
    >(null),
    [rulesTab, setRulesTab] = useState('规则'),
    [selectedTile, setSelectedTile] = useState<number | null>(null),
    [selectedCard, setSelectedCard] = useState<CardDefinition | null>(null),
    [cardTarget, setCardTarget] = useState(''),
    [diceValue, setDiceValue] = useState(3),
    [bid, setBid] = useState(10),
    [chat, setChat] = useState(''),
    [panel, setPanel] = useState('操作'),
    [sheetOpen, setSheetOpen] = useState(false);
  const [inspectedPlayer, setInspectedPlayer] = useState<string | null>(null);
  const inspectPlayer = useCallback((id: string) => {
    setSelectedTile(null);
    setInspectedPlayer(id);
  }, []);
  const [botMode, setBotMode] = useState<'rule' | 'llm'>('llm');
  const automaticSheet = useRef(false),
    pendingAction = useRef<GameAction | null>(null);
  const [emotesOn, setEmotesOn] = useState(localStorage.getItem('mp-emotes') !== 'false'),
    [reduced, setReduced] = useState(localStorage.getItem('mp-reduced') === 'true'),
    [hints, setHints] = useState(localStorage.getItem('mp-hints') !== 'false'),
    [tutorial, setTutorial] = useState<number | null>(null),
    [tutorialGame, setTutorialGame] = useState(false);
  const [tradeDraft, setTradeDraft] = useState<TradeDraft | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    connection = useRef<Connection | null>(null);
  const notify = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6500);
  };
  if (!connection.current)
    connection.current = new Connection(
      (v) => {
        setServerOffset(v.serverNow - Date.now());
        setRoom(v);
      },
      (s, l) => {
        setStatus(s);
        if (l !== undefined) setLatency(l);
      },
      notify,
      (result) => {
        setPending(false);
        if (
          result?.ok &&
          ['playCard', 'tradeOffer', 'tradeCounter'].includes(pendingAction.current?.type ?? '')
        ) {
          setDialog(null);
        }
        pendingAction.current = null;
      },
      (message) => {
        localStorage.removeItem('mp-seat');
        setRoom(null);
        setDialog(null);
        history.replaceState({}, '', '/');
        notify(message);
        void refresh();
      },
    );
  useEffect(() => {
    const raw = localStorage.getItem('mp-seat');
    if (raw) {
      try {
        const c = JSON.parse(raw) as Credentials;
        void connection.current!.connect(c, true);
      } catch {
        localStorage.removeItem('mp-seat');
      }
    }
    void refresh();
    return () => {
      connection.current?.stop();
    };
  }, []);
  useEffect(() => {
    if (!room?.game) return;
    const g = room.game;
    if (tutorialGame && tutorial === 0) setTutorial(1);
    if (tutorialGame && tutorial === 1 && g.phase === 'purchase' && g.activeId === room.viewerId)
      setTutorial(2);
    if (tutorialGame && tutorial === 2 && g.phase === 'manage') setTutorial(3);
    if (tutorialGame && tutorial === 3 && g.turn > 0) setTutorial(4);
  }, [room?.game?.revision]);
  useEffect(() => {
    if (room?.game?.auction) setBid(room.game.auction.highBid + 10);
  }, [room?.game?.auction?.highBid]);
  useEffect(() => {
    const game = room?.game;
    if (!game || !window.matchMedia('(max-width: 800px)').matches) return;
    if (
      game.trade?.to === room.viewerId ||
      (game.activeId === room.viewerId &&
        ['purchase', 'path', 'auction', 'debt'].includes(game.phase))
    ) {
      setPanel('操作');
      setSheetOpen(true);
      automaticSheet.current = true;
    } else if (automaticSheet.current) {
      setSheetOpen(false);
      automaticSheet.current = false;
    }
  }, [room?.game?.phase, room?.game?.activeId, room?.game?.trade?.id, room?.viewerId]);
  async function refresh() {
    try {
      setList(await api<RoomListing[]>('/api/rooms'));
    } catch {
      notify('暂时无法读取大厅，请确认服务已启动');
    }
  }
  async function enter(create: boolean, spectator = false, teaching = false) {
    if (busy) return;
    setBusy(true);
    try {
      localStorage.setItem('mp-name', name);
      const chosen = teaching
        ? { ...DEFAULT_SETTINGS, maxPlayers: 2, end: 'rounds' as const, rounds: 6 }
        : settings;
      const c = await api<Credentials>(
        create ? '/api/rooms' : `/api/rooms/${code.trim().toUpperCase()}/join`,
        create
          ? { name, characterId: role, password, settings: chosen }
          : { name, password, characterId: role, spectator },
      );
      localStorage.setItem(
        'mp-seat',
        JSON.stringify({ code: c.code, seatId: c.seatId, token: c.token }),
      );
      await connection.current!.connect(c);
      setDialog(null);
      history.replaceState({}, '', `?room=${c.code}`);
      setSelectedTile(null);
      if (teaching) {
        setTutorialGame(true);
        setTutorial(0);
      }
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function lobby(type: string, extras = {}) {
    if (status !== '已同步') {
      notify('请等待连接恢复后操作');
      return;
    }
    connection.current!.send('lobby', { type, ...extras });
  }
  // Fork squares on the board are clickable choices; any other square opens its details.
  const commandRef = useRef<(action: GameAction) => void>(() => {});
  commandRef.current = command;
  const clickTile = useCallback((tile: number) => {
    const current = roomRef.current,
      game = current?.game;
    if (
      game?.phase === 'path' &&
      game.activeId === current!.viewerId &&
      game.pendingPath?.choices.includes(tile)
    )
      commandRef.current({ type: 'choosePath', tile });
    else setSelectedTile(tile);
  }, []);
  function command(action: GameAction) {
    const g = roomRef.current?.game;
    if (!g || pending || status !== '已同步') return;
    setPending(true);
    pendingAction.current = action;
    connection.current!.command({ id: crypto.randomUUID(), revision: g.revision, action });
  }
  async function leave() {
    if (!connected || busy || pending) {
      notify(pending ? '请等待当前操作确认后退出' : '请恢复连接后退出；恢复凭证已保留');
      return;
    }
    setBusy(true);
    try {
      await connection.current!.leave();
      connection.current!.stop();
      localStorage.removeItem('mp-seat');
      setRoom(null);
      setDialog(null);
      setStatus('尚未连接');
      history.replaceState({}, '', '/');
      setTutorial(null);
      setTutorialGame(false);
      void refresh();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const g = room?.game,
    me = g?.players.find((p) => p.id === room!.viewerId),
    map = mapById(room?.settings.mapId ?? settings.mapId),
    active = g?.players.find((p) => p.id === g.activeId),
    myTurn = !!g && g.activeId === room?.viewerId && !me?.bankrupt,
    canManage = myTurn && ['roll', 'manage'].includes(g!.phase) && !g!.trade;
  const connected = status === '已同步',
    disabled = pending || !connected;
  const selected = selectedTile === null ? null : map.tiles[selectedTile],
    property = g?.properties.find((p) => p.tile === selectedTile),
    owner = g?.players.find((p) => p.id === property?.owner);
  const openCard = (id: string) => {
    setSelectedCard(cardById(id)!);
    setCardTarget('');
    setDialog('card');
  };
  const cardCandidates =
    selectedCard?.target === 'player'
      ? g?.players
          .filter(
            (p) =>
              p.id !== me?.id && !p.bankrupt && (g.settings.mode !== 'team' || p.team !== me?.team),
          )
          .map((p) => ({ id: p.id, name: p.name }))
      : g?.properties
          .filter(
            (p) =>
              selectedCard?.target === 'tile' ||
              (selectedCard?.target === 'ownProperty' && p.owner === me?.id) ||
              (selectedCard?.target === 'emptyProperty' && !p.owner) ||
              (selectedCard?.target === 'enemyProperty' &&
                p.owner &&
                p.owner !== me?.id &&
                (g.settings.mode !== 'team' ||
                  g.players.find((x) => x.id === p.owner)?.team !== me?.team)),
          )
          .map((p) => ({
            id: String(p.tile),
            name: `${map.tiles[p.tile].name} · ${p.level} 级${p.protectedUntil >= g.round ? ' · 保护中' : ''}`,
          }));
  const cardTargets = (cardCandidates ?? []).map((target) => ({
    ...target,
    reason:
      selectedCard && g
        ? cardTargetReason(selectedCard, g, me, target.id) ||
          (selectedCard.effect === 'remoteBuy' &&
          (me?.cash ?? 0) <
            (g.properties.find((p) => p.tile === Number(target.id))?.price ??
              map.tiles[Number(target.id)]?.price)
            ? '现金不足'
            : '')
        : '',
  }));
  const chosenCardReason = cardTargets.find((t) => t.id === cardTarget)?.reason ?? '';
  const jailedMove = !!me?.jailTurns && selectedCard?.category === 'move';
  const bidReason = !validMoney(bid)
    ? '请输入整数竞价金额'
    : bid < (g?.auction?.highBid ?? 0) + 10
      ? `至少出价 ${money((g?.auction?.highBid ?? 0) + 10)}`
      : bid > (me?.cash ?? 0)
        ? '竞价不能超过可用现金'
        : '';
  const tradeWhy = g ? tradeBlock(g, me, serverTime()) : '对局尚未开始';
  const openTrade = (to: string, extra: Partial<TradeDraft> = {}) => {
    setTradeDraft({ to, giveCash: 0, wantCash: 0, giveTiles: [], wantTiles: [], ...extra });
    setDialog('trade');
  };
  const inspected = g?.players.find((p) => p.id === inspectedPlayer);
  const lobbyPlayers = room?.seats.filter((s) => !s.spectator) ?? [];
  const startReason =
    lobbyPlayers.length < 2
      ? '需要至少两个席位'
      : !lobbyPlayers.every((s) => s.ready && (s.connected || s.bot))
        ? '请等待所有真人连接并准备'
        : room?.settings.mode === 'team' &&
            (![4, 6].includes(lobbyPlayers.length) ||
              lobbyPlayers.filter((s) => s.team === 0).length !== lobbyPlayers.length / 2)
          ? '团队需均分为 2v2 或 3v3，请补齐人数并调整队伍'
          : '';
  const mySeat = room?.seats.find((s) => s.id === room.viewerId);
  const quickAction = g?.actions.find((a) => a.primary);
  // This seat must decide something now: its own turn, an auction bid or an incoming trade.
  const needsMe = !!g && g.phase !== 'finished' && (myTurn || g.trade?.to === room?.viewerId);
  useTurnAttention(needsMe);
  const liveEmotes = useLiveEmotes(room?.emotes ?? NO_EMOTES, emotesOn);
  const canGuess =
    !!g && !!me && !me.bankrupt && g.phase === 'roll' && g.activeId !== me.id && !g.trade;
  const hudAction: HudAction | null =
    myTurn && quickAction && ['roll', 'jailRoll', 'buy', 'end'].includes(quickAction.action.type)
      ? {
          label: pending ? '等待确认…' : quickAction.label,
          disabled,
          run: () => command(quickAction.action),
        }
      : null;
  const invite = () => {
    const url = `${location.origin}/?room=${room!.code}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => notify('邀请链接已复制，房间密码需单独告知好友'))
      .catch(() => notify(`邀请链接：${url}`));
  };
  return (
    <>
      <div className={`app-shell ${g ? 'in-match' : ''}`} data-reduced-motion={reduced}>
        <header className="topbar">
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              if (room) {
                e.preventDefault();
                setDialog('exit');
              }
            }}
          >
            <span className="brand-mark">M</span>
            <span>
              富翁之旅<small>MONOPOLY PRO</small>
            </span>
          </a>
          <nav>
            <button
              onClick={() => {
                setRulesTab('规则');
                setDialog('rules');
              }}
            >
              规则图鉴
            </button>
            <button onClick={() => setDialog('settings')}>设置</button>
            {room && <button onClick={() => setDialog('exit')}>离开房间</button>}
          </nav>
          <div className={`connection ${connected ? 'online' : ''}`} aria-live="polite">
            <i />
            {room ? status : '朋友的下一场聚会'}
            {connected && latency !== undefined && <small>{latency} ms</small>}
          </div>
        </header>
        {!room ? (
          <main className="home">
            <section className="hero-copy">
              <div className="eyebrow">一场环球之旅 · 和朋友一起经营</div>
              <h1>
                下一站，
                <br />
                成为大富翁<span>。</span>
              </h1>
              <p>
                游历真实国家，打出一张好牌。
                <br />
                经营地产、规划路线，和朋友一起出发。
              </p>
              <div className="hero-actions">
                <button className="primary" onClick={() => setDialog('create')}>
                  创建朋友房间 <span>↗</span>
                </button>
                <button className="secondary" onClick={() => setDialog('join')}>
                  加入房间
                </button>
              </div>
              <button className="text-button" onClick={() => void enter(true, false, true)}>
                ✦ 第一次玩？开始互动教学
              </button>
              <div className="facts">
                <span>
                  <b>2–6</b> 真人 / 机器人
                </span>
                <span>
                  <b>4</b> 主题地图
                </span>
                <span>
                  <b>30</b> 策略卡牌
                </span>
              </div>
            </section>
            <section className="hero-scene">
              <div className="scene-tag">
                {map.name}
                <small>{map.subtitle}</small>
              </div>
              <Board map={map} onTile={setSelectedTile} reduced={reduced} />
              <div className="scene-caption">
                <span>2D 国家路线棋盘</span>
                <span>点击国家查看详情</span>
              </div>
            </section>
            <section className="map-section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">选择你的旅程</div>
                  <h2>四条路线，四种策略</h2>
                </div>
                <span>四种地图机制 · 随时换个主场</span>
              </div>
              <div className="map-grid">
                {MAPS.map((m, i) => (
                  <button
                    className={`map-card ${settings.mapId === m.id ? 'selected' : ''}`}
                    style={{ '--map-color': m.color } as React.CSSProperties}
                    key={m.id}
                    onClick={() => setSettings({ ...settings, mapId: m.id })}
                  >
                    <div className="map-art">
                      <span>{['☀', '≈', '✧', '⌘'][i]}</span>
                      <i />
                      <i />
                      <i />
                    </div>
                    <small>
                      0{i + 1} / {m.recommended}
                    </small>
                    <h3>{m.name}</h3>
                    <p>{m.description}</p>
                    <span className="map-meta">
                      {m.subtitle} <b>↗</b>
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className="lobby-section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">一起玩更有趣</div>
                  <h2>朋友们正在这里</h2>
                </div>
                <button className="secondary" onClick={() => void refresh()}>
                  刷新大厅
                </button>
              </div>
              {list.length ? (
                <div className="room-list">
                  {list.map((r) => (
                    <button
                      key={r.code}
                      onClick={() => {
                        setCode(r.code);
                        setDialog('join');
                      }}
                    >
                      <span className="room-code">
                        {r.locked ? '▣' : '◇'} {r.code}
                      </span>
                      <span>{mapById(r.mapId).name}</span>
                      <span>
                        {r.status === 'waiting'
                          ? '等待组局'
                          : r.status === 'finished'
                            ? '已结算'
                            : '对局中 · 可观战'}
                      </span>
                      <b>
                        {r.players}/{r.maxPlayers} →
                      </b>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state">还没有房间。邀请朋友，开启今天的第一场旅程。</div>
              )}
            </section>
            <footer>
              MONOPOLY PRO <span>沿世界的路线，创造自己的故事。</span>
            </footer>
          </main>
        ) : (
          <main className={`room-page ${g ? 'match-page' : ''}`}>
            {!g && (
              <div className="room-heading">
                <div>
                  <div className="eyebrow">好友专属的起点</div>
                  <h1>
                    准备出发{' '}
                    <span className="badge">
                      {room.settings.mode === 'team'
                        ? '团队战'
                        : room.settings.mode === 'quick'
                          ? '快速战'
                          : '自由战'}
                    </span>
                  </h1>
                </div>
                <div className="invite">
                  <span>
                    房间 <b>{room.code}</b>
                    {room.locked ? ' · 密码房' : ''}
                  </span>
                  <button className="secondary" onClick={invite}>
                    复制邀请
                  </button>
                </div>
              </div>
            )}
            {!g ? (
              <div className="waiting-layout">
                <section className="paper">
                  <div className="section-heading">
                    <h2>旅行伙伴</h2>
                    <span>
                      {room.seats.filter((s) => !s.spectator).length}/{room.settings.maxPlayers}{' '}
                      席位
                    </span>
                  </div>
                  <div className="seat-grid">
                    {room.seats
                      .filter((s) => !s.spectator)
                      .map((s) => {
                        const c = characterById(s.characterId);
                        return (
                          <article
                            className={`seat ${s.id === room.viewerId ? 'self' : ''}`}
                            key={s.id}
                          >
                            <div className="avatar" style={{ background: c.color }}>
                              {c.icon}
                            </div>
                            <div>
                              <h3>
                                {s.name} {s.id === room.hostId && <small>房主</small>}
                              </h3>
                              <p>
                                {c.name} · {c.title}
                              </p>
                              <span className={`seat-status ${s.ready ? 'ready' : ''}`}>
                                {s.bot
                                  ? `${s.botMode === 'llm' ? 'LLM' : '规则'}机器人 · 已准备`
                                  : !s.connected
                                    ? '连接已断开'
                                    : s.ready
                                      ? '已准备'
                                      : '选择角色中'}
                                {room.settings.mode === 'team'
                                  ? ` · ${s.team === 0 ? '青' : '橙'}队`
                                  : ''}
                              </span>
                            </div>
                            {s.bot && room.isHost && (
                              <button
                                className="icon-button"
                                aria-label={`移除${s.name}`}
                                onClick={() => lobby('removeBot', { seatId: s.id })}
                              >
                                ×
                              </button>
                            )}
                            {!s.bot && room.isHost && s.id !== room.viewerId && (
                              <button
                                className="icon-button"
                                aria-label={`移出${s.name}`}
                                title="把这位玩家移出房间"
                                onClick={() => lobby('kick', { seatId: s.id })}
                              >
                                ×
                              </button>
                            )}
                          </article>
                        );
                      })}
                    {Array.from({
                      length: Math.max(
                        0,
                        room.settings.maxPlayers - room.seats.filter((s) => !s.spectator).length,
                      ),
                    }).map((_, i) => (
                      <button
                        className="empty-seat"
                        key={i}
                        disabled={!room.isHost || disabled}
                        title={!room.isHost ? '由房主添加机器人' : '添加一个准备好的机器人席位'}
                        onClick={() =>
                          lobby('addBot', {
                            botMode: tutorialGame || !room.ai.configured ? 'rule' : botMode,
                          })
                        }
                      >
                        ＋<span>{room.isHost ? '添加机器人' : '等待朋友加入'}</span>
                      </button>
                    ))}
                  </div>
                  <div className="section-heading">
                    <h2>选择你的角色</h2>
                    <span>天赋每 3 轮可使用一次</span>
                  </div>
                  <div className="character-grid">
                    {CHARACTERS.map((c) => (
                      <button
                        key={c.id}
                        className={`character ${room.seats.find((s) => s.id === room.viewerId)?.characterId === c.id ? 'selected' : ''}`}
                        disabled={
                          disabled || room.seats.find((s) => s.id === room.viewerId)?.spectator
                        }
                        onClick={() => lobby('character', { characterId: c.id })}
                      >
                        <span className="avatar" style={{ background: c.color }}>
                          {c.icon}
                        </span>
                        <b>{c.name}</b>
                        <small>{c.title}</small>
                        <p>{c.description}</p>
                        <em>{c.ability}</em>
                      </button>
                    ))}
                  </div>
                  {room.settings.mode === 'team' && (
                    <div className="team-picker">
                      <span>我的队伍</span>
                      {[0, 1].map((team) => (
                        <button
                          key={team}
                          disabled={disabled}
                          onClick={() => lobby('team', { team })}
                        >
                          {team === 0 ? '青队' : '橙队'}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="start-bar">
                    <p>
                      所有真人准备后，由房主开始。
                      <br />
                      <small>
                        观战席：{room.seats.filter((s) => s.spectator && s.connected).length}
                      </small>
                    </p>
                    {!room.seats.find((s) => s.id === room.viewerId)?.spectator && (
                      <button
                        className="secondary"
                        disabled={disabled}
                        onClick={() => lobby('ready')}
                      >
                        {room.seats.find((s) => s.id === room.viewerId)?.ready
                          ? '取消准备'
                          : '我准备好了'}
                      </button>
                    )}
                    {room.isHost && (
                      <button
                        className="primary"
                        disabled={disabled || !!startReason}
                        title={startReason || '所有席位已准备，可以出发'}
                        onClick={() => lobby('start')}
                      >
                        开始旅程 →
                      </button>
                    )}
                    {room.isHost && startReason && <p className="hint">{startReason}</p>}
                  </div>
                </section>
                <aside className="paper room-settings">
                  <h2>旅程设置</h2>
                  <label>
                    地图
                    <select
                      value={room.settings.mapId}
                      disabled={!room.isHost || disabled}
                      onChange={(e) =>
                        lobby('settings', { settings: { ...room.settings, mapId: e.target.value } })
                      }
                    >
                      {MAPS.map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="hint">{map.description}</p>
                  <label>
                    模式
                    <select
                      value={room.settings.mode}
                      disabled={!room.isHost || disabled}
                      onChange={(e) =>
                        lobby('settings', {
                          settings: {
                            ...room.settings,
                            mode: e.target.value,
                            end: 'rounds',
                            rounds: e.target.value === 'quick' ? 8 : 12,
                          },
                        })
                      }
                    >
                      <option value="free">自由对战</option>
                      <option value="quick">快速对战</option>
                      <option value="team">团队战 2v2 / 3v3</option>
                    </select>
                  </label>
                  <label>
                    结束方式
                    <select
                      aria-label="结束方式"
                      value={endValue(room.settings)}
                      disabled={!room.isHost || disabled}
                      onChange={(e) => {
                        const [end, raw] = e.target.value.split(':');
                        const n = Number(raw);
                        lobby('settings', {
                          settings: {
                            ...room.settings,
                            end,
                            ...(end === 'rounds' ? { rounds: n } : {}),
                            ...(end === 'time' ? { minutes: n } : {}),
                            ...(end === 'target' ? { target: n } : {}),
                          },
                        });
                      }}
                    >
                      {END_CHOICES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    玩家操作时限
                    <select
                      value={room.settings.turnSeconds ?? 0}
                      disabled={!room.isHost || disabled}
                      onChange={(e) =>
                        lobby('settings', {
                          settings: { ...room.settings, turnSeconds: Number(e.target.value) },
                        })
                      }
                    >
                      {TURN_SECONDS.map((v) => (
                        <option key={v} value={v}>
                          {v ? `${v} 秒后自动推进` : '不限时（默认）'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    起始现金
                    <select
                      value={room.settings.initialCash}
                      disabled={!room.isHost || disabled}
                      onChange={(e) =>
                        lobby('settings', {
                          settings: { ...room.settings, initialCash: Number(e.target.value) },
                        })
                      }
                    >
                      {[1000, 2000, 3000, 5000, 10000].map((v) => (
                        <option key={v} value={v}>
                          {money(v)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="tip-box">
                    ✦{' '}
                    {room.settings.mode === 'team'
                      ? '团队需均分为两队，同队地产免租。'
                      : '到时按现金、存款和地产回收价值，扣除待付债务排名。'}
                    <br />
                    断线 {Math.ceil(room.takeoverAfterMs / 1000)} 秒后机器人临时托管，回来即可接手。
                  </div>
                  <section className="bot-config" aria-label="AI 设置">
                    <label>
                      机器人策略
                      <select
                        aria-label="机器人策略"
                        disabled={!room.isHost || disabled}
                        value={room.ai.configured && !tutorialGame ? botMode : 'rule'}
                        onChange={(e) => setBotMode(e.target.value as 'rule' | 'llm')}
                      >
                        <option value="rule">规则机器人 · 即时决策</option>
                        <option value="llm" disabled={!room.ai.configured || tutorialGame}>
                          LLM 机器人 · 模型策略
                        </option>
                      </select>
                    </label>
                    <p>
                      {tutorialGame
                        ? '教学使用规则机器人，便于逐步练习。'
                        : room.ai.configured
                          ? `模型已配置：${room.ai.model}。超时自动由规则策略继续。`
                          : '模型尚未配置，当前使用规则机器人。API 由服务端部署者配置。'}
                    </p>
                  </section>
                  <Chat
                    room={room}
                    chat={chat}
                    setChat={setChat}
                    send={() => {
                      connection.current!.send('chat', chat);
                      setChat('');
                    }}
                    disabled={disabled}
                  />
                </aside>
              </div>
            ) : (
              <>
                <div className="match-workspace">
                  <PlayerRoster room={room} inspect={inspectPlayer} emotes={liveEmotes} />
                  <div className="game-layout">
                    <section className="board-wrap">
                      <div className="board-meta" data-revision={g.revision}>
                        <span className="meta-map">
                          <b>{map.name}</b>
                          <span className="badge">
                            {room.settings.mode === 'team'
                              ? '团队战'
                              : room.settings.mode === 'quick'
                                ? '快速战'
                                : '自由战'}
                          </span>
                        </span>
                        <span className="meta-phase">{phaseNames[g.phase]}</span>
                        {me && !me.bankrupt && g.phase !== 'finished' && (
                          <button
                            className={`meta-afk ${mySeat?.afk ? 'on' : ''}`}
                            aria-pressed={!!mySeat?.afk}
                            title="挂机托管：规则机器人替你操作；你一操作就自动恢复"
                            disabled={!connected}
                            onClick={() => lobby('afk', { afk: !mySeat?.afk })}
                          >
                            {mySeat?.afk ? (
                              '挂机中 · 回来'
                            ) : (
                              <>
                                🛋<span className="afk-label"> 挂机</span>
                              </>
                            )}
                          </button>
                        )}
                        <MatchProgress game={g} />
                        {emotesOn && (
                          <EmoteBar
                            disabled={!connected}
                            send={(emote) => connection.current!.send('emote', emote)}
                          />
                        )}
                        <span className="meta-room invite">
                          房间 <b>{room.code}</b>
                          <button className="text-button" onClick={invite}>
                            复制邀请
                          </button>
                        </span>
                      </div>
                      <Board
                        center={
                          <>
                            <MatchHud
                              room={room}
                              map={map}
                              rolling={
                                pending &&
                                ['roll', 'jailRoll'].includes(pendingAction.current?.type ?? '')
                              }
                              action={hudAction}
                              {...(canGuess
                                ? {
                                    onGuess: (pick: 'high' | 'low') =>
                                      command({ type: 'guess', pick }),
                                  }
                                : {})}
                            />
                            <Headlines game={g} map={map} reduced={reduced} />
                            <ActionAnnouncements game={g} enabled={hints} />
                          </>
                        }
                        map={map}
                        game={g}
                        highlight={
                          dialog === 'card' && selectedCard
                            ? selectedCard.target === 'player'
                              ? g.players
                                  .filter((p) =>
                                    cardTargets.some((t) => t.id === p.id && !t.reason),
                                  )
                                  .map((p) => p.position)
                              : cardTargets.filter((t) => !t.reason).map((t) => Number(t.id))
                            : (g.pendingPath?.choices ??
                              (selectedTile === null ? [] : [selectedTile]))
                        }
                        onTile={clickTile}
                        reduced={reduced}
                        attention={needsMe}
                        emotes={liveEmotes}
                      />
                    </section>
                    <aside className="game-sidebar">
                      <section className={`paper action-panel ${sheetOpen ? 'sheet-open' : ''}`}>
                        <button
                          className="drawer-close icon-button"
                          aria-label="关闭详情抽屉"
                          onClick={() => {
                            setSheetOpen(false);
                            automaticSheet.current = false;
                          }}
                        >
                          ×
                        </button>
                        <div className="panel-tabs">
                          {['操作', '资产', '动态', '聊天'].map((p) => (
                            <button
                              className={panel === p ? 'selected' : ''}
                              key={p}
                              onClick={() => {
                                setPanel(p);
                                automaticSheet.current = false;
                              }}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                        {panel === '操作' ? (
                          <>
                            <div className="turn-prompt">
                              <span className="eyebrow">
                                {myTurn
                                  ? '轮到你了'
                                  : me?.bankrupt
                                    ? '继续观战'
                                    : '等待时也能查看地图'}
                              </span>
                              <h2>
                                {g.phase === 'finished'
                                  ? '这段旅程，圆满落幕'
                                  : g.trade
                                    ? '交易提案待处理'
                                    : myTurn
                                      ? phaseNames[g.phase]
                                      : `${active?.name ?? '伙伴'}正在操作`}
                              </h2>
                              {adviceFor(g, map) ? (
                                <p className="turn-tip">💡 建议：{adviceFor(g, map)}</p>
                              ) : (
                                <p>{phaseGuide(g, map).text}</p>
                              )}
                              {g.phase !== 'finished' && !g.trade && !room.decisionTimeoutMs && (
                                <span className="decision-timer">
                                  不限时 · 想离开一会儿可以开启挂机托管
                                </span>
                              )}
                              {g.phase !== 'finished' && !g.trade && room.decisionTimeoutMs > 0 && (
                                <span className="decision-timer">
                                  本次决定还剩{' '}
                                  <Clock>
                                    {(now) =>
                                      Math.max(
                                        0,
                                        Math.min(
                                          Math.ceil(room.decisionTimeoutMs / 1000),
                                          Math.ceil(
                                            (room.decisionTimeoutMs - (now - g.decisionAt)) / 1000,
                                          ),
                                        ),
                                      )
                                    }
                                  </Clock>{' '}
                                  秒 · 超时由系统继续推进
                                </span>
                              )}
                            </div>
                            {g.trade && (
                              <TradeOfferCard
                                game={g}
                                map={map}
                                disabled={disabled}
                                command={command}
                                counter={(draft) => {
                                  setTradeDraft(draft);
                                  setDialog('trade');
                                }}
                              />
                            )}
                            <div className="actions">
                              {g.actions
                                .filter((a) => a.primary || a.action.type === 'ferry')
                                .map((a, i) => (
                                  <div key={i}>
                                    <button
                                      className={a.primary ? 'primary' : 'secondary'}
                                      disabled={
                                        disabled ||
                                        !!a.disabled ||
                                        (a.action.type === 'bid' && !!bidReason)
                                      }
                                      title={
                                        a.disabled ??
                                        (a.action.type === 'bid' ? bidReason || a.hint : a.hint)
                                      }
                                      onClick={() =>
                                        command(
                                          a.action.type === 'bid'
                                            ? { type: 'bid', amount: bid }
                                            : a.action,
                                        )
                                      }
                                    >
                                      {pending ? '等待确认…' : a.label}
                                    </button>
                                    {hints && <small>{a.hint}</small>}
                                  </div>
                                ))}
                            </div>
                            {myTurn && g.phase === 'auction' && (
                              <label>
                                我的竞价
                                <input
                                  aria-label="竞价金额"
                                  type="number"
                                  min={g.auction!.highBid + 10}
                                  max={me?.cash}
                                  step={10}
                                  value={bid}
                                  inputMode="numeric"
                                  onChange={(e) => setBid(Number(e.target.value))}
                                />
                                {bidReason && <span className="field-error">{bidReason}</span>}
                              </label>
                            )}
                            {me && (
                              <div className="wallet">
                                <div>
                                  <small>可用现金</small>
                                  <b>{money(me.cash)}</b>
                                </div>
                                <div>
                                  <small>银行存款</small>
                                  <b>{money(me.deposit)}</b>
                                </div>
                                <div>
                                  <small>租金护盾</small>
                                  <b>{me.shield}</b>
                                </div>
                              </div>
                            )}
                            {g.actions
                              .filter(
                                (a) =>
                                  !a.primary &&
                                  ![
                                    'tradeAccept',
                                    'tradeReject',
                                    'ferry',
                                    'build',
                                    'downgrade',
                                    'mortgage',
                                    'redeem',
                                  ].includes(a.action.type),
                              )
                              .map((a, i) => (
                                <button
                                  key={i}
                                  className="secondary full"
                                  disabled={disabled}
                                  title={a.hint}
                                  onClick={() => command(a.action)}
                                >
                                  {a.label}
                                  <small>{a.hint}</small>
                                </button>
                              ))}
                            {me && !me.bankrupt && g.phase !== 'finished' && (
                              <>
                                <div className="inline-actions">
                                  <button
                                    onClick={() => {
                                      setPanel('资产');
                                      if (window.matchMedia('(max-width: 800px)').matches)
                                        setSheetOpen(true);
                                    }}
                                  >
                                    ▤ 管理资产
                                  </button>
                                  <button
                                    disabled={!!tradeWhy || disabled}
                                    title={
                                      tradeWhy || '任何时候都可以和其他玩家交换现金与无建筑的地产'
                                    }
                                    onClick={() =>
                                      openTrade(
                                        g.players.find((p) => p.id !== me.id && !p.bankrupt)?.id ??
                                          '',
                                      )
                                    }
                                  >
                                    ⇄ 发起交易
                                  </button>
                                  <button
                                    disabled={
                                      !canManage ||
                                      disabled ||
                                      map.tiles[me.position].kind !== 'shop'
                                    }
                                    title={
                                      map.tiles[me.position].kind !== 'shop'
                                        ? '抵达卡牌商店后可购买'
                                        : '购买指定卡牌'
                                    }
                                    onClick={() => setDialog('shop')}
                                  >
                                    ♧ 卡牌商店
                                  </button>
                                </div>
                                <div className="hand-heading">
                                  <b>
                                    我的手牌 <small>{me.cardCount}/8</small>
                                  </b>
                                  <small>
                                    {canManage ? '点击选择目标' : '自己的可操作阶段可使用'}
                                  </small>
                                </div>
                                <div className="hand">
                                  {me.cards?.map((id, i) => {
                                    const c = cardById(id)!;
                                    return (
                                      <button
                                        key={`${id}-${i}`}
                                        className={`card-mini ${c.category}`}
                                        onClick={() => openCard(id)}
                                        title={`${c.description}；${!canManage ? '等待自己的掷骰或经营阶段' : '点击查看目标与效果'}`}
                                      >
                                        <span>{c.icon}</span>
                                        <b>{c.name}</b>
                                        <small>{CATEGORY_NAMES[c.category]}</small>
                                      </button>
                                    );
                                  })}
                                  {!me.cardCount && (
                                    <p className="hint">
                                      手牌用完了，可在商店补充，或通过奇遇获得。
                                    </p>
                                  )}
                                </div>
                              </>
                            )}
                            {!me && (
                              <div className="tip-box">
                                你正在观战。手牌仅本人可见，观众不能进行操作。
                              </div>
                            )}
                          </>
                        ) : panel === '资产' ? (
                          <>
                            <Assets
                              game={g}
                              me={me}
                              map={map}
                              disabled={disabled}
                              command={command}
                              select={setSelectedTile}
                            />
                          </>
                        ) : panel === '聊天' ? (
                          <Chat
                            room={room}
                            chat={chat}
                            setChat={setChat}
                            send={() => {
                              connection.current!.send('chat', chat);
                              setChat('');
                            }}
                            disabled={disabled}
                          />
                        ) : (
                          <div className="event-feed" aria-live="polite">
                            {[...g.events]
                              .reverse()
                              .slice(0, 30)
                              .map((e) => (
                                <div className={`event ${e.kind}`} key={e.id}>
                                  <small>
                                    {new Date(e.at).toLocaleTimeString('zh-CN', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </small>
                                  <span>{e.text}</span>
                                </div>
                              ))}
                          </div>
                        )}
                      </section>
                    </aside>
                  </div>
                </div>
                {g.phase === 'finished' && (
                  <section className="settlement paper">
                    <div className="eyebrow">旅程纪念册</div>
                    <h2>
                      {g.players
                        .filter((p) => g.winners.includes(p.id))
                        .map((p) => p.name)
                        .join('、')}
                      获胜！
                    </h2>
                    <p>{g.finishReason}</p>
                    {(() => {
                      const best = Math.max(0, ...g.players.map((p) => p.prophet));
                      const seers = g.players.filter((p) => best > 0 && p.prophet === best);
                      return seers.length ? (
                        <p className="prophet-title">
                          🔮 最佳预言家：{seers.map((p) => p.name).join('、')}（猜中 {best} 次）
                        </p>
                      ) : null;
                    })()}
                    <div className="ranking">
                      {[...g.players]
                        .sort((a, b) => b.assets - a.assets)
                        .map((p, i) => (
                          <div key={p.id}>
                            <span>0{i + 1}</span>
                            <b>
                              {p.name} {g.winners.includes(p.id) ? '✦' : ''}
                            </b>
                            <strong>{money(p.assets)}</strong>
                            <small>
                              现金 {money(p.cash)} · 存款 {money(p.deposit)}
                            </small>
                          </div>
                        ))}
                    </div>
                    {room.isHost && (
                      <button className="primary" onClick={() => lobby('newMatch')}>
                        再开启一段旅程 →
                      </button>
                    )}
                  </section>
                )}
              </>
            )}
            {g && (
              <>
                <div
                  className={`drawer-backdrop ${sheetOpen ? 'open' : ''}`}
                  onClick={() => {
                    setSheetOpen(false);
                    automaticSheet.current = false;
                  }}
                />
                <nav className="mobile-nav" aria-label="对局快捷面板">
                  <div className="mobile-primary-row">
                    <span>
                      {myTurn
                        ? `轮到你 · ${phaseNames[g.phase]}`
                        : g.trade?.to === me?.id
                          ? '收到交易提案'
                          : g.phase === 'finished'
                            ? '对局已结算'
                            : `等待${active?.name ?? '伙伴'}的回合`}
                      <small>
                        {me
                          ? `现金 ${money(me.cash)} · 净资产 ${money(me.assets)}`
                          : '观战中 · 查看公开资产'}
                      </small>
                    </span>
                    <button
                      className="primary"
                      disabled={disabled}
                      aria-label={`快捷${quickAction && ['roll', 'jailRoll', 'buy', 'end'].includes(quickAction.action.type) ? quickAction.label : '查看操作'}`}
                      onClick={() => {
                        if (
                          quickAction &&
                          ['roll', 'jailRoll', 'buy', 'end'].includes(quickAction.action.type)
                        )
                          command(quickAction.action);
                        else {
                          setPanel('操作');
                          setSheetOpen(true);
                          automaticSheet.current = false;
                        }
                      }}
                    >
                      {quickAction &&
                      ['roll', 'jailRoll', 'buy', 'end'].includes(quickAction.action.type)
                        ? quickAction.label
                        : '查看操作'}
                    </button>
                  </div>
                  <div className="mobile-panel-links">
                    {['操作', '资产', '动态', '聊天'].map((p) => (
                      <button
                        key={p}
                        aria-expanded={sheetOpen && panel === p}
                        onClick={() => {
                          setPanel(p);
                          setSheetOpen(true);
                          automaticSheet.current = false;
                        }}
                      >
                        打开{p}
                      </button>
                    ))}
                  </div>
                </nav>
              </>
            )}
          </main>
        )}
      </div>
      {inspected && g && (
        <Modal
          title={`${inspected.name}的资产`}
          closeLabel="关闭玩家资料"
          close={() => setInspectedPlayer(null)}
        >
          <PlayerDetails
            player={inspected}
            game={g}
            map={map}
            select={(index) => {
              setInspectedPlayer(null);
              setSelectedTile(index);
            }}
          />
          {inspected.id === me?.id && (
            <button
              className="secondary full"
              onClick={() => {
                setInspectedPlayer(null);
                setPanel('资产');
                if (window.matchMedia('(max-width: 800px)').matches) setSheetOpen(true);
              }}
            >
              管理我的资产
            </button>
          )}
          {room?.isHost &&
            inspected.id !== me?.id &&
            !inspected.bankrupt &&
            g.phase !== 'finished' &&
            !room.seats.find((s) => s.id === inspected.id)?.bot && (
              <button
                className="secondary full"
                title="适合长时间挂机或掉线的玩家：席位交给规则机器人，这位玩家会被移出房间"
                onClick={() => {
                  if (confirm(`把${inspected.name}的席位交给机器人代打，并把他移出房间？`)) {
                    lobby('kick', { seatId: inspected.id });
                    setInspectedPlayer(null);
                  }
                }}
              >
                交给机器人代打（房主）
              </button>
            )}
          {inspected.id !== me?.id && me && !inspected.bankrupt && (
            <button
              className="primary full"
              disabled={!!tradeWhy}
              title={tradeWhy}
              onClick={() => {
                setInspectedPlayer(null);
                openTrade(inspected.id);
              }}
            >
              与这位玩家交易
            </button>
          )}
        </Modal>
      )}
      {selected && (
        <Modal title="地点详情" closeLabel="关闭地点详情" close={() => setSelectedTile(null)}>
          <div
            className={`country-detail-heading ${selected.kind === 'property' ? 'deed' : ''}`}
            style={{ '--group': groupColor(selected.group) } as React.CSSProperties}
          >
            <span>{countryFlag(selected.countryCode) || '✦'}</span>
            <div>
              <small>
                路线 {String(selected.index).padStart(2, '0')} · {kindNames[selected.kind]}
              </small>
              <h3>{selected.name}</h3>
            </div>
          </div>
          {selected.kind === 'property' ? (
            <>
              <div className="finance-summary">
                <div>
                  <span>购买价格</span>
                  <strong>{money(selected.price)}</strong>
                </div>
                <div>
                  <span>{owner ? '当前租金' : '基础租金'}</span>
                  <strong>{money(property?.rent ?? selected.rent)}</strong>
                </div>
                <div>
                  <span>建设费用</span>
                  <strong>{money(property?.upgradeCost ?? selected.buildCost)}</strong>
                </div>
                <div>
                  <span>抵押可得</span>
                  <strong>{money(Math.floor(selected.price / 2))}</strong>
                </div>
              </div>
              <table className="rent-table" aria-label="租金表">
                <tbody>
                  {['空地', '1 级', '2 级', '3 级'].map((label, level) => (
                    <tr key={label} className={property?.level === level && owner ? 'now' : ''}>
                      <th>{label}</th>
                      <td>{money(Math.round(selected.rent * [1, 2.5, 5, 9][level]))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="country-owner-description">
                {owner
                  ? `${owner.name}所有 · ${property?.level} 级建筑${property?.mortgaged ? ' · 已抵押，不收租' : ''}`
                  : '待售国家地产 · 抵达后可以购买或参与公开拍卖'}
              </p>
              {owner && me && (
                <p className="hint">
                  按当前状态，抵达时预计支付租金 {money(property?.payableRent ?? 0)}
                  。同队、自己的地产与租金护盾可免租；途中资产与卡牌变化会影响结算。
                </p>
              )}
              <p className="hint">
                同色国家组成地产组，独占一组租金 +30%。建筑 0–3 级的租金倍率为 1 / 2.5 / 5 /
                9；地产及建筑按回收价值计入净资产。
              </p>
              {owner && me && owner.id !== me.id && !property?.level && !property?.mortgaged && (
                <button
                  className="secondary full"
                  disabled={!!tradeWhy}
                  title={tradeWhy || `向${owner.name}提出购买这处地产`}
                  onClick={() => {
                    setSelectedTile(null);
                    openTrade(owner.id, {
                      wantTiles: [selected.index],
                      giveCash: Math.round((selected.price * 1.2) / 10) * 10,
                    });
                  }}
                >
                  向{owner.name}求购这块地
                </button>
              )}
              {owner?.id === me?.id && !property?.level && !property?.mortgaged && (
                <button
                  className="secondary full"
                  disabled={!!tradeWhy}
                  title={tradeWhy || '把这处地产卖给其他玩家'}
                  onClick={() => {
                    setSelectedTile(null);
                    openTrade(g!.players.find((p) => p.id !== me!.id && !p.bankrupt)?.id ?? '', {
                      giveTiles: [selected.index],
                      wantCash: Math.round((selected.price * 1.2) / 10) * 10,
                    });
                  }}
                >
                  出售给其他玩家
                </button>
              )}
              {owner?.id === me?.id && (
                <button
                  className="secondary full"
                  onClick={() => {
                    setSelectedTile(null);
                    setPanel('资产');
                    if (window.matchMedia('(max-width: 800px)').matches) setSheetOpen(true);
                  }}
                >
                  管理这处地产
                </button>
              )}
            </>
          ) : (
            <p>{kindNames[selected.kind]}</p>
          )}
          {map.mechanic === 'gates' && map.shortcuts.some(([from]) => from === selected.index) && (
            <p className="tip-box">
              商路在偶数轮开放。当前
              {(g?.round ?? 1) % 2 === 0 ? '开放，可选跨洲快线' : '关闭，沿环线前进'}。
            </p>
          )}
          {selected.exits.length > 1 && (
            <p className="tip-box">
              抵达岔路时选择：{selected.exits.map((i) => map.tiles[i].name).join(' / ')}。
            </p>
          )}
        </Modal>
      )}
      {dialog && (dialog === 'create' || dialog === 'join') && (
        <Modal
          title={dialog === 'create' ? '创建朋友房间' : '加入朋友的旅程'}
          close={() => setDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void enter(dialog === 'create');
            }}
          >
            <label>
              游客昵称
              <input
                maxLength={16}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {dialog === 'join' && (
              <label>
                房间码
                <input
                  maxLength={6}
                  required
                  value={code}
                  placeholder="输入 6 位房间码"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </label>
            )}
            <label>
              {dialog === 'create' ? '设置密码（可留空）' : '房间密码（无密码可留空）'}
              <input
                maxLength={64}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {dialog === 'create' && (
              <>
                <label>
                  地图
                  <select
                    value={settings.mapId}
                    onChange={(e) => setSettings({ ...settings, mapId: e.target.value })}
                  >
                    {MAPS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  席位上限
                  <select
                    value={settings.maxPlayers}
                    onChange={(e) =>
                      setSettings({ ...settings, maxPlayers: Number(e.target.value) })
                    }
                  >
                    {[2, 3, 4, 5, 6].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              初始角色
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {CHARACTERS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.title}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">对局开始后加入会进入观战席。刷新可恢复原席位。</p>
            <button className="primary full" disabled={busy}>
              {busy ? '正在入座…' : dialog === 'create' ? '创建并进入' : '加入房间'}
            </button>
            {dialog === 'join' && (
              <button
                className="secondary full"
                type="button"
                disabled={busy}
                onClick={() => void enter(false, true)}
              >
                以观众身份加入
              </button>
            )}
          </form>
        </Modal>
      )}
      {dialog === 'card' && selectedCard && g && (
        <Modal title={`使用「${selectedCard.name}」`} close={() => setDialog(null)}>
          <div className="card-preview">
            <span>{selectedCard.icon}</span>
            <p>{selectedCard.description}</p>
            <small>{CATEGORY_NAMES[selectedCard.category]} · 使用后消耗 1 张</small>
          </div>
          {selectedCard.target !== 'self' && (
            <label>
              选择目标
              <select value={cardTarget} onChange={(e) => setCardTarget(e.target.value)}>
                <option value="">请选择高亮范围内的目标</option>
                {cardTargets?.map((t) => (
                  <option value={t.id} key={t.id} disabled={!!t.reason}>
                    {t.name}
                    {t.reason ? ` · ${t.reason}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selectedCard.effect === 'dice' && (
            <label>
              骰子点数
              <select value={diceValue} onChange={(e) => setDiceValue(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
          <p className="hint">
            {selectedCard.effect === 'remoteBuy'
              ? '远程购买会额外扣除目标地产的完整地价。'
              : selectedCard.effect === 'move'
                ? '移动后正常处理落点，可能触发租金、税费或岔路。'
                : '请选择有效目标；使用后消耗这张卡牌。'}
          </p>
          {(!canManage ||
            jailedMove ||
            chosenCardReason ||
            (selectedCard.target !== 'self' && !cardTargets.some((t) => !t.reason))) && (
            <p className="field-error">
              {!canManage
                ? '等待自己的掷骰或经营阶段使用；现在可以查看卡牌效果。'
                : jailedMove
                  ? '拘留中不能使用移动类卡牌；出狱后再用。'
                  : chosenCardReason || '当前没有可用目标，请保留到合适的时机。'}
            </p>
          )}
          <button
            className="primary full"
            disabled={
              disabled ||
              !canManage ||
              jailedMove ||
              !!chosenCardReason ||
              (selectedCard.target !== 'self' && !cardTarget)
            }
            onClick={() => {
              command({
                type: 'playCard',
                cardId: selectedCard.id,
                ...(selectedCard.target === 'player'
                  ? { targetId: cardTarget }
                  : selectedCard.target === 'self'
                    ? {}
                    : { tile: Number(cardTarget) }),
                ...(selectedCard.effect === 'dice' ? { value: diceValue } : {}),
              });
            }}
          >
            确认使用
          </button>
        </Modal>
      )}
      {dialog === 'trade' && g && me && tradeDraft && (
        <Modal title={tradeDraft.counter ? '还价' : '提出一笔交易'} close={() => setDialog(null)}>
          <TradeDialog
            key={`${tradeDraft.to}-${tradeDraft.giveTiles.join()}-${tradeDraft.wantTiles.join()}`}
            game={g}
            map={map}
            me={me}
            draft={tradeDraft}
            disabled={disabled || (!tradeDraft.counter && !!tradeWhy)}
            send={command}
          />
          {!tradeDraft.counter && tradeWhy && <p className="field-error">{tradeWhy}</p>}
        </Modal>
      )}
      {dialog === 'shop' && (
        <Modal title="旅途卡牌市场" close={() => setDialog(null)}>
          <p className="hint">购买指定卡牌，每人最多 8 张。当前现金 {me?.cash}。</p>
          <div className="catalog-grid">
            {CARDS.map((c) => (
              <button
                key={c.id}
                disabled={disabled || !canManage || !me || me.cash < c.price || me.cardCount >= 8}
                title={
                  me && me.cash < c.price
                    ? '现金不足'
                    : me && me.cardCount >= 8
                      ? '手牌已满'
                      : c.description
                }
                onClick={() => command({ type: 'buyCard', cardId: c.id })}
              >
                <span>{c.icon}</span>
                <b>
                  {c.name} · {c.price}
                </b>
                <p>{c.description}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {dialog === 'rules' && (
        <Modal title="旅途图鉴" close={() => setDialog(null)}>
          <div className="panel-tabs">
            {['规则', '地图', '角色', '卡牌', '机会命运'].map((t) => (
              <button
                key={t}
                className={t === rulesTab ? 'selected' : ''}
                onClick={() => setRulesTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {rulesTab === '规则' ? (
            <div className="rule-copy">
              <h3>01 / 出发与经营</h3>
              <p>
                每回合先用卡牌或天赋，再掷一颗六面骰。处理落点后，可以升级、抵押、交易，再结束回合。岔路由当前玩家选择。真人玩家默认不限时；房主可以设置操作时限，超时由系统执行稳妥的默认操作。机器人最多思考两分钟，超时由规则机器人接手。
              </p>
              <h3>02 / 四个角落与拘留所</h3>
              <p>
                棋盘一圈 36 格，四角依次是起点、海关拘留所、免费停车场和海关遣返。经过起点领取{' '}
                {BOARD.salary}
                。停在遣返或抽到「护照过期」会直接进入拘留所，不经过起点、不领薪水；只是路过拘留所算作探访。被拘留后的下一回合可以缴纳
                100 保释金、使用「自由通行」卡（探险家天赋也可以），或掷骰碰运气：掷出 6
                点当场出狱并前进，否则留下一回合，之后自由出发。拘留期间仍可收租、建设和交易，但不能使用移动类卡牌。税费、维护费和保释金都会进入免费停车场奖池，下一位停车的玩家全部领走。
              </p>
              <h3>03 / 国家地产与经济</h3>
              <p>
                空地可直接购买，放弃则全员轮流竞拍。至少加价 10，退出后不能再出价。地产可升 3
                级，租金倍率为 1、2.5、5、9；独占街区额外 +30%。抵押获得半价，赎回支付地价的
                55%。建筑出售返还标准建设费的一半。
              </p>
              <h3>04 / 卡牌、银行与交易</h3>
              <p>
                手牌最多 8 张，每个角色有被动与每 3 轮一次的天赋。银行可存取现金，存款每轮带来 3%
                现金利息。没钱付租金或税费时，先取款、卖建筑或抵押；无法筹齐可破产，将资产清算给债权人或银行。交易随时可以发起（购买、拍卖、选路和筹款时除外）：点「⇄
                发起交易」、玩家资料或国家详情里的「求购 /
                出售」，勾选双方的现金和任意多处无建筑、未抵押的地产。对方 60
                秒内可以接受、拒绝或还价；被拒绝后需等 15
                秒才能再发起。交易进行时其他操作暂停，接受后双方资产同时交换。
              </p>
              <h3>05 / 世界新闻与追赶机制</h3>
              <p>
                第 2
                轮起每轮开始翻开一条世界新闻，只在本轮生效：某组国家租金涨跌、存款利率变化、建材降价、税务假期、地价涨跌、薪水节、海关严查、环球庆典、富豪税或幸运日。
                为了不让领先者一路碾压：净资产低于领先者 60%
                的玩家在名单上标为「追赶中」，经过起点多领 50% 薪水，每 4 轮的环球补助从 60 提高到
                140；最落后的玩家抽机会、命运卡时翻两张取更好的一张；税务格按「基础税」与「净资产
                4%」取较高者收取；明显领先者还可能遇到富豪税。
              </p>
              <h3>06 / 胜负与队伍</h3>
              <p>
                房主选择结束方式：固定轮数（默认 12 轮，快速战 8
                轮）、限时，或谁的净资产先达到目标。无论哪种方式，最多 90 分钟。最后两轮、最后 5
                分钟，或有人达到目标的 80% 时进入「终局冲刺」，所有租金 ×1.5。结束时按现金 + 存款 +
                未抵押地产半价 + 建筑回收价 −
                待付债务排名，并列可共同获胜；只剩一方仍在经营时提前结束。团队战要求 2v2 或
                3v3，同队免租，资产合计结算。
              </p>
              <h3>07 / 联机与恢复</h3>
              <p>
                刷新后自动恢复原席位。断线 15
                秒后机器人临时接管，返回后交还控制。服务端重启会恢复已确认动作和待处理决策。请使用原浏览器；清除本地数据会丢失游客恢复凭证。观众看不到私有手牌。
              </p>
              <button
                className="secondary"
                onClick={() => {
                  setDialog(null);
                  setTutorial(room ? 0 : null);
                  if (!room) void enter(true, false, true);
                }}
              >
                重新开始互动教学
              </button>
            </div>
          ) : rulesTab === '地图' ? (
            MAPS.map((m) => (
              <article className="encyclopedia" key={m.id}>
                <h3>
                  {m.name} · {m.subtitle}
                </h3>
                <p>{m.description}</p>
              </article>
            ))
          ) : rulesTab === '机会命运' ? (
            <div className="deck-atlas">
              {(['chance', 'fate'] as const).map((deck) => (
                <section key={deck}>
                  <h3>{deck === 'chance' ? '机会卡 · 移动与惊喜' : '命运卡 · 现金与全场事件'}</h3>
                  <div className="catalog-grid">
                    {DECK_CARDS.filter((c) => c.deck === deck).map((c) => (
                      <div className={`deck-card ${deck}`} key={c.id}>
                        <span>{c.icon}</span>
                        <h4>{c.name}</h4>
                        <p>{c.text}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              <p className="hint">
                两副牌各 16
                张，开局洗牌，抽过的牌放回牌底。现金最少且明显落后的玩家抽牌时会翻开两张，保留更好的一张。
              </p>
            </div>
          ) : rulesTab === '角色' ? (
            CHARACTERS.map((c) => (
              <article className="encyclopedia" key={c.id}>
                <h3>
                  {c.icon} {c.name} · {c.title}
                </h3>
                <p>{c.description}</p>
                <small>{c.ability}</small>
              </article>
            ))
          ) : (
            <div className="catalog-grid">
              {CARDS.map((c) => (
                <article key={c.id}>
                  <span>{c.icon}</span>
                  <h3>{c.name}</h3>
                  <p>{c.description}</p>
                  <small>
                    {CATEGORY_NAMES[c.category]} · 商店 {c.price}
                  </small>
                </article>
              ))}
            </div>
          )}
        </Modal>
      )}
      {dialog === 'settings' && (
        <Modal title="让旅程更合心意" close={() => setDialog(null)}>
          {room && (
            <form
              className="rename-row"
              onSubmit={(e) => {
                e.preventDefault();
                const next = name.trim();
                if (!next) return;
                localStorage.setItem('mp-name', next);
                lobby('rename', { name: next });
                notify(`昵称已改为「${next}」`);
              }}
            >
              <label>
                我的昵称
                <input maxLength={16} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <button className="secondary" disabled={!name.trim() || disabled}>
                保存昵称
              </button>
            </form>
          )}
          {[
            { label: '减少移动动画', value: reduced, key: 'mp-reduced', set: setReduced },
            { label: '显示表情互动', value: emotesOn, key: 'mp-emotes', set: setEmotesOn },
            { label: '显示操作情境提示', value: hints, key: 'mp-hints', set: setHints },
          ].map((s) => (
            <label className="toggle-row" key={s.key}>
              <span>{s.label}</span>
              <input
                type="checkbox"
                checked={s.value}
                onChange={(e) => {
                  s.set(e.target.checked);
                  localStorage.setItem(s.key, String(e.target.checked));
                }}
              />
            </label>
          ))}
          <p className="hint">画面设置仅影响本机。规则、随机数和对局进度由服务器裁定。</p>
        </Modal>
      )}
      {dialog === 'exit' && (
        <Modal title="离开这段旅程？" close={() => setDialog(null)}>
          <p>
            主动离开进行中的比赛会清算你的资产并退出经营。临时离开可直接关闭页面，稍后刷新恢复。
          </p>
          <div className="hero-actions">
            <button className="secondary" onClick={() => setDialog(null)}>
              继续旅程
            </button>
            <button
              className="danger"
              disabled={busy || pending || !connected}
              onClick={() => void leave()}
            >
              {busy ? '等待退出确认…' : '确认退出经营'}
            </button>
          </div>
          {!connected && <p className="hint">请恢复连接后退出；你的恢复凭证会保留。</p>}
        </Modal>
      )}
      {tutorial !== null && room && (
        <div className="tutorial-box paper" role="region" aria-label="互动教学">
          <div className="eyebrow">旅途小课堂 · {tutorial + 1}/5</div>
          <button
            className="icon-button"
            aria-label="跳过教学"
            onClick={() => {
              setTutorial(null);
              setTutorialGame(false);
            }}
          >
            ×
          </button>
          <h3>
            {
              [
                '组建你的第一场比赛',
                '掷骰，探索世界',
                '拥有第一处地产',
                '把资产变成收入',
                '旅程由你来决定',
              ][tutorial]
            }
          </h3>
          <p>
            {
              [
                '点击空位添加机器人，选择角色后点「我准备好了」，再开始旅程。',
                '点击「掷骰出发」。初始手牌和角色天赋可提前使用。落到空地时出现购买提示。',
                '点击「购买」获得地产，或「进入拍卖」参与轮流出价。购买失败时会提示具体原因。',
                '在「资产」中升级建筑，提高租金；随后结束回合。注意保留现金支付对手租金。',
                '试试卡牌、交易、银行与岔路。刷新可恢复席位，规则图鉴随时可查。',
              ][tutorial]
            }
          </p>
          <button
            className="secondary"
            onClick={() => {
              if (tutorial === 4) {
                setTutorial(null);
                setTutorialGame(false);
                localStorage.setItem('mp-taught', 'true');
              } else setTutorial(tutorial + 1);
            }}
          >
            {tutorial === 4 ? '我知道了，继续旅行' : '下一条提示'}
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast('')}>
          {toast}
        </div>
      )}
    </>
  );
}
function Chat({
  room,
  chat,
  setChat,
  send,
  disabled,
}: {
  room: RoomView;
  chat: string;
  setChat: (s: string) => void;
  send: () => void;
  disabled: boolean;
}) {
  return (
    <div className="chat-box">
      <h3>
        房间聊天 <small>只与这里的伙伴分享</small>
      </h3>
      <div className="chat-feed">
        {room.chat.slice(-12).map((m) => (
          <p key={m.id}>
            <b>{m.name}</b> {m.text}
          </p>
        ))}
        {!room.chat.length && <p className="hint">打个招呼，故事从这里开始。</p>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (chat.trim()) send();
        }}
      >
        <input
          aria-label="聊天内容"
          placeholder="说点什么…"
          maxLength={200}
          value={chat}
          onChange={(e) => setChat(e.target.value)}
        />
        <button aria-label="发送聊天" disabled={disabled || !chat.trim()}>
          ↗
        </button>
      </form>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
