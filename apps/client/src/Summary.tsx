import { useMemo, useState, type CSSProperties } from 'react';
import type {
  GameView,
  MapDefinition,
  PlayerView,
  RoundSnapshot,
} from '../../../packages/shared/src/index.ts';
import { AssetDonut, PlayerRadar, TrendChart, type TrendMetric } from './ReportCharts.tsx';
import { ReportDialog } from './ReportDialog.tsx';
import './reports.css';
import { money, playerColor } from './game-ui.ts';

/** Titles handed out at the end; each goes to whoever leads that statistic (ties share). */
const TITLES: { title: string; icon: string; value: (p: PlayerView) => number; unit: string }[] = [
  { title: '收租王', icon: '👑', value: (p) => p.stats.rentIn, unit: '收租' },
  { title: '地产大亨', icon: '🏙️', value: (p) => p.stats.bought, unit: '处地产' },
  { title: '建筑师', icon: '🏗️', value: (p) => p.stats.built, unit: '次升级' },
  { title: '环球旅行家', icon: '🧭', value: (p) => p.stats.laps, unit: '圈' },
  { title: '卡牌大师', icon: '🃏', value: (p) => p.stats.cards, unit: '张卡' },
  { title: '交易达人', icon: '🤝', value: (p) => p.stats.trades, unit: '笔交易' },
  { title: '最佳预言家', icon: '🔮', value: (p) => p.prophet, unit: '次猜中' },
  { title: '常驻拘留所', icon: '🚔', value: (p) => p.stats.jailed, unit: '次入狱' },
];
function titlesFor(game: GameView) {
  return TITLES.flatMap((t) => {
    const best = Math.max(0, ...game.players.map(t.value));
    if (!best) return [];
    const who = game.players.filter((p) => t.value(p) === best);
    return [{ ...t, best, who }];
  });
}
export function MatchSummary({
  game,
  map,
  isHost,
  restart,
}: {
  game: GameView;
  map: MapDefinition;
  isHost: boolean;
  restart: () => void;
}) {
  const [folded, setFolded] = useState(false);
  const [tab, setTab] = useState('总览');
  const [metric, setMetric] = useState<TrendMetric>('assets');
  const ranked = [...game.players].sort((a, b) => b.assets - a.assets);
  const winners = game.players.filter((p) => game.winners.includes(p.id));
  const titles = titlesFor(game);
  const played =
    game.settings.end === 'rounds' ? Math.min(game.round, game.settings.rounds) : game.round;
  const history = useMemo<RoundSnapshot[]>(
    () =>
      game.history?.length
        ? game.history
        : [
            {
              round: played,
              at: game.finishedAt ?? game.decisionAt,
              complete: false,
              players: game.players.map((p) => ({
                id: p.id,
                assets: p.assets,
                cash: p.cash,
                deposit: p.deposit,
                propertyValue: p.propertyValue,
                debt: p.debt,
                properties: p.propertyCount,
                buildings: p.buildingCount,
                bankrupt: p.bankrupt,
                stats: p.stats,
              })),
            },
          ],
    [game.history, game.id],
  );
  const [cursor, setCursor] = useState(history.length - 1);
  const selected = Math.min(cursor, history.length - 1);
  const sample = history[selected];
  const [playerId, setPlayerId] = useState(
    game.viewerId && game.players.some((p) => p.id === game.viewerId)
      ? game.viewerId
      : ranked[0].id,
  );
  const player = sample.players.find((p) => p.id === playerId) ?? sample.players[0];
  const hasHistory = history.length > 1;
  const duration = Math.max(
    0,
    Math.round(((game.finishedAt ?? game.decisionAt) - game.startedAt) / 60000),
  );
  const totalRent = game.players.reduce((n, p) => n + p.stats.rentIn, 0);
  const totalTrades = Math.floor(game.players.reduce((n, p) => n + p.stats.trades, 0) / 2);
  const top = Math.max(1, ranked[0]?.assets ?? 1);
  if (folded)
    return (
      <button className="settlement-reopen primary" onClick={() => setFolded(false)}>
        🏁 查看旅程纪念册
      </button>
    );
  const playerSelect = (
    <label className="report-select">
      观察玩家
      <select aria-label="观察玩家" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
        {game.players.map((p) => (
          <option value={p.id} key={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
  const roundControl = (
    <div className="round-control">
      <label htmlFor="report-round">
        {sample.round === 0
          ? '开局资产'
          : `第 ${sample.round} 轮${sample.complete ? '结束' : ' · 终局截面'}`}
      </label>
      <input
        id="report-round"
        aria-label="选择复盘轮次"
        type="range"
        min="0"
        max={history.length - 1}
        value={selected}
        onChange={(e) => setCursor(Number(e.target.value))}
        disabled={!hasHistory}
      />
      <span>
        {selected + 1} / {history.length}
      </span>
    </div>
  );
  return (
    <ReportDialog label="旅程纪念册" className="match-report" close={() => setFolded(true)}>
      <header className="report-top">
        <div>
          <span className="eyebrow">MONOPOLY PRO · MATCH REPORT</span>
          <b>旅程纪念册</b>
        </div>
        <button className="icon-button" aria-label="收起结算面板" onClick={() => setFolded(true)}>
          ×
        </button>
      </header>
      <div className={`report-scroll${tab === '总览' ? '' : ' report-analysis'}`}>
        <section className="victory-hero">
          <div className="victory-trophy" aria-hidden="true">
            🏆
          </div>
          <div>
            <span className="victory-kicker">{winners.length > 1 ? '共享荣光' : '旅程冠军'}</span>
            <h2>{winners.map((p) => p.name).join('、')} 获胜！</h2>
            <p>{game.finishReason}</p>
          </div>
          <div className="victory-worth">
            <span>{game.settings.mode === 'team' ? '获胜队伍净资产' : '冠军净资产'}</span>
            <strong>{money(winners.reduce((n, p) => n + p.assets, 0))}</strong>
            <span>
              第 {played} 轮 · {duration < 1 ? '不到 1' : duration} 分钟的精彩旅程
            </span>
          </div>
        </section>
        <div className="report-kpis">
          <div>
            <small>全场流转租金</small>
            <b>{money(totalRent)}</b>
          </div>
          <div>
            <small>总建设次数</small>
            <b>
              {game.players.reduce((n, p) => n + p.stats.built, 0)}
              <em> 次</em>
            </b>
          </div>
          <div>
            <small>达成交易</small>
            <b>
              {totalTrades}
              <em> 笔</em>
            </b>
          </div>
          <div>
            <small>参与旅行家</small>
            <b>
              {game.players.length}
              <em> 位</em>
            </b>
          </div>
        </div>
        <nav className="report-tabs" aria-label="战报视图">
          {['总览', '回合复盘', '玩家对比'].map((t) => (
            <button
              key={t}
              aria-pressed={tab === t}
              className={tab === t ? 'on' : ''}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        {tab === '总览' ? (
          <div className="report-overview">
            <section className="report-card">
              <div className="report-card-heading">
                <h3>最终排名</h3>
                <span>按净资产排序 · 团队胜负按队伍总资产</span>
              </div>
              <div className="report-ranking">
                {ranked.map((p, i) => (
                  <article
                    key={p.id}
                    className={game.winners.includes(p.id) ? 'winner' : ''}
                    style={
                      {
                        '--who': playerColor(game.players.findIndex((x) => x.id === p.id)),
                      } as CSSProperties
                    }
                  >
                    <span className="rank-number">
                      {i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <b>
                        {p.name} {game.winners.includes(p.id) && <em>冠军</em>}
                        {p.bankrupt && <small> · 已破产</small>}
                      </b>
                      <span>
                        收租 {money(p.stats.rentIn)} · 付租 {money(p.stats.rentOut)} · 地产{' '}
                        {p.propertyCount} · 建设 {p.stats.built} 次
                      </span>
                      <i className="rank-track">
                        <i style={{ width: `${(Math.max(0, p.assets) / top) * 100}%` }} />
                      </i>
                    </div>
                    <strong>
                      {money(p.assets)}
                      <small>净资产</small>
                    </strong>
                  </article>
                ))}
              </div>
            </section>
            <section className="report-card award-card">
              <div className="report-card-heading">
                <h3>旅途荣誉</h3>
                <span>每一项精彩都值得记住</span>
              </div>
              <div className="report-awards">
                {titles.map((t) => (
                  <article key={t.title}>
                    <span>{t.icon}</span>
                    <div>
                      <b>{t.title}</b>
                      <strong>{t.who.map((p) => p.name).join('、')}</strong>
                      <small>
                        {money(t.best)} {t.unit}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <>
            <div className="report-analysis-controls">
              {roundControl}
              {tab === '玩家对比' && playerSelect}
            </div>
            {!hasHistory && (
              <p className="report-empty">
                此存档没有逐轮财务记录，当前仅展示终局数据。新对局会自动保存轮次快照。
              </p>
            )}
            {hasHistory && history[0].round !== 0 && (
              <p className="report-empty">
                此对局从第 {history[0].round} 轮开始记录，早期数据不可用。
              </p>
            )}
            {history.some((s, i) => i > 0 && s.round - history[i - 1].round > 1) && (
              <p className="report-empty">
                超长对局仅保留开局与最近 512 轮；缺少相邻轮次时，轮次增量显示为 —。
              </p>
            )}
            {tab === '回合复盘' ? (
              <>
                <section className="report-card">
                  <div className="report-card-heading">
                    <h3>财富走势</h3>
                    <select
                      aria-label="趋势指标"
                      value={metric}
                      onChange={(e) => setMetric(e.target.value as TrendMetric)}
                    >
                      <option value="assets">净资产</option>
                      <option value="cash">现金</option>
                      <option value="rentIn">累计收租</option>
                      <option value="netRent">累计净租金</option>
                    </select>
                  </div>
                  {hasHistory ? (
                    <TrendChart
                      game={game}
                      history={history}
                      selected={selected}
                      select={setCursor}
                      metric={metric}
                    />
                  ) : (
                    <p className="report-note">历史不足，无法绘制趋势。</p>
                  )}
                </section>
                <section className="report-card">
                  <div className="report-card-heading">
                    <h3>{sample.round === 0 ? '开局财务' : `第 ${sample.round} 轮财务明细`}</h3>
                    <span>收租与付租为本轮增量，其余为截面值</span>
                  </div>
                  <div className="report-table-wrap">
                    <table className="report-table">
                      <thead>
                        <tr>
                          {[
                            '玩家',
                            '净资产',
                            '本轮增减',
                            '现金',
                            '存款',
                            '地产 / 建筑',
                            '本轮收租',
                            '本轮付租',
                            '本轮建设',
                          ].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sample.players.map((p) => {
                          const previous = history[selected - 1]?.players.find(
                            (x) => x.id === p.id,
                          );
                          const delta =
                            previous && history[selected - 1].round === sample.round - 1
                              ? p.assets - previous.assets
                              : null;
                          const continuous =
                            !!previous && history[selected - 1].round === sample.round - 1;
                          return (
                            <tr key={p.id}>
                              <th>{game.players.find((x) => x.id === p.id)?.name}</th>
                              <td>{money(p.assets)}</td>
                              <td className={delta !== null && delta < 0 ? 'expense' : 'income'}>
                                {delta === null ? '—' : `${delta > 0 ? '+' : ''}${money(delta)}`}
                              </td>
                              <td>{money(p.cash)}</td>
                              <td>{money(p.deposit)}</td>
                              <td>
                                {p.properties} / {p.buildings}
                              </td>
                              <td>
                                {continuous ? money(p.stats.rentIn - previous.stats.rentIn) : '—'}
                              </td>
                              <td>
                                {continuous ? money(p.stats.rentOut - previous.stats.rentOut) : '—'}
                              </td>
                              <td>{continuous ? p.stats.built - previous.stats.built : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="report-note">
                    完成轮次在轮末采样；终局截面可能为未完成轮次。开局包含后手补偿，净资产包含地产权益并扣除待偿债务。
                  </p>
                </section>
              </>
            ) : (
              <>
                <div className="report-comparison">
                  <section className="report-card">
                    <div className="report-card-heading">
                      <h3>资产构成</h3>
                      <span>{game.players.find((p) => p.id === player.id)?.name}</span>
                    </div>
                    <AssetDonut player={player} />
                  </section>
                  <section className="report-card">
                    <div className="report-card-heading">
                      <h3>经营六维图</h3>
                      <span>与本轮资产领先者比较</span>
                    </div>
                    <PlayerRadar game={game} snapshot={sample} playerId={playerId} />
                  </section>
                </div>
                <section className="report-card player-highlights">
                  <h3>经营档案</h3>
                  {[
                    { label: '累计收租', value: player.stats.rentIn },
                    { label: '累计付租', value: player.stats.rentOut },
                    { label: '最高单笔租金', value: player.stats.biggestRent },
                    { label: '累计购地', value: player.stats.bought },
                    { label: '累计绕行', value: player.stats.laps },
                    { label: '使用卡牌', value: player.stats.cards },
                  ].map((x) => (
                    <div key={x.label}>
                      <small>{x.label}</small>
                      <b>{money(x.value)}</b>
                    </div>
                  ))}
                </section>
              </>
            )}
          </>
        )}
      </div>
      <footer className="report-footer">
        <span>每一次选择，都留下了自己的轨迹。</span>
        <button className="secondary" onClick={() => setFolded(true)}>
          收起，看看棋盘
        </button>
        {isHost ? (
          <button className="primary" onClick={restart}>
            再开启一段旅程 →
          </button>
        ) : (
          <small>等待房主开启新的一局</small>
        )}
      </footer>
    </ReportDialog>
  );
}
