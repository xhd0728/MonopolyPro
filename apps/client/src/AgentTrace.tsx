import { useEffect, useState } from 'react';
import type {
  AiTraceStep,
  GameEvent,
  GameView,
  RoomView,
} from '../../../packages/shared/src/index.ts';
import { money, playerColor } from './game-ui.ts';
import { mapById, newsById } from '../../../packages/content/src/index.ts';
import { api } from './network.ts';
import { ReportDialog } from './ReportDialog.tsx';
import './reports.css';

const KINDS: Record<AiTraceStep['kind'], string> = {
  context: '局面',
  summary: '摘要',
  tool: '工具',
  validation: '校验',
  retry: '重试',
  decision: '决定',
  fallback: '接管',
  execution: '执行',
};
export function TraceTimeline({ trace }: { trace: AiTraceStep[] }) {
  return (
    <ol className="trace-timeline">
      {trace.map((step, i) => (
        <li key={i} className={`trace-${step.kind}`}>
          <span className="trace-node">{KINDS[step.kind]}</span>
          <div>
            <header>
              <b>{step.title}</b>
              <time>+{(step.ms / 1000).toFixed(1)}s</time>
            </header>
            {step.tool && <code>{step.tool}</code>}
            <p>{step.text}</p>
            {!!step.facts?.length && (
              <ul>
                {step.facts.map((fact, j) => (
                  <li key={j}>{fact}</li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
export function AgentInspector({
  game,
  ai,
  close,
  roomCode,
}: {
  roomCode?: string;
  game: GameView;
  ai: RoomView['aiActivity'];
  close: () => void;
}) {
  const [archive, setArchive] = useState<GameEvent[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async (cursor: number | null, signal?: AbortSignal) => {
    if (!roomCode) return;
    setLoading(true);
    setError('');
    try {
      const credentials = JSON.parse(localStorage.getItem('mp-seat') ?? '{}');
      if (credentials.code !== roomCode) return;
      const page = await api<{ events: GameEvent[]; before: number | null }>(
        `/api/rooms/${roomCode}/ai-traces`,
        { token: credentials.token, gameId: game.id, before: cursor },
      );
      if (signal?.aborted) return;
      setArchive((old) => [...new Map([...old, ...page.events].map((e) => [e.id, e])).values()]);
      setBefore(page.before);
    } catch {
      if (!signal?.aborted) setError('轨迹档案读取失败，可重试。');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    setArchive([]);
    setBefore(null);
    setSelected('live');
    void load(null, controller.signal);
    return () => controller.abort();
  }, [game.id, roomCode]);
  useEffect(() => {
    setArchive((old) => [
      ...new Map(
        [...old, ...game.events.filter((e) => e.aiTrace?.length)].map((e) => [e.id, e]),
      ).values(),
    ]);
  }, [game.id, game.nextEvent]);
  const decisions = [
    ...new Map(
      [...archive, ...game.events.filter((e) => e.aiTrace?.length)].map((e) => [e.id, e]),
    ).values(),
  ].sort((a, b) => b.id - a.id);
  const live = ai?.state === 'thinking' || ai?.state === 'queued';
  const [selected, setSelected] = useState('live');
  const event = selected === 'live' ? undefined : decisions.find((e) => String(e.id) === selected);
  const trace =
    event?.aiTrace ??
    (selected === 'live' && live ? ai?.trace : undefined) ??
    decisions[0]?.aiTrace ??
    ai?.trace ??
    [];
  const actor = event?.actor ?? (live ? ai?.playerId : decisions[0]?.actor);
  const who = game.players.find((p) => p.id === actor);
  const map = mapById(game.settings.mapId, game.settings.size);
  const news = game.news ? newsById(game.news.id) : undefined;
  return (
    <ReportDialog label="Agent 决策台" close={close} className="agent-inspector">
      <header className="report-top">
        <div>
          <span className="eyebrow">LIVE AGENT</span>
          <h2>Agent 决策台</h2>
        </div>
        <button className="icon-button" aria-label="关闭决策台" onClick={close}>
          ×
        </button>
      </header>
      <div className="inspector-body">
        <section className="inspector-state">
          <h3>
            全场实时状态{' '}
            <small>
              第{' '}
              {game.settings.end === 'rounds'
                ? Math.min(game.round, game.settings.rounds)
                : game.round}{' '}
              轮
            </small>
          </h3>
          <div className="inspector-objective">
            {game.settings.end === 'rounds'
              ? `${game.settings.rounds} 轮后结算`
              : game.settings.end === 'target'
                ? `目标净资产 ${money(game.settings.target)}`
                : `${game.settings.minutes} 分钟限时`}{' '}
            · 奖池 {money(game.pot)}
          </div>
          <div className="inspector-objective">
            {map.name} ·{' '}
            {game.phase === 'finished'
              ? '已结算'
              : `当前行动：${game.players.find((p) => p.id === game.activeId)?.name ?? '等待'}`}
            <br />
            {news ? `本轮新闻：${news.name} · ${news.text}` : '本轮无特殊新闻'}
          </div>
          {game.players.map((p, i) => (
            <article key={p.id} style={{ borderColor: playerColor(i) }}>
              <b>
                {p.name}
                {p.bankrupt ? ' · 已破产' : ''}
              </b>
              <strong>
                {money(p.assets)} <small>净资产</small>
              </strong>
              <span>
                现金 {money(p.cash)} · 存款 {money(p.deposit)}
              </span>
              <span>
                地产 {p.propertyCount} · 建筑 {p.buildingCount} · 手牌 {p.cardCount}
              </span>
              <span>
                位置：{map.tiles[p.position].name}
                {p.jailTurns > 0 ? ' · 拘留中' : ''}
              </span>
            </article>
          ))}
          <p className="report-note">
            轨迹保存查询目的、公开工具结果与执行记录。私有手牌、预设骰子及模型内部推理不在此展示。
          </p>
        </section>
        <section className="inspector-trace">
          <label>
            查看决策
            <select
              aria-label="选择决策轨迹"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="live">{live ? '实时跟随当前决策' : '最近一次决策'}</option>
              {decisions.map((e) => (
                <option key={e.id} value={e.id}>
                  #{e.id} · {game.players.find((p) => p.id === e.actor)?.name} ·{' '}
                  {e.aiTrace?.at(-1)?.title}
                </option>
              ))}
            </select>
          </label>
          <div className="trace-archive-controls">
            <small>{decisions.length} 条可选决策</small>
            {(before || error) && (
              <button className="secondary" disabled={loading} onClick={() => void load(before)}>
                {loading ? '读取中…' : error ? '重试读取' : '加载更早的决策'}
              </button>
            )}
            {error && <span role="status">{error}</span>}
          </div>
          <h3>
            {who?.name ?? 'AI'} · 决策轨迹{' '}
            {live && selected === 'live' && <small className="live-badge">进行中</small>}
          </h3>
          {trace.length ? (
            <TraceTimeline trace={trace} />
          ) : (
            <p className="report-note">尚未产生决策轨迹。AI 开始决策后会自动更新。</p>
          )}
          <p className="report-note">轨迹按需从本局持久化档案读取；全场状态始终显示当前值。</p>
        </section>
      </div>
    </ReportDialog>
  );
}
