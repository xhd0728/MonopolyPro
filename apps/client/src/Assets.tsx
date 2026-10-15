import { useState } from 'react';
import type {
  GameAction,
  GameView,
  PlayerView,
  MapDefinition,
} from '../../../packages/shared/src/index.ts';
import { BOARD, countryFlag } from '../../../packages/content/src/index.ts';
import { money } from './game-ui.ts';
export function Assets({
  game: g,
  me,
  map,
  disabled,
  command,
  select,
}: {
  game: GameView;
  me?: PlayerView;
  map: MapDefinition;
  disabled: boolean;
  command: (a: GameAction) => void;
  select: (tile: number) => void;
}) {
  const [amount, setAmount] = useState(300);
  const owned = g.properties.filter((p) => p.owner === me?.id);
  const manage =
    !!me &&
    g.activeId === me.id &&
    ['roll', 'jail', 'manage', 'debt'].includes(g.phase) &&
    !g.trade;
  const bank = !!me && (map.tiles[me.position].kind === 'bank' || g.phase === 'debt');
  const validAmount = Number.isSafeInteger(amount) && amount > 0;
  const bankReason = !manage
    ? '等待自己的经营阶段'
    : !bank
      ? '抵达国际银行后办理；偿债时可紧急取款'
      : !validAmount
        ? '请输入大于 0 的整数金额'
        : '';
  return (
    <>
      <h2>我的资产</h2>
      {me ? (
        <>
          <div className="asset-overview">
            <span>
              净资产 <strong>{money(me.assets)}</strong>
            </span>
            <span>
              地产估值 <strong>{money(me.propertyValue)}</strong>
            </span>
            {me.debt > 0 && (
              <span className="debt-label">
                待付债务 <strong>{money(me.debt)}</strong>
              </span>
            )}
          </div>
          <section className="bank-panel" aria-label="银行存取款">
            <div className="section-heading">
              <h3>国际银行</h3>
              <span>本轮利息 {money((g.bankInterestRate ?? BOARD.interest) * 100)}%</span>
            </div>
            <div className="bank-balances">
              <span>
                现金 <b>{money(me.cash)}</b>
              </span>
              <span>
                存款 <b>{money(me.deposit)}</b>
              </span>
            </div>
            <label>
              存取金额
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </label>
            <div className="bank-buttons">
              <button
                disabled={disabled || !!bankReason || g.phase === 'debt' || me.cash < amount}
                onClick={() => command({ type: 'bank', direction: 'deposit', amount })}
              >
                存入银行
              </button>
              <button
                disabled={disabled || !!bankReason || me.deposit < amount}
                onClick={() => command({ type: 'bank', direction: 'withdraw', amount })}
              >
                取出存款
              </button>
            </div>
            <p className="hint">
              {bankReason ||
                (g.phase === 'debt'
                  ? '偿债期间可以取款，暂不能存款。'
                  : `转账不会改变净资产；存入后剩余现金 ${money(Math.max(0, me.cash - amount))}。`)}
            </p>
          </section>
        </>
      ) : (
        <p className="hint">你正在观战。点击玩家卡片查看公开资产。</p>
      )}
      <div className="section-heading">
        <h3>我的国家地产</h3>
        <span>{owned.length} 处</span>
      </div>
      {owned.map((p) => (
        <div className="property-item" key={p.tile}>
          <button className="property-heading" onClick={() => select(p.tile)}>
            <span className="property-flag">{countryFlag(map.tiles[p.tile].countryCode)}</span>
            <span>
              <b>{map.tiles[p.tile].name}</b>
              <small>
                {p.mortgaged
                  ? '已抵押 · 暂停收租'
                  : `${p.level} 级建筑 · 当前租金 ${money(p.rent)}`}
              </small>
            </span>
            <span>↗</span>
          </button>
          <div className="property-actions">
            {(['build', 'downgrade', 'mortgage', 'redeem'] as const)
              .filter((type) =>
                type === 'redeem'
                  ? p.mortgaged
                  : type === 'mortgage'
                    ? !p.mortgaged
                    : type === 'downgrade'
                      ? p.level > 0
                      : !p.mortgaged,
              )
              .map((type) => {
                const option = g.actions.find(
                  (a) => a.action.type === type && 'tile' in a.action && a.action.tile === p.tile,
                );
                const label = {
                  build: '升级建筑',
                  downgrade: '出售建筑',
                  mortgage: '抵押地产',
                  redeem: '赎回地产',
                }[type];
                const reason = !manage
                  ? g.trade
                    ? '请先完成交易'
                    : '等待自己的经营阶段'
                  : type === 'build' && g.phase === 'debt'
                    ? '偿债期间不能建设'
                    : type === 'build' && p.level >= 3
                      ? '建筑已满级'
                      : type === 'mortgage' && p.level > 0
                        ? '请先出售所有建筑'
                        : type === 'redeem' && g.phase === 'debt'
                          ? '偿债期间不能赎回'
                          : '现金不足';
                return (
                  <button
                    key={type}
                    disabled={disabled || !option}
                    title={option?.hint ?? reason}
                    onClick={() => option && command(option.action)}
                  >
                    {label}
                    <small>{option?.hint ?? reason}</small>
                  </button>
                );
              })}
          </div>
        </div>
      ))}
      {me && !owned.length && <p className="hint">还没有地产。停在待售国家时可以购买。</p>}
    </>
  );
}
