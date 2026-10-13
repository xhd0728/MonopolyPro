import { useState, type CSSProperties } from 'react';
import { countryFlag } from '../../../packages/content/src/index.ts';
import type {
  GameAction,
  GameView,
  MapDefinition,
  PlayerView,
} from '../../../packages/shared/src/index.ts';
import { Clock } from './clock.tsx';
import { groupColor, money, validMoney } from './game-ui.ts';

export interface TradeDraft {
  to: string;
  giveCash: number;
  wantCash: number;
  giveTiles: number[];
  wantTiles: number[];
  /** Answering an offer (还价) instead of starting a new one. */
  counter?: boolean;
}

const tradable = (game: GameView, owner: string) =>
  game.properties.filter((p) => p.owner === owner && !p.level && !p.mortgaged);
/** Would `receiver` own the whole colour group after receiving `tiles`? */
function completesGroup(game: GameView, map: MapDefinition, receiver: string, tiles: number[]) {
  const groups = new Set(tiles.map((t) => map.tiles[t].group));
  return [...groups].filter((group) =>
    game.properties
      .filter((p) => map.tiles[p.tile].group === group)
      .every((p) => p.owner === receiver || tiles.includes(p.tile)),
  );
}
const value = (map: MapDefinition, cash: number, tiles: number[]) =>
  cash + tiles.reduce((n, t) => n + map.tiles[t].price, 0);

/** Whether the viewer may propose right now; returns the reason if not. */
export function tradeBlock(game: GameView, me: PlayerView | undefined, now: number): string {
  if (!me || me.bankrupt) return '观众不能交易';
  if (game.trade) return '已有一笔交易等待回应';
  if (!['roll', 'jail', 'manage'].includes(game.phase))
    return '购买、拍卖、选路或筹款时不能发起交易';
  const until = game.tradeMemo[me.id]?.until ?? 0;
  if (until > now) return `刚被拒绝或撤回，${Math.ceil((until - now) / 1000)} 秒后可再发起`;
  return '';
}

