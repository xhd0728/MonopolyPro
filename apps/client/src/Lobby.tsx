import { useEffect, useState, type ReactNode } from 'react';
import { CHARACTERS, MAPS, characterById } from '../../../packages/content/src/index.ts';
import {
  TURN_SECONDS,
  type MapDefinition,
  type RoomSettings,
  type RoomView,
} from '../../../packages/shared/src/index.ts';
import { money } from './game-ui.ts';

export const END_CHOICES: [string, string][] = [
  ['rounds:10', '10 轮 · 快速，约 20 分钟'],
  ['rounds:16', '16 轮 · 默认，约 30 分钟'],
  ['rounds:20', '20 轮（约 40 分钟）'],
  ['rounds:30', '30 轮（长局）'],
  ['time:15', '限时 15 分钟'],
  ['time:30', '限时 30 分钟'],
  ['time:45', '限时 45 分钟'],
  ['time:60', '限时 60 分钟'],
  ['target:10000', '净资产先到 10,000'],
  ['target:15000', '净资产先到 15,000'],
  ['target:25000', '净资产先到 25,000'],
];
export const endValue = (s: RoomSettings) => {
  const end = s.end ?? 'time';
  return `${end}:${end === 'rounds' ? s.rounds : end === 'time' ? s.minutes : s.target}`;
};
const MODE_NAMES = { free: '自由战', quick: '快速战', team: '团队战' } as const;
const LEVEL_NAMES = { easy: '简单', normal: '普通', hard: '困难' } as const;

/**
 * The room before a match: who is coming, who plays which character, and how the journey is
 * set up. The host edits everything here, including the password and closing the room.
 */
