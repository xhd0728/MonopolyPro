import './flags.ts';
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
  type RoomSettings,
  type RoomListing,
  type RoomSummary,
  type RoomView,
  type GameAction,
  type GameView,
  type CardDefinition,
} from '../../../packages/shared/src/index.ts';
import { Board } from './Board.tsx';
import { Assets } from './Assets.tsx';
import { PlayerRoster, PlayerDetails } from './Players.tsx';
import {
  money,
  cardTargetReason,
  validMoney,
  groupColor,
  pingBand,
  playerColor,
} from './game-ui.ts';
import {
  MatchHud,
  ActionAnnouncements,
  adviceFor,
  phaseGuide,
  type HudAction,
} from './GameHud.tsx';
import { api, Connection, type Credentials } from './network.ts';
import { createCommandId } from './command-id.ts';
import { Clock, serverTime, setServerOffset } from './clock.tsx';
import { EmoteBar, Headlines, useLiveEmotes, useTurnAttention } from './Feedback.tsx';
import { ActivityFeed } from './ActivityFeed.tsx';
import { setSoundEnabled, soundEnabled, unlockSound } from './sound.ts';
import { useShortcuts } from './shortcuts.ts';
import { MatchSummary } from './Summary.tsx';
import { Lobby } from './Lobby.tsx';
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
  start: '起点 · 经过领取薪水',
  property: '可购买的地产',
  bank: '银行 · 存取现金与存款',
  shop: `卡牌市场 · 抽一张 ${BOARD.cardDraw}`,
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
/** Tablets and desktops dock the activity feed under the controls; phones use a tab. */
function useWide() {
  const query = '(min-width: 801px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
}
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
      {game.finale && (
        <em className="meta-finale" title="终局冲刺：所有租金 ×1.5">
          🔥<span className="finale-label"> 终局冲刺</span> · 租金 ×1.5
        </em>
      )}
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
    [settings, setSettings] = useState<RoomSettings>({ ...DEFAULT_SETTINGS, maxPlayers: 4 }),
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
    [sheetOpen, setSheetOpen] = useState(false),
    wide = useWide();
  const panelRef = useRef<HTMLElement>(null);
  // A new tab starts at its top instead of inheriting the previous tab's scroll.
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [panel]);
  const [inspectedPlayer, setInspectedPlayer] = useState<string | null>(null);
  const inspectPlayer = useCallback((id: string) => {
    setSelectedTile(null);
    setInspectedPlayer(id);
  }, []);
  const automaticSheet = useRef(false),
    pendingAction = useRef<GameAction | null>(null);
  const [emotesOn, setEmotesOn] = useState(localStorage.getItem('mp-emotes') !== 'false'),
    [soundOn, setSoundOn] = useState(soundEnabled()),
    [reduced, setReduced] = useState(localStorage.getItem('mp-reduced') === 'true'),
    [hints, setHints] = useState(localStorage.getItem('mp-hints') !== 'false'),
    [tutorial, setTutorial] = useState<number | null>(null),
    [tutorialGame, setTutorialGame] = useState(false);
  const [tradeDraft, setTradeDraft] = useState<TradeDraft | null>(null);
  // The join form looks the room up as soon as the code is complete.
  const [joinInfo, setJoinInfo] = useState<RoomSummary | null>(null),
    [joinError, setJoinError] = useState('');
  useEffect(() => {
    setJoinInfo(null);
    setJoinError('');
    if (dialog !== 'join' || code.length !== 6) return;
    let live = true;
    api<RoomSummary>(`/api/rooms/${code}`)
      .then((info) => live && setJoinInfo(info))
      .catch((error: Error) => live && setJoinError(error.message));
    return () => {
      live = false;
    };
  }, [dialog, code]);
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
    const invited = new URLSearchParams(location.search).get('room');
    if (raw) {
      try {
        const c = JSON.parse(raw) as Credentials;
        void connection.current!.connect(c, true);
      } catch {
        localStorage.removeItem('mp-seat');
      }
    }
    // An invite link opens the join form straight away, with the room code filled in.
    if (invited && !raw) setDialog('join');
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
  // The home page keeps its room list fresh on its own.
  const onHome = !room;
  useEffect(() => {
    if (!onHome) return;
    const timer = setInterval(() => void refresh(true), 15000);
    return () => clearInterval(timer);
  }, [onHome]);
  async function refresh(quiet = false) {
    try {
      setList(await api<RoomListing[]>('/api/rooms'));
    } catch {
      if (!quiet) notify('暂时读不到房间列表，请确认服务已启动');
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
          ? // The password, like every other setting, is set inside the room.
            { name: name.trim() || '旅行家', characterId: role, settings: chosen }
          : { name, password, characterId: role, spectator },
      );
      localStorage.setItem(
        'mp-seat',
        JSON.stringify({ code: c.code, seatId: c.seatId, token: c.token }),
      );
      await connection.current!.connect(c);
      setDialog(null);
      setPassword('');
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
    let id: string;
    try {
      id = createCommandId();
    } catch {
      notify('操作未能发送，请刷新后重试');
      return;
    }
    setPending(true);
    pendingAction.current = action;
    connection.current!.command({ id, revision: g.revision, action });
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
    map = mapById(room?.settings.mapId ?? settings.mapId, room?.settings.size ?? settings.size),
    active = g?.players.find((p) => p.id === g.activeId),
    myTurn = !!g && g.activeId === room?.viewerId && !me?.bankrupt,
    canManage = myTurn && ['roll', 'manage'].includes(g!.phase) && !g!.trade,
    // Cards also work in the jail phase (自由通行), unlike building or the market.
    canPlay = myTurn && ['roll', 'manage', 'jail'].includes(g!.phase) && !g!.trade;
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
  const drawPrice = me?.characterId === 'dealer' ? BOARD.dealerDraw : BOARD.cardDraw;
  // After the last round the counter has already moved on; never show "第 11 / 10 轮".
  const shownRound =
    g && g.settings.end === 'rounds' ? Math.min(g.round, g.settings.rounds) : (g?.round ?? 1);
  // Cards you gain are private: tell only you which ones arrived.
  const seenNew = useRef<{ game: string; ids: string[] }>({ game: '', ids: [] });
  const newIds = me?.newCards?.join(',') ?? '';
  useEffect(() => {
    const ids = me?.newCards ?? [];
    const before = seenNew.current;
    const fresh = before.game === g?.id ? ids.slice(Math.min(before.ids.length, ids.length)) : [];
    seenNew.current = { game: g?.id ?? '', ids: [...ids] };
    if (fresh.length && ids.length > before.ids.length)
      notify(
        `你获得了${fresh.map((id) => `「${cardById(id)?.name ?? id}」`).join('、')}，下回合可以使用`,
      );
  }, [g?.id, newIds]);
  const chosenCardReason = me?.cardPlayed
    ? '本回合已经用过一张卡，下回合再用。'
    : selectedCard?.effect === 'shield' && me && me.shield > 0
      ? '已经持有护盾，护盾不能叠加。'
      : selectedCard?.effect === 'taxShield' && me && me.taxShield > 0
        ? '已经持有税务减免。'
        : (cardTargets.find((t) => t.id === cardTarget)?.reason ?? '');
  const jailedMove = (!!me?.jailTurns || !!me?.heldInJail) && selectedCard?.category === 'move';
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
  const mySeat = room?.seats.find((s) => s.id === room.viewerId);
  const quickAction = g?.actions.find((a) => a.primary);
  // This seat must decide something now: its own turn, an auction bid or an incoming trade.
  const needsMe = !!g && g.phase !== 'finished' && (myTurn || g.trade?.to === room?.viewerId);
  useTurnAttention(needsMe);
  const liveEmotes = useLiveEmotes(room?.emotes ?? NO_EMOTES, emotesOn);
  // Audio may only start after a user gesture.
  useEffect(() => {
    const unlock = () => unlockSound();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  useShortcuts({
    enabled: !!g && !dialog && !inspectedPlayer && selectedTile === null && !disabled,
    actions: g?.actions ?? [],
    run: command,
    trade: () => {
      if (g && me && !tradeWhy)
        openTrade(g.players.find((p) => p.id !== me.id && !p.bankrupt)?.id ?? '');
    },
    guess:
      g &&
      me &&
      !me.bankrupt &&
      g.phase === 'roll' &&
      g.activeId !== me.id &&
      !g.trade &&
      !g.guesses[me.id] &&
      !disabled
        ? (pick) => command({ type: 'guess', pick })
        : undefined,
    help: () =>
      notify(
        '快捷键：空格/回车 掷骰或结束回合 · B 购买 · P 放弃购买/退出竞拍 · E 结束回合 · T 交易 · 1–3 选择岔路 · ↑/↓ 猜大/猜小',
      ),
  });
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
          <div className={`connection ${connected ? 'online' : ''}`}>
            <i />
            {/* Only the status is announced; the ping changes every few seconds. */}
            <span aria-live="polite">{room ? status : '未进入房间'}</span>
            {connected && latency !== undefined && (
              <span className={`ping ${pingBand(latency)}`} title="与服务器之间的往返延迟">
                Ping {latency} ms
              </span>
            )}
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
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void enter(true)}
                  title={`用「${mapById(settings.mapId).name}」开一个房间，进去后再改设置`}
                >
                  {busy ? '正在开房…' : '创建房间'}
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
                  <h2>开着的房间</h2>
                  <p className="hint">只显示有人在的房间；没人操作的房间会自动结束。</p>
                </div>
                <button className="secondary" onClick={() => void refresh()}>
                  刷新
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
                        {r.locked ? '🔒 ' : ''}
                        {r.code}
                      </span>
                      <span>
                        {r.host ? `${r.host}的房间` : '朋友的房间'}，{mapById(r.mapId).name}
                      </span>
                      <span className={`room-status ${r.status}`}>
                        {r.status === 'waiting'
                          ? '等待组局'
                          : r.status === 'finished'
                            ? '刚结束一局'
                            : '对局中，可观战'}
                      </span>
                      <b>
                        {r.players}/{r.maxPlayers} →
                      </b>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  现在没有开着的房间。创建一个房间，再把邀请链接发给朋友。
                </div>
              )}
            </section>
            <footer>
              MONOPOLY PRO <span>沿世界的路线，创造自己的故事。</span>
            </footer>
          </main>
        ) : (
          <main className={`room-page ${g ? 'match-page' : ''}`}>
            {!g ? (
              <Lobby
                room={room}
                map={map}
                disabled={disabled}
                tutorial={tutorialGame}
                lobby={lobby}
                invite={invite}
                chat={
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
                }
              />
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
                              <>
                                🛋<span className="afk-label"> 挂机中 ·</span> 回来
                              </>
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
                          <span className="room-label">
                            房间 <b>{room.code}</b>
                          </span>
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
                      <section
                        ref={panelRef}
                        className={`paper action-panel ${sheetOpen ? 'sheet-open' : ''}`}
                      >
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
                          {(wide ? ['操作', '资产', '聊天'] : ['操作', '资产', '动态', '聊天']).map(
                            (p) => (
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
                            ),
                          )}
                        </div>
                        {panel === '操作' || (wide && panel === '动态') ? (
                          <>
                            <div
                              className={`turn-prompt ${myTurn ? 'mine' : ''}`}
                              style={
                                {
                                  '--who': playerColor(Math.max(0, g.turn)),
                                } as React.CSSProperties
                              }
                            >
                              <span className="eyebrow">
                                {myTurn
                                  ? `轮到你了 · 第 ${shownRound} 轮`
                                  : me?.bankrupt
                                    ? '继续观战'
                                    : g.phase === 'finished'
                                      ? `共 ${shownRound} 轮`
                                      : `第 ${shownRound} 轮 · 等待时也能查看地图`}
                              </span>
                              <h2>
                                {g.phase === 'finished'
                                  ? '这段旅程，圆满落幕'
                                  : g.trade
                                    ? '交易提案待处理'
                                    : myTurn && g.phase === 'debt' && g.debt && me
                                      ? `需支付 ${money(g.debt.amount)}，现金 ${money(me.cash)}`
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
                                <span className="decision-timer untimed">
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
                                      {pending
                                        ? '等待确认…'
                                        : a.action.type === 'bid'
                                          ? `出价 ${money(bid)}`
                                          : a.label}
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
                                  className={`${a.action.type === 'surrender' ? 'danger' : 'secondary'} full`}
                                  disabled={disabled}
                                  title={a.hint}
                                  onClick={() => {
                                    // Bankruptcy cannot be undone: ask once.
                                    if (
                                      a.action.type === 'surrender' &&
                                      !window.confirm(
                                        '确定宣布破产吗？你的资产将交给债权人或银行，无法撤销。',
                                      )
                                    )
                                      return;
                                    command(a.action);
                                  }}
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
                                    className={
                                      g.actions.some((a) => a.action.type === 'buyCard')
                                        ? 'ready'
                                        : ''
                                    }
                                    title={
                                      g.actions.some((a) => a.action.type === 'buyCard')
                                        ? `现在可以随机抽一张，${drawPrice} 现金`
                                        : '查看卡池；停在卡牌市场的那个回合可以抽卡'
                                    }
                                    onClick={() => setDialog('shop')}
                                  >
                                    ♧ 卡牌市场
                                  </button>
                                </div>
                                <div className="hand-heading">
                                  <b>
                                    我的手牌{' '}
                                    <small>
                                      {me.cardCount}/{BOARD.handLimit}
                                    </small>
                                  </b>
                                  <small>
                                    {me.cardPlayed
                                      ? '本回合已用过一张卡'
                                      : canPlay
                                        ? '每回合可用一张，点击选择目标'
                                        : '自己的可操作阶段可使用'}
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
                                        title={`${c.description}；${!canPlay ? '等待自己的回合' : me.cardPlayed ? '本回合已用过一张卡' : '点击查看目标与效果'}`}
                                      >
                                        <span>{c.icon}</span>
                                        <b>{c.name}</b>
                                        <small>{CATEGORY_NAMES[c.category]}</small>
                                      </button>
                                    );
                                  })}
                                  {me.newCards?.map((id, i) => {
                                    const c = cardById(id)!;
                                    return (
                                      <button
                                        key={`new-${id}-${i}`}
                                        className={`card-mini ${c.category} locked`}
                                        disabled
                                        title={`${c.description}；本回合刚获得，下回合可用`}
                                      >
                                        <span>{c.icon}</span>
                                        <b>{c.name}</b>
                                        <small>下回合可用</small>
                                      </button>
                                    );
                                  })}
                                  {!me.cardCount && (
                                    <p className="hint">
                                      手牌用完了，可在卡牌市场抽卡，或从机会、命运卡获得。
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
                          <ActivityFeed
                            game={g}
                            map={map}
                            ai={room.aiActivity}
                            className="in-panel"
                          />
                        )}
                      </section>
                      {wide && (
                        <ActivityFeed game={g} map={map} ai={room.aiActivity} className="docked" />
                      )}
                    </aside>
                  </div>
                </div>
                {g.phase === 'finished' && (
                  <MatchSummary
                    game={g}
                    map={map}
                    isHost={room.isHost}
                    restart={() => lobby('newMatch')}
                  />
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
              <div className="finance-summary country-finances">
                <div>
                  <span>{owner ? '原始地价' : '当前购地价'}</span>
                  <strong>
                    {money(owner ? selected.price : (property?.price ?? selected.price))}
                  </strong>
                </div>
                <div>
                  <span>{owner ? '当前租金' : '基础租金'}</span>
                  <strong>{money(owner && property ? property.rent : selected.rent)}</strong>
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
                  : room?.settings.auction
                    ? '待售国家地产 · 抵达后可以购买或参与公开拍卖'
                    : '待售国家地产 · 停在这里的玩家可以购买'}
              </p>
              {owner && me && (
                <p className="hint">
                  按当前状态，抵达时预计支付租金 {money(property?.payableRent ?? 0)}
                  。同队、自己的地产与租金护盾可免租；途中资产与卡牌变化会影响结算。
                </p>
              )}
              <p className="hint">
                同色国家组成地产组，独占一组租金 +30%。建筑 0–3 级的租金倍率为 1 / 2.5 / 5 /
                9；地产按地价、建筑按建设费的 75% 计入净资产。
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
            <p>
              {selected.kind === 'bank'
                ? `银行 · 本轮存款利息 ${money((g?.bankInterestRate ?? BOARD.interest) * 100)}%`
                : kindNames[selected.kind]}
            </p>
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
      {dialog === 'join' && (
        <Modal title="加入房间" close={() => setDialog(null)}>
          <form
            className="join-form"
            onSubmit={(e) => {
              e.preventDefault();
              void enter(false, !!joinInfo?.spectatorOnly);
            }}
          >
            <label>
              房间码
              <input
                className="code-input"
                maxLength={6}
                required
                autoFocus={!code}
                value={code}
                placeholder="6 位房间码"
                autoComplete="off"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </label>
            {joinInfo && (
              <p className="join-room">
                <b>{joinInfo.host || '房主'}的房间</b>，{mapById(joinInfo.mapId).name}，
                {joinInfo.players}/{joinInfo.maxPlayers} 人，
                {joinInfo.status === 'waiting'
                  ? '正在组局'
                  : joinInfo.status === 'playing'
                    ? '对局进行中'
                    : '刚结束一局'}
                {joinInfo.locked ? '，需要密码' : ''}
              </p>
            )}
            {joinError && <p className="field-error">{joinError}</p>}
            <label>
              你的昵称
              <input
                maxLength={16}
                required
                autoFocus={!!code}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {joinInfo?.locked && (
              <label>
                房间密码
                <input
                  maxLength={64}
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            <button className="primary full" disabled={busy || code.length !== 6 || !!joinError}>
              {busy ? '正在加入…' : joinInfo?.spectatorOnly ? '进入观战' : '加入房间'}
            </button>
            {joinInfo?.spectatorOnly ? (
              <p className="hint">
                {joinInfo.status === 'waiting'
                  ? '席位已满，你会先在观战席。'
                  : '对局已经开始，你会先在观战席，下一局可以入座。'}
              </p>
            ) : (
              joinInfo && (
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void enter(false, true)}
                >
                  只观战，不占席位
                </button>
              )
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
                : selectedCard.target === 'self'
                  ? selectedCard.effect === 'insure' && me && me.shield > 0
                    ? '你已有护盾，这次只会拿到现金。确认后消耗这张卡牌。'
                    : '确认后立即生效，并消耗这张卡牌。'
                  : '请选择有效目标；使用后消耗这张卡牌。'}
          </p>
          {(!canPlay ||
            jailedMove ||
            chosenCardReason ||
            (selectedCard.target !== 'self' && !cardTargets.some((t) => !t.reason))) && (
            <p className="field-error">
              {!canPlay
                ? '轮到自己时才能使用；现在可以查看卡牌效果。'
                : jailedMove
                  ? '拘留中不能使用移动类卡牌；出狱后再用。'
                  : chosenCardReason || '当前没有可用目标，请保留到合适的时机。'}
            </p>
          )}
          <button
            className="primary full"
            disabled={
              disabled ||
              !canPlay ||
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
            disabled={disabled}
            blockedReason={tradeDraft.counter ? '' : tradeWhy}
            send={command}
          />
        </Modal>
      )}
      {dialog === 'shop' && (
        <Modal title="旅途卡牌市场" close={() => setDialog(null)}>
          <p className="hint">
            花 {drawPrice} 随机抽一张卡，抵达当回合限抽一次；抽到的卡下回合才能使用。手牌最多{' '}
            {BOARD.handLimit} 张（含待解锁的卡），每回合只能使用一张。当前现金 {me?.cash}。
          </p>
          {(() => {
            const why = !me
              ? '观众不能抽卡'
              : !canManage || g?.phase !== 'manage'
                ? '停在卡牌市场的那个回合（掷骰之后）才能抽卡'
                : me.shopped
                  ? '本回合已经抽过了'
                  : me.cardCount >= BOARD.handLimit
                    ? '手牌已满'
                    : me.cash < drawPrice
                      ? '现金不足'
                      : '';
            return (
              <>
                <button
                  className="primary shop-draw"
                  disabled={disabled || !!why}
                  onClick={() => {
                    command({ type: 'buyCard' });
                    setDialog(null);
                  }}
                >
                  🎴 抽一张卡 · {drawPrice}
                </button>
                {why && <p className="field-error">{why}</p>}
              </>
            );
          })()}
          <h4 className="pool-title">卡池（稀有卡出现概率是普通卡的三分之一）</h4>
          <div className="catalog-grid pool">
            {CARDS.map((c) => (
              <article key={c.id} className={c.rarity}>
                <span>{c.icon}</span>
                <b>
                  {c.name}
                  {c.rarity === 'rare' && <em> 稀有</em>}
                </b>
                <p>{c.description}</p>
              </article>
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
                每回合先用卡牌或天赋，再掷一颗六面骰。处理落点后，可以升级、抵押、交易，再结束回合。岔路由当前玩家选择。先手更容易抢到地，所以从第
                2 位起每靠后一位多 {BOARD.seatBonus}{' '}
                起始现金。真人玩家默认不限时；房主可以设置操作时限，超时由系统执行稳妥的默认操作。机器人最多思考两分钟，超时由规则机器人接手。
              </p>
              <h3>02 / 四个角落与拘留所</h3>
              <p>
                标准棋盘一圈 36 格（大地图 44
                格），四角依次是起点、海关拘留所、免费停车场和海关遣返。经过起点领取 {map.salary}
                。停在遣返或抽到「护照过期」会直接进入拘留所，不经过起点、不领薪水；只是路过拘留所算作探访。被拘留后的下一回合可以缴纳
                100 保释金、使用「自由通行」卡（探险家天赋也可以），或掷骰碰运气：掷出 6
                点当场出狱并前进，否则留下一回合，之后自由出发。拘留期间仍可收租、建设和交易，但不能使用移动类卡牌。税费、维护费和保释金都会进入免费停车场奖池，下一位停车的玩家全部领走。
              </p>
              <h3>03 / 国家地产与经济</h3>
              <p>
                空地只有停在上面的玩家能买；放弃则继续空置。房主可以开启「空地拍卖」，开启后放弃购买会进入全员轮流竞拍，至少加价
                10，退出后不能再出价。地产可升 3 级，租金倍率为 1、2.5、5、9；独占街区额外
                +30%。抵押获得半价，赎回支付地价的 55%。建筑出售返还标准建设费的一半。
              </p>
              <h3>04 / 卡牌、银行与交易</h3>
              <p>
                手牌最多 {BOARD.handLimit} 张，每回合只能使用一张。卡牌市场花 {BOARD.cardDraw}{' '}
                随机抽一张（卡牌魔术师只需 {BOARD.dealerDraw}
                ），只能在停到市场的那个回合抽一次，稀有卡更难抽到；新得到的卡下回合才能用。租金护盾只能靠随机卡获得，最多持有
                1 次。每个角色有被动与每 3 轮一次的天赋。银行可存取现金，存款的基础每轮利息为{' '}
                {BOARD.interest * 100}%
                现金利息，世界新闻可能调整本轮利率。没钱付租金或税费时，先取款、卖建筑或抵押；无法筹齐可破产，将资产清算给债权人或银行。交易随时可以发起（购买、拍卖、选路和筹款时除外）：点「⇄
                发起交易」、玩家资料或国家详情里的「求购 /
                出售」，勾选双方的现金和任意多处无建筑、未抵押的地产。对方限时回应（涉及当前玩家 60
                秒，旁人之间 30 秒），可以接受、拒绝或还价，最多来回还价两次；被拒绝后需等 15
                秒才能再发起。交易进行时其他操作暂停，接受后双方资产同时交换。对手之间不能单方面赠送，双方给出的价值（现金
                + 地价）差距不能超过一倍，现金最多为所换地产地价的 2
                倍，交易也不能让任何一方直接达到目标净资产；不在自己回合时每轮只能发起一次交易，正在行动的玩家可以跳过旁人的交易。
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
                房主选择结束方式：固定轮数（默认 16 轮，快速战 10
                轮）、限时，或谁的净资产先达到目标。无论哪种方式，最多 90 分钟。最后两轮、最后 5
                分钟，或有人达到目标的 80% 时进入「终局冲刺」，所有租金 ×1.5。结束时按现金 + 存款 +
                地产地价（抵押地产按 45%）+ 建筑建设费的 75% −
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
                    {CATEGORY_NAMES[c.category]} · {c.rarity === 'rare' ? '稀有' : '普通'}
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
            {
              label: '音效',
              value: soundOn,
              key: 'mp-sound',
              set: (on: boolean) => {
                setSoundOn(on);
                setSoundEnabled(on);
                if (on) unlockSound();
              },
            },
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
          {room?.isHost && (
            <div className="exit-close">
              <p className="hint">
                你是房主：结束房间会让所有人离开，进行中的对局按当前净资产结算，房间 10 分钟后删除。
              </p>
              <button
                className="danger"
                disabled={busy || !connected}
                onClick={() => {
                  if (window.confirm('确定结束整个房间吗？')) lobby('close');
                }}
              >
                结束房间
              </button>
            </div>
          )}
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
                '点击「购买」获得地产，或「放弃购买」让它继续空置。购买失败时会提示具体原因。',
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