export function TradeDialog({
  game,
  map,
  me,
  draft,
  disabled,
  send,
}: {
  game: GameView;
  map: MapDefinition;
  me: PlayerView;
  draft: TradeDraft;
  disabled: boolean;
  send: (action: GameAction) => void;
}) {
  const [d, setD] = useState(draft);
  const partners = game.players.filter((p) => p.id !== me.id && !p.bankrupt);
  const partner = game.players.find((p) => p.id === d.to);
  const toggle = (side: 'giveTiles' | 'wantTiles', tile: number) =>
    setD({
      ...d,
      [side]: d[side].includes(tile) ? d[side].filter((t) => t !== tile) : [...d[side], tile],
    });
  const gives = value(map, d.giveCash, d.giveTiles),
    gets = value(map, d.wantCash, d.wantTiles);
  const myGroups = completesGroup(game, map, me.id, d.wantTiles);
  // Rules the server enforces between rivals (teammates may help each other freely).
  const rival = !!partner && (game.settings.mode !== 'team' || partner.team !== me.team);
  const listed = (tiles: number[]) => tiles.reduce((n, t) => n + map.tiles[t].price, 0);
  const active = game.players[game.turn]?.id;
  const sideOffer = !d.counter && !!partner && active !== me.id && active !== partner.id;
  const theirGroups = partner ? completesGroup(game, map, partner.id, d.giveTiles) : [];
  const reason = !partner
    ? '请选择交易对象'
    : !validMoney(d.giveCash) || !validMoney(d.wantCash)
      ? '现金必须是非负整数'
      : d.giveCash > me.cash
        ? '给出的现金超过你的余额'
        : d.wantCash > partner.cash
          ? `${partner.name}只有 ${money(partner.cash)} 现金`
          : !d.giveCash && !d.wantCash && !d.giveTiles.length && !d.wantTiles.length
            ? '至少放入一项现金或地产'
            : rival && !(d.giveCash || d.giveTiles.length) !== !(d.wantCash || d.wantTiles.length)
              ? '对手之间的交易需要双方都付出现金或地产，不能单方面赠送'
              : rival &&
                  (d.giveCash > listed(d.wantTiles) * 2 || d.wantCash > listed(d.giveTiles) * 2)
                ? '现金不能超过所换地产标价的 2 倍'
                : rival && (gives * 2 < gets || gets * 2 < gives)
                  ? '双方给出的价值（现金 + 地价）差距不能超过一倍'
                  : sideOffer && game.tradeMemo[me.id]?.side === game.round
                    ? '不在自己回合时，每轮只能发起一次交易'
                    : '';
  // Plain render helpers (not components) so inputs keep focus while typing.
  const squares = (owner: string, side: 'giveTiles' | 'wantTiles') => {
    const list = tradable(game, owner);
    const locked = game.properties.filter((p) => p.owner === owner && (p.level || p.mortgaged));
    return (
      <div className="trade-squares">
        {list.map((p) => {
          const t = map.tiles[p.tile];
          return (
            <label
              key={p.tile}
              className={d[side].includes(p.tile) ? 'picked' : ''}
              style={{ '--group': groupColor(t.group) } as CSSProperties}
            >
              <input
                type="checkbox"
                checked={d[side].includes(p.tile)}
                onChange={() => toggle(side, p.tile)}
              />
              <span>{countryFlag(t.countryCode)}</span>
              <b>{t.name}</b>
              <small>{money(t.price)}</small>
            </label>
          );
        })}
        {!list.length && <p className="hint">没有可交易的地产</p>}
        {locked.length > 0 && (
          <p className="hint">{locked.length} 处有建筑或已抵押，需先出售建筑或赎回才能交易。</p>
        )}
      </div>
    );
  };
  const cashInput = (side: 'giveCash' | 'wantCash', max: number) => (
    <div className="trade-cash">
      <label>
        现金
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={10}
          max={max}
          value={d[side]}
          onChange={(e) => setD({ ...d, [side]: Number(e.target.value) })}
        />
      </label>
      <span>
        {[100, 500].map((n) => (
          <button type="button" key={n} onClick={() => setD({ ...d, [side]: d[side] + n })}>
            +{n}
          </button>
        ))}
        <button type="button" onClick={() => setD({ ...d, [side]: 0 })}>
          清零
        </button>
      </span>
    </div>
  );
  return (
    <div className="trade-dialog">
      <ol className="trade-steps">
        <li>选对象</li>
        <li>勾选双方的现金和地产</li>
        <li>发出后对方在时限内（涉及当前玩家 60 秒，旁人之间 30 秒）接受、拒绝或还价</li>
        <li>对手间不能单方面赠送，双方价值差距不超过一倍</li>
      </ol>
      {!d.counter && (
        <label>
          交易对象
          <select value={d.to} onChange={(e) => setD({ ...d, to: e.target.value, wantTiles: [] })}>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · 现金 {money(p.cash)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="trade-grid">
        <section>
          <h3>我给出</h3>
          {cashInput('giveCash', me.cash)}
          {squares(me.id, 'giveTiles')}
        </section>
        <section>
          <h3>我得到{partner ? `（来自${partner.name}）` : ''}</h3>
          {cashInput('wantCash', partner?.cash ?? 0)}
          {partner && squares(partner.id, 'wantTiles')}
        </section>
      </div>
      <div className="trade-verdict">
        <span>
          按地价估算：你给出 <b>{money(gives)}</b>，得到 <b>{money(gets)}</b>
        </span>
        {myGroups.length > 0 && <em className="good">✓ 你可以凑齐一组同色国家，租金 +30%</em>}
        {theirGroups.length > 0 && (
          <em className="warn">⚠ 对方因此凑齐一组同色国家，要价可以高一些</em>
        )}
        {!myGroups.length && !theirGroups.length && gets > 0 && gives > 0 && (
          <em>{gets >= gives ? '这笔交易对你划算' : '你付出的更多，对方更可能接受'}</em>
        )}
      </div>
      {reason && <p className="field-error">{reason}</p>}
      <button
        className="primary full"
        disabled={disabled || !!reason}
        onClick={() =>
          send(
            d.counter
              ? {
                  type: 'tradeCounter',
                  giveCash: d.giveCash,
                  wantCash: d.wantCash,
                  giveTiles: d.giveTiles,
                  wantTiles: d.wantTiles,
                }
              : {
                  type: 'tradeOffer',
                  to: d.to,
                  giveCash: d.giveCash,
                  wantCash: d.wantCash,
                  giveTiles: d.giveTiles,
                  wantTiles: d.wantTiles,
                },
          )
        }
      >
        {d.counter ? '发出还价' : '发出提案'}
      </button>
    </div>
  );
}

/** The pending offer, shown to everyone; the receiver gets accept / counter / reject. */
export function TradeOfferCard({
  game,
  map,
  disabled,
  command,
  counter,
}: {
  game: GameView;
  map: MapDefinition;
  disabled: boolean;
  command: (action: GameAction) => void;
  counter: (draft: TradeDraft) => void;
}) {
  const t = game.trade!;
  const from = game.players.find((p) => p.id === t.from)!,
    to = game.players.find((p) => p.id === t.to)!;
  const mineIn = t.to === game.viewerId,
    mineOut = t.from === game.viewerId;
  const side = (cash: number, tiles: number[]) => (
    <ul>
      {cash > 0 && <li>💰 现金 {money(cash)}</li>}
      {tiles.map((x) => (
        <li key={x}>
          {countryFlag(map.tiles[x].countryCode)} {map.tiles[x].name}
          <small> 地价 {money(map.tiles[x].price)}</small>
        </li>
      ))}
      {!cash && !tiles.length && <li className="hint">什么都不给</li>}
    </ul>
  );
  return (
    <div className={`trade-offer ${mineIn ? 'incoming' : ''}`} aria-label="交易提案">
      <header>
        <b>
          {t.counter ? '还价' : '交易提案'}：{mineOut ? '你' : from.name} →{' '}
          {mineIn ? '你' : to.name}
        </b>
        <small>
          还剩 <Clock>{(now) => Math.max(0, Math.ceil((t.expiresAt - now) / 1000))}</Clock> 秒
        </small>
      </header>
      <div className="trade-offer-sides">
        <section>
          <h4>{mineIn ? '你得到' : `${from.name}给出`}</h4>
          {side(t.giveCash, t.giveTiles)}
        </section>
        <section>
          <h4>{mineIn ? '你付出' : `${from.name}想要`}</h4>
          {side(t.wantCash, t.wantTiles)}
        </section>
      </div>
      {mineIn && (
        <div className="trade-offer-actions">
          <button
            className="primary"
            disabled={disabled}
            onClick={() => command({ type: 'tradeAccept' })}
          >
            接受交易
          </button>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() =>
              // A counter starts from the reverse of what was offered.
              counter({
                to: t.from,
                giveCash: t.wantCash,
                wantCash: t.giveCash,
                giveTiles: [...t.wantTiles],
                wantTiles: [...t.giveTiles],
                counter: true,
              })
            }
          >
            还价
          </button>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => command({ type: 'tradeReject' })}
          >
            拒绝交易
          </button>
        </div>
      )}
      {mineOut && (
        <div className="trade-offer-actions">
          <span className="hint">等待{to.name}回应…</span>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => command({ type: 'tradeReject' })}
          >
            撤回提案
          </button>
        </div>
      )}
      {!mineIn && !mineOut && game.players[game.turn]?.id === game.viewerId ? (
        <div className="trade-offer-actions">
          <span className="hint">这是旁人之间的交易，你可以不等。</span>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => command({ type: 'tradeReject' })}
          >
            跳过，继续我的回合
          </button>
        </div>
      ) : (
        !mineIn && !mineOut && <p className="hint">等待{to.name}回应，交易期间其他操作暂停。</p>
      )}
    </div>
  );
}