export function Lobby({
  room,
  map,
  disabled,
  tutorial,
  lobby,
  invite,
  chat,
}: {
  room: RoomView;
  map: MapDefinition;
  disabled: boolean;
  tutorial: boolean;
  lobby: (type: string, extras?: object) => void;
  invite: () => void;
  chat: ReactNode;
}) {
  const me = room.seats.find((s) => s.id === room.viewerId);
  const players = room.seats.filter((s) => !s.spectator);
  const watching = room.seats.filter((s) => s.spectator && s.connected).length;
  const empty = Math.max(0, room.settings.maxPlayers - players.length);
  const llm = room.ai.configured && !tutorial;
  const host = room.isHost;
  const [name, setName] = useState(me?.name ?? '');
  useEffect(() => setName(me?.name ?? ''), [me?.name]);
  const [password, setPassword] = useState<string | null>(null);
  const set = (patch: Partial<RoomSettings>) => lobby('settings', { settingsPatch: patch });
  // The host's "start" counts as ready, so only the others need to confirm.
  const isReady = (s: (typeof players)[number]) => s.ready || s.id === room.hostId;
  const ready = players.filter(isReady).length;
  const startReason =
    players.length < 2
      ? '至少需要两个席位，可以添加机器人'
      : !players.every((s) => isReady(s) && (s.connected || s.bot))
        ? '等待其他玩家连上并点「我准备好了」'
        : room.settings.mode === 'team' &&
            (![4, 6].includes(players.length) ||
              players.filter((s) => s.team === 0).length !== players.length / 2)
          ? '团队战需要 2v2 或 3v3，两队人数相同'
          : '';
  const mine = characterById(me?.characterId ?? 'builder');
  return (
    <div className="lobby">
      <header className="lobby-pass">
        <div className="pass-title">
          <h1>准备出发</h1>
          <p>
            {MODE_NAMES[room.settings.mode]}，{map.name}，{room.settings.maxPlayers} 个席位
          </p>
        </div>
        <div className="pass-code">
          <span>房间码</span>
          <b aria-label={`房间码 ${room.code}`}>{room.code}</b>
        </div>
        <div className="pass-actions">
          <button className="primary" onClick={invite}>
            复制邀请链接
          </button>
          {host ? (
            password === null ? (
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => setPassword('')}
                title="设置后，加入房间需要输入密码"
              >
                {room.locked ? '🔒 修改密码' : '设置密码'}
              </button>
            ) : (
              <form
                className="pass-password"
                onSubmit={(e) => {
                  e.preventDefault();
                  lobby('password', { password });
                  setPassword(null);
                }}
              >
                <input
                  aria-label="房间密码"
                  type="password"
                  maxLength={64}
                  autoFocus
                  placeholder={room.locked ? '新密码，留空则取消' : '输入密码'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button className="secondary" disabled={disabled}>
                  {password ? '保存密码' : room.locked ? '取消密码' : '保存'}
                </button>
                <button type="button" className="text-button" onClick={() => setPassword(null)}>
                  取消
                </button>
              </form>
            )
          ) : (
            room.locked && <span className="pass-lock">🔒 密码房</span>
          )}
          {host && (
            <button
              className="text-button pass-close"
              disabled={disabled}
              onClick={() => {
                if (window.confirm('结束房间后所有人都会离开，房间 10 分钟后删除。确定结束吗？'))
                  lobby('close');
              }}
            >
              结束房间
            </button>
          )}
        </div>
      </header>

      <div className="lobby-grid">
        <section className="paper lobby-seats" aria-label="席位">
          <div className="section-heading">
            <h2>旅行伙伴</h2>
            <span>
              {players.length}/{room.settings.maxPlayers} 人{watching ? `，${watching} 人观战` : ''}
            </span>
          </div>
          <ol className="seat-list">
            {players.map((s, i) => {
              const c = characterById(s.characterId);
              const self = s.id === room.viewerId;
              return (
                <li key={s.id} className={`seat-row ${self ? 'self' : ''}`}>
                  <span className="seat-number">{i + 1}</span>
                  <span className="avatar" style={{ background: c.color }} aria-hidden="true">
                    {c.icon}
                  </span>
                  <div className="seat-who">
                    {self ? (
                      <form
                        className="seat-rename"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const next = name.trim();
                          if (next && next !== s.name) {
                            localStorage.setItem('mp-name', next);
                            lobby('rename', { name: next });
                          }
                        }}
                      >
                        <input
                          aria-label="我的昵称"
                          maxLength={16}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                        {name.trim() && name.trim() !== s.name && (
                          <button className="secondary" disabled={disabled}>
                            保存
                          </button>
                        )}
                      </form>
                    ) : (
                      <b>{s.name}</b>
                    )}
                    <small>
                      {self
                        ? '你'
                        : s.bot
                          ? `${s.botMode === 'llm' ? 'LLM 机器人' : '规则机器人'}（${LEVEL_NAMES[s.botLevel ?? 'normal']}）`
                          : '朋友'}
                      {s.id === room.hostId ? '，房主' : ''}，{c.name} · {c.title}
                      {room.settings.mode === 'team' ? `，${s.team === 0 ? '青' : '橙'}队` : ''}
                    </small>
                  </div>
                  {s.bot && host ? (
                    <div className="seat-controls">
                      <select
                        aria-label={`${s.name}的类型`}
                        value={s.botMode ?? 'rule'}
                        disabled={disabled}
                        onChange={(e) =>
                          lobby('botSettings', { seatId: s.id, botMode: e.target.value })
                        }
                      >
                        <option value="rule">规则</option>
                        <option value="llm" disabled={!llm}>
                          LLM{llm ? '' : '（未配置）'}
                        </option>
                      </select>
                      <select
                        aria-label={`${s.name}的难度`}
                        value={s.botLevel ?? 'normal'}
                        disabled={disabled}
                        title="简单：凭感觉；普通：稳健；困难：积极建房、交易谨慎"
                        onChange={(e) =>
                          lobby('botSettings', { seatId: s.id, botLevel: e.target.value })
                        }
                      >
                        {(['easy', 'normal', 'hard'] as const).map((lv) => (
                          <option key={lv} value={lv}>
                            {LEVEL_NAMES[lv]}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`${s.name}的角色`}
                        value={s.characterId}
                        disabled={disabled}
                        onChange={(e) =>
                          lobby('botSettings', { seatId: s.id, characterId: e.target.value })
                        }
                      >
                        {CHARACTERS.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                      {room.settings.mode === 'team' && (
                        <button
                          className="secondary"
                          disabled={disabled}
                          onClick={() =>
                            lobby('botSettings', { seatId: s.id, team: s.team ? 0 : 1 })
                          }
                        >
                          换队
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label={`移除${s.name}`}
                        disabled={disabled}
                        onClick={() => lobby('removeBot', { seatId: s.id })}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`seat-state ${isReady(s) ? 'ready' : ''} ${!s.bot && !s.connected ? 'away' : ''}`}
                    >
                      {s.bot
                        ? '已就位'
                        : !s.connected
                          ? '连接断开'
                          : s.id === room.hostId
                            ? '房主'
                            : s.ready
                              ? '已准备'
                              : '未准备'}
                    </span>
                  )}
                  {!s.bot && host && !self && (
                    <button
                      className="icon-button"
                      aria-label={`移出${s.name}`}
                      title="把这位玩家移出房间"
                      disabled={disabled}
                      onClick={() => lobby('kick', { seatId: s.id })}
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
            {Array.from({ length: empty }).map((_, i) => (
              <li key={`empty-${i}`} className="seat-row empty">
                <span className="seat-number">{players.length + i + 1}</span>
                <span className="avatar empty" aria-hidden="true" />
                <div className="seat-who">
                  <b>空位</b>
                  <small>{host ? '等朋友用邀请链接加入，或放一个机器人' : '等待朋友加入'}</small>
                </div>
                {host && (
                  <div className="seat-controls">
                    <button
                      className="secondary"
                      aria-label="添加规则机器人"
                      disabled={disabled}
                      onClick={() => lobby('addBot', { botMode: 'rule' })}
                    >
                      ＋ 规则机器人
                    </button>
                    {!tutorial && (
                      <button
                        className="secondary"
                        aria-label="添加 LLM 机器人"
                        disabled={disabled || !llm}
                        title={
                          llm
                            ? `由 ${room.ai.model} 决策，超时由规则机器人接手`
                            : '服务端尚未配置模型'
                        }
                        onClick={() => lobby('addBot', { botMode: 'llm' })}
                      >
                        ＋ LLM 机器人
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {room.settings.mode === 'team' && me && !me.spectator && (
            <div className="team-picker">
              <span>我的队伍</span>
              {[0, 1].map((team) => (
                <button
                  key={team}
                  className={me.team === team ? 'selected' : ''}
                  disabled={disabled}
                  onClick={() => lobby('team', { team })}
                >
                  {team === 0 ? '青队' : '橙队'}
                </button>
              ))}
            </div>
          )}

          {me && !me.spectator && (
            <>
              <div className="section-heading">
                <h2>我的角色</h2>
                <span>天赋每 3 轮可用一次</span>
              </div>
              <div className="role-strip" role="radiogroup" aria-label="选择角色">
                {CHARACTERS.map((c) => (
                  <button
                    key={c.id}
                    role="radio"
                    aria-checked={me.characterId === c.id}
                    className={`role-chip ${me.characterId === c.id ? 'selected' : ''}`}
                    disabled={disabled}
                    onClick={() => lobby('character', { characterId: c.id })}
                  >
                    <span className="avatar" style={{ background: c.color }} aria-hidden="true">
                      {c.icon}
                    </span>
                    <b>{c.name}</b>
                    <small>{c.title}</small>
                  </button>
                ))}
              </div>
              <p className="role-detail">
                <b>
                  {mine.name} · {mine.title}
                </b>
                {mine.description}
                <em>{mine.ability}</em>
              </p>
            </>
          )}
          {me?.spectator && <p className="tip-box">你在观战席，对局开始后可以看到全部公开信息。</p>}
        </section>

        <aside className="paper room-settings">
          <div className="section-heading">
            <h2>旅程设置</h2>
            {!host && <span>由房主决定</span>}
          </div>
          <div className="settings-grid">
            <label>
              地图
              <select
                aria-label="地图"
                value={room.settings.mapId}
                disabled={!host || disabled}
                onChange={(e) => set({ mapId: e.target.value })}
              >
                {MAPS.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              席位上限
              <select
                aria-label="席位上限"
                value={room.settings.maxPlayers}
                disabled={!host || disabled}
                onChange={(e) => set({ maxPlayers: Number(e.target.value) })}
              >
                {[2, 3, 4, 5, 6].map((v) => (
                  <option key={v} value={v} disabled={v < players.length}>
                    {v} 人
                  </option>
                ))}
              </select>
            </label>
            <label>
              模式
              <select
                aria-label="模式"
                value={room.settings.mode}
                disabled={!host || disabled}
                onChange={(e) =>
                  set({
                    mode: e.target.value as RoomSettings['mode'],
                    end: 'rounds',
                    rounds: e.target.value === 'quick' ? 10 : 16,
                  })
                }
              >
                <option value="free">自由对战</option>
                <option value="quick">快速对战</option>
                <option value="team">团队战 2v2 / 3v3</option>
              </select>
            </label>
            <label>
              地图大小
              <select
                aria-label="地图大小"
                value={room.settings.size ?? 36}
                disabled={!host || disabled}
                onChange={(e) => set({ size: Number(e.target.value) as RoomSettings['size'] })}
              >
                <option value={36}>标准 36 格</option>
                <option value={44}>大地图 44 格</option>
              </select>
            </label>
            <label className="wide">
              结束方式
              <select
                aria-label="结束方式"
                value={endValue(room.settings)}
                disabled={!host || disabled}
                onChange={(e) => {
                  const [end, raw] = e.target.value.split(':');
                  const n = Number(raw);
                  set({
                    end: end as RoomSettings['end'],
                    ...(end === 'rounds' ? { rounds: n } : {}),
                    ...(end === 'time' ? { minutes: n } : {}),
                    ...(end === 'target' ? { target: n } : {}),
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
              空地拍卖
              <select
                aria-label="空地拍卖"
                value={room.settings.auction ? 'on' : 'off'}
                disabled={!host || disabled}
                onChange={(e) => set({ auction: e.target.value === 'on' })}
              >
                <option value="off">关闭（默认）</option>
                <option value="on">开启</option>
              </select>
            </label>
            <label>
              操作时限
              <select
                aria-label="玩家操作时限"
                value={room.settings.turnSeconds ?? 0}
                disabled={!host || disabled}
                onChange={(e) => set({ turnSeconds: Number(e.target.value) })}
              >
                {TURN_SECONDS.map((v) => (
                  <option key={v} value={v}>
                    {v ? `${v} 秒` : '不限时'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              起始现金
              <select
                aria-label="起始现金"
                value={room.settings.initialCash}
                disabled={!host || disabled}
                onChange={(e) => set({ initialCash: Number(e.target.value) })}
              >
                {[1000, 2000, 3000, 5000, 10000].map((v) => (
                  <option key={v} value={v}>
                    {money(v)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">
            {map.description}
            {room.settings.auction
              ? ' 放弃购买的空地进入全员公开竞拍。'
              : ' 只有停在空地上的人能买，放弃则继续空置。'}
          </p>
          <p className="hint">
            {room.ai.configured
              ? `LLM 机器人由 ${room.ai.model} 决策，每步最多两分钟，超时由规则机器人接手。`
              : 'LLM 机器人需要服务端配置模型；规则机器人随时可用。'}{' '}
            断线 {Math.ceil(room.takeoverAfterMs / 1000)} 秒后由机器人临时托管，回来即可接手。
          </p>
          {chat}
        </aside>
      </div>

      <div className="lobby-start" role="region" aria-label="开始">
        <p>
          <b>
            {ready}/{players.length} 已准备
          </b>
          <small>{startReason || (host ? '可以出发了' : '等待房主开始')}</small>
        </p>
        {me && !me.spectator && !host && (
          <button
            className={me.ready ? 'secondary' : 'primary'}
            disabled={disabled}
            onClick={() => lobby('ready')}
          >
            {me.ready ? '取消准备' : '我准备好了'}
          </button>
        )}
        {host && (
          <button
            className="primary"
            disabled={disabled || !!startReason}
            title={startReason || '所有席位已准备，可以出发'}
            onClick={() => lobby('start')}
          >
            开始旅程
          </button>
        )}
      </div>
    </div>
  );
}
