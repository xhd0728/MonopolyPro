import type {
  GameAction,
  GameView,
  PlayerView,
  MapDefinition,
} from '../../../packages/shared/src/index.ts';
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
  const owned = g.properties.filter((p) => p.owner === me?.id);
  return (
    <>
      <h2>我的地产</h2>
      {owned.map((p) => (
        <div className="property-item" key={p.tile}>
          <button className="text-button" onClick={() => select(p.tile)}>
            {map.tiles[p.tile].name} · {p.mortgaged ? '已抵押' : `${p.level} 级`}
          </button>
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
              const reason =
                g.activeId !== me?.id || !['roll', 'manage', 'debt'].includes(g.phase)
                  ? '等待自己的经营阶段'
                  : g.trade
                    ? '请先完成交易'
                    : type === 'build' && g.phase === 'debt'
                      ? '偿债期间不能建设'
                      : type === 'build' && p.level >= 3
                        ? '建筑已满级'
                        : type === 'mortgage' && p.level > 0
                          ? '请先出售所有建筑'
                          : g.phase === 'debt' && type === 'redeem'
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
      ))}
      {!owned.length && <p className="hint">还没有地产。抵达空地后购买，或参与公开拍卖。</p>}
    </>
  );
}
