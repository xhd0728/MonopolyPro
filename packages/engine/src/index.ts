import { BOARD, CARDS, cardById, characterById, mapById } from '../../content/src/index.ts';
import type {
  ActionOption,
  GameAction,
  GameState,
  GameView,
  PlayerState,
  PropertyState,
  RoomSettings,
  Seat,
  TileDefinition,
} from '../../shared/src/index.ts';

export interface EngineEnvironment {
  now: number;
  randomInt: (max: number) => number;
}
export class RuleError extends Error {}
function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RuleError(message);
}
export const currentPlayer = (g: GameState) => g.players[g.turn];
export const propertyAt = (g: GameState, tile: number) => g.properties.find((p) => p.tile === tile);
const tileAt = (g: GameState, tile: number) => mapById(g.settings.mapId).tiles[tile];
const playerById = (g: GameState, id: string) => g.players.find((p) => p.id === id);
const enemy = (g: GameState, a: PlayerState, b: PlayerState) =>
  a.id !== b.id && (g.settings.mode !== 'team' || a.team !== b.team);
export function log(
  g: GameState,
  env: EngineEnvironment,
  kind: string,
  text: string,
  actor?: string,
  amount?: number,
  path?: number[],
) {
  g.events.push({
    id: g.nextEvent++,
    at: env.now,
    kind,
    text,
    ...(actor !== undefined ? { actor } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(path !== undefined ? { path } : {}),
  });
  if (g.events.length > 120) g.events.splice(0, g.events.length - 120);
}
function drawCard(g: GameState, p: PlayerState, env: EngineEnvironment) {
  if (p.cards.length >= 8) return;
  p.cards.push(CARDS[env.randomInt(CARDS.length)].id);
  log(g, env, 'card', `${p.name}获得一张卡牌`, p.id);
}
export function assetsOf(g: GameState, p: PlayerState): number {
  const propertyValue = g.properties
    .filter((x) => x.owner === p.id)
    .reduce((sum, x) => {
      const tile = tileAt(g, x.tile);
      return (
        sum +
        (x.mortgaged ? 0 : Math.floor(tile.price / 2)) +
        Math.floor((x.level * tile.buildCost) / 2)
      );
    }, 0);
  return p.cash + p.deposit + propertyValue - (g.debt?.playerId === p.id ? g.debt.amount : 0);
}
export function rentOf(g: GameState, property: PropertyState, payer?: PlayerState): number {
  if (!property.owner || property.mortgaged) return 0;
  const owner = playerById(g, property.owner)!;
  const tile = tileAt(g, property.tile);
  const group = g.properties.filter((x) => tileAt(g, x.tile).group === tile.group);
  const monopoly = group.length > 0 && group.every((x) => x.owner === property.owner);
  let rent = tile.rent * [1, 2.5, 5, 9][property.level] * (monopoly ? 1.3 : 1);
  if (owner.characterId === 'landlord') rent *= 1.15;
  if (payer?.characterId === 'guardian') rent *= 0.85;
  if (property.boostUntil >= g.round) rent *= 1.5;
  if (property.cutUntil >= g.round) rent *= 0.5;
  return Math.max(0, Math.round(rent));
}
export function buildCost(g: GameState, p: PlayerState, property: PropertyState): number {
  return Math.round(
    tileAt(g, property.tile).buildCost *
      (p.characterId === 'builder' ? 0.85 : 1) *
      (p.discount ? 0.5 : 1),
  );
}
export function createGame(
  settings: RoomSettings,
  seats: Seat[],
  id: string,
  env: EngineEnvironment,
): GameState {
  const players = seats
    .filter((s) => !s.spectator)
    .map(
      (s) =>
        ({
          id: s.id,
          name: s.name,
          characterId: s.characterId,
          team: s.team,
          cash: settings.initialCash,
          deposit: 0,
          position: 0,
          cards: [],
          bankrupt: false,
          shield: 0,
          taxShield: 0,
          skipTurns: 0,
          jailTurns: 0,
          nextDice: null,
          discount: false,
          abilityRound: -2,
          bot: s.bot,
        }) satisfies PlayerState,
    );
  requireRule(players.length >= 2 && players.length <= 6, '对局需要 2–6 个席位');
  if (settings.mode === 'team')
    requireRule(
      [4, 6].includes(players.length) &&
        players.filter((p) => p.team === 0).length === players.length / 2 &&
        players.filter((p) => p.team === 1).length === players.length / 2,
      '团队模式需要均分的 2v2 或 3v3 队伍',
    );
  const g: GameState = {
    version: 2,
    id,
    revision: 0,
    settings,
    players,
    properties: mapById(settings.mapId)
      .tiles.filter((t) => t.kind === 'property')
      .map((t) => ({
        tile: t.index,
        owner: null,
        level: 0,
        mortgaged: false,
        boostUntil: 0,
        cutUntil: 0,
        protectedUntil: 0,
      })),
    turn: 0,
    round: 1,
    phase: 'roll',
    startedAt: env.now,
    endsAt: env.now + settings.minutes * 60000,
    decisionAt: env.now,
    pendingPath: null,
    auction: null,
    debt: null,
    trade: null,
    traps: {},
    pot: 0,
    events: [],
    nextEvent: 1,
    lastDice: [],
    winners: [],
    finishReason: '',
  };
  for (const p of players)
    for (let i = 0; i < (p.characterId === 'dealer' ? 3 : 2); i++) drawCard(g, p, env);
  log(g, env, 'start', '富翁之旅开始了！先使用卡牌或天赋，再掷骰出发。');
  return g;
}
function setPhase(g: GameState, phase: GameState['phase'], env: EngineEnvironment) {
  g.phase = phase;
  g.decisionAt = env.now;
}
function reward(
  g: GameState,
  p: PlayerState,
  amount: number,
  env: EngineEnvironment,
  reason: string,
) {
  p.cash += amount;
  log(g, env, 'money', `${p.name}：${reason} +${amount}`, p.id, amount);
}
function charge(
  g: GameState,
  p: PlayerState,
  amount: number,
  creditorId: string | null,
  env: EngineEnvironment,
  reason: string,
) {
  if (p.cash >= amount) {
    p.cash -= amount;
    if (creditorId) playerById(g, creditorId)!.cash += amount;
    else g.pot += amount;
    log(g, env, 'payment', `${p.name}：${reason} −${amount}`, p.id, -amount);
  } else {
    g.debt = { playerId: p.id, amount, creditorId, reason };
    setPhase(g, 'debt', env);
    log(
      g,
      env,
      'debt',
      `${p.name}需要筹集 ${amount} 支付${reason}；可取款、抵押或出售建筑。`,
      p.id,
    );
  }
}
function settleDebt(g: GameState, env: EngineEnvironment) {
  const d = g.debt;
  if (!d) return;
  const p = playerById(g, d.playerId)!;
  if (p.cash < d.amount) return;
  g.debt = null;
  setPhase(g, 'manage', env);
  charge(g, p, d.amount, d.creditorId, env, d.reason);
}
function finish(g: GameState, reason: string, env: EngineEnvironment) {
  const alive = g.players.filter((p) => !p.bankrupt);
  const contestants = alive.length ? alive : g.players;
  if (g.settings.mode === 'team') {
    const teams =
      reason === '仅剩一方仍在经营' ? [...new Set(contestants.map((p) => p.team))] : [0, 1];
    const scores = teams.map((team) => ({
      team,
      score: contestants.filter((p) => p.team === team).reduce((n, p) => n + assetsOf(g, p), 0),
    }));
    const max = Math.max(...scores.map((x) => x.score));
    const winningTeams = scores.filter((x) => x.score === max).map((x) => x.team);
    g.winners = g.players.filter((p) => winningTeams.includes(p.team)).map((p) => p.id);
  } else {
    const max = Math.max(...contestants.map((p) => assetsOf(g, p)));
    g.winners = contestants.filter((p) => assetsOf(g, p) === max).map((p) => p.id);
  }
  g.finishReason = reason;
  g.trade = null;
  g.auction = null;
  g.pendingPath = null;
  setPhase(g, 'finished', env);
  log(
    g,
    env,
    'finish',
    `${reason}。${g.players
      .filter((p) => g.winners.includes(p.id))
      .map((p) => p.name)
      .join('、')}获胜！`,
  );
}
function checkWinner(g: GameState, env: EngineEnvironment): boolean {
  if (g.phase === 'finished') return true;
  const alive = g.players.filter((p) => !p.bankrupt);
  if (
    g.settings.mode === 'team' ? new Set(alive.map((p) => p.team)).size <= 1 : alive.length <= 1
  ) {
    finish(g, '仅剩一方仍在经营', env);
    return true;
  }
  if (env.now >= g.endsAt) {
    finish(g, '比赛时间结束，按净资产结算', env);
    return true;
  }
  return false;
}
function advanceTurn(g: GameState, env: EngineEnvironment) {
  if (checkWinner(g, env)) return;
  g.trade = null;
  g.debt = null;
  g.auction = null;
  g.pendingPath = null;
  for (let i = 0; i < g.players.length * 2; i++) {
    g.turn = (g.turn + 1) % g.players.length;
    if (g.turn === 0) {
      g.round++;
      for (const p of g.players.filter((p) => !p.bankrupt && p.deposit > 0))
        reward(g, p, Math.floor(p.deposit * 0.03), env, '银行利息');
      const map = mapById(g.settings.mapId);
      if (map.mechanic === 'gates')
        log(
          g,
          env,
          'map',
          g.round % 2 === 0 ? '丝路商路开放，可选择跨洲快线。' : '丝路商路关闭，沿常规环线前进。',
        );
      if (g.round % 4 === 0) {
        const amount = 70 + env.randomInt(80);
        for (const p of g.players.filter((p) => !p.bankrupt))
          reward(g, p, amount, env, '环球庆典奖励');
      }
    }
    const p = currentPlayer(g);
    if (p.bankrupt) continue;
    if (p.skipTurns > 0) {
      p.skipTurns--;
      log(g, env, 'skip', `${p.name}临时停留一回合`, p.id);
      continue;
    }
    if (p.jailTurns > 0) {
      setPhase(g, 'jail', env);
      log(
        g,
        env,
        'jail',
        `轮到${p.name}，仍在${tileAt(g, BOARD.jail).name}：缴纳 ${BOARD.bail} 保释金、使用「自由通行」或掷出 ${BOARD.jailEscapeFace} 点出狱`,
        p.id,
      );
      return;
    }
    setPhase(g, 'roll', env);
    log(g, env, 'turn', `轮到${p.name}，第 ${g.round} 轮`, p.id);
    return;
  }
  throw new RuleError('没有可推进的玩家回合');
}
export const gatesOpen = (g: Pick<GameState, 'round'>) => g.round % 2 === 0;
export function exitsFor(g: GameState, index: number): number[] {
  const map = mapById(g.settings.mapId);
  if (map.mechanic === 'gates' && gatesOpen(g)) {
    const gate = map.shortcuts.find(([from]) => from === index);
    if (gate) return [(index + 1) % map.tiles.length, gate[1]];
  }
  return map.tiles[index].exits;
}
/** Partner port for the ferry map, or undefined when the tile is not a port. */
export function ferryTarget(g: GameState, index: number): number | undefined {
  const map = mapById(g.settings.mapId);
  if (map.tiles[index]?.kind !== 'transit') return undefined;
  const pair = map.shortcuts.find((link) => link.includes(index));
  return pair && (pair[0] === index ? pair[1] : pair[0]);
}
const FERRY_FARE = 80;
function sendToJail(g: GameState, p: PlayerState, env: EngineEnvironment, reason: string) {
  p.position = BOARD.jail;
  p.jailTurns = 1;
  p.nextDice = null;
  g.pendingPath = null;
  setPhase(g, 'manage', env);
  log(
    g,
    env,
    'jail',
    `${p.name}${reason}，直接前往${tileAt(g, BOARD.jail).name}，不经过起点`,
    p.id,
    undefined,
    [BOARD.jail],
  );
}
function releaseFromJail(g: GameState, p: PlayerState, env: EngineEnvironment, how: string) {
  p.jailTurns = 0;
  if (g.phase === 'jail') setPhase(g, 'roll', env);
  log(g, env, 'jail', `${p.name}${how}，离开${tileAt(g, BOARD.jail).name}`, p.id);
}
function land(g: GameState, env: EngineEnvironment) {
  const p = currentPlayer(g),
    tile = tileAt(g, p.position);
  setPhase(g, 'manage', env);
  const trap = g.traps[p.position];
  if (
    trap &&
    trap.until >= g.round &&
    trap.owner !== p.id &&
    enemy(g, p, playerById(g, trap.owner)!)
  ) {
    delete g.traps[p.position];
    charge(g, p, trap.amount, trap.owner, env, '道路施工');
    if (g.debt) return;
  }
  const property = propertyAt(g, p.position);
  if (property) {
    if (!property.owner) {
      setPhase(g, 'purchase', env);
      return;
    }
    const owner = playerById(g, property.owner)!;
    if (enemy(g, p, owner) && !property.mortgaged) {
      if (p.shield > 0) {
        p.shield--;
        log(g, env, 'shield', `${p.name}的护盾免除了本次租金`, p.id);
      } else charge(g, p, rentOf(g, property, p), owner.id, env, `向${owner.name}支付租金`);
    }
    return;
  }
  if (tile.kind === 'event') {
    const event = env.randomInt(8);
    if (event === 0)
      reward(
        g,
        p,
        Math.round((150 + env.randomInt(150)) * (p.characterId === 'explorer' ? 1.25 : 1)),
        env,
        '街区奇遇',
      );
    else if (event === 1) drawCard(g, p, env);
    else if (event === 2) {
      p.shield++;
      log(g, env, 'event', `${p.name}得到市民保险，一次租金护盾`, p.id);
    } else if (event === 3) charge(g, p, 100, null, env, '公共设施维护');
    else if (event === 4) {
      const size = mapById(g.settings.mapId).tiles.length;
      const path = [1, 2, 3].map((n) => (p.position - n + size) % size);
      p.position = path[2];
      log(
        g,
        env,
        'move',
        `${p.name}遇到逆风，后退 3 格至${tileAt(g, p.position).name}`,
        p.id,
        undefined,
        path,
      );
      land(g, env);
    } else if (event === 5) sendToJail(g, p, env, '护照过期');
    else if (event === 6) {
      p.position = BOARD.start;
      log(g, env, 'move', `${p.name}搭上免费航班，直飞起点`, p.id, undefined, [BOARD.start]);
      reward(g, p, BOARD.salary, env, '抵达起点');
    } else {
      let total = 0;
      for (const other of g.players.filter((x) => !x.bankrupt && enemy(g, p, x))) {
        const amount = Math.min(other.cash, 30);
        other.cash -= amount;
        total += amount;
      }
      p.cash += total;
      log(g, env, 'event', `${p.name}举办旅途生日会，收到对手礼金 ${total}`, p.id, total);
    }
  } else if (tile.kind === 'tax') {
    if (p.taxShield > 0) {
      p.taxShield--;
      log(g, env, 'shield', `${p.name}使用税务减免`, p.id);
    } else charge(g, p, 120 + g.round * 5, null, env, '公共税费');
  } else if (tile.kind === 'gotojail') sendToJail(g, p, env, '在海关接受检查');
  else if (tile.kind === 'parking') {
    if (g.pot > 0) {
      const pot = g.pot;
      g.pot = 0;
      reward(g, p, pot, env, '领取免费停车场奖池');
    } else log(g, env, 'map', `${p.name}在免费停车场休息，奖池暂时为空`, p.id);
  } else if (tile.kind === 'jail') log(g, env, 'map', `${p.name}只是路过拘留所探访`, p.id);
  else if (tile.kind === 'transit')
    log(g, env, 'map', `港口已靠岸，可支付 ${FERRY_FARE} 乘船前往对岸港口。`, p.id);
}
function move(g: GameState, steps: number, env: EngineEnvironment, existingPath: number[] = []) {
  const p = currentPlayer(g),
    path = existingPath;
  for (let left = steps; left > 0; left--) {
    const exits = exitsFor(g, p.position);
    if (exits.length > 1) {
      g.pendingPath = { choices: exits, remaining: left, path };
      setPhase(g, 'path', env);
      return;
    }
    p.position = exits[0];
    path.push(p.position);
    if (p.position === BOARD.start) reward(g, p, BOARD.salary, env, '经过起点');
  }
  g.pendingPath = null;
  log(g, env, 'move', `${p.name}抵达${tileAt(g, p.position).name}`, p.id, undefined, path);
  land(g, env);
}
function startAuction(g: GameState, env: EngineEnvironment) {
  g.auction = {
    tile: currentPlayer(g).position,
    bidderIds: g.players.filter((p) => !p.bankrupt).map((p) => p.id),
    passedIds: [],
    highBid: 0,
    highBidderId: null,
    bidderIndex: 0,
  };
  setPhase(g, 'auction', env);
  log(g, env, 'auction', `${tileAt(g, g.auction.tile).name}进入公开拍卖`);
}
function advanceAuction(g: GameState, env: EngineEnvironment, preserveBidder = false) {
  const a = g.auction!;
  const remaining = a.bidderIds.filter(
    (id) => !a.passedIds.includes(id) && !playerById(g, id)!.bankrupt,
  );
  if (remaining.length === 0 || (remaining.length === 1 && a.highBidderId === remaining[0])) {
    if (a.highBidderId && !playerById(g, a.highBidderId)!.bankrupt) {
      const p = playerById(g, a.highBidderId)!;
      requireRule(p.cash >= a.highBid, '竞拍资金不足');
      p.cash -= a.highBid;
      propertyAt(g, a.tile)!.owner = p.id;
      log(
        g,
        env,
        'auction',
        `${p.name}以 ${a.highBid} 竞得${tileAt(g, a.tile).name}`,
        p.id,
        -a.highBid,
      );
    } else log(g, env, 'auction', '无人出价，地产保留在市场中。');
    g.auction = null;
    if (currentPlayer(g).bankrupt) advanceTurn(g, env);
    else setPhase(g, 'manage', env);
    return;
  }
  if (
    preserveBidder &&
    remaining.includes(a.bidderIds[a.bidderIndex]) &&
    a.bidderIds[a.bidderIndex] !== a.highBidderId
  )
    return;
  for (let n = 0; n < a.bidderIds.length; n++) {
    a.bidderIndex = (a.bidderIndex + 1) % a.bidderIds.length;
    const id = a.bidderIds[a.bidderIndex];
    if (remaining.includes(id) && id !== a.highBidderId) {
      g.decisionAt = env.now;
      return;
    }
  }
}
function bankrupt(g: GameState, p: PlayerState, env: EngineEnvironment) {
  const creditor =
    g.debt?.playerId === p.id && g.debt.creditorId ? playerById(g, g.debt.creditorId) : undefined;
  if (creditor && !creditor.bankrupt) creditor.cash += p.cash + p.deposit;
  for (const property of g.properties.filter((x) => x.owner === p.id)) {
    property.owner = creditor && !creditor.bankrupt ? creditor.id : null;
    property.mortgaged = false;
    property.level = 0;
    property.boostUntil = 0;
    property.cutUntil = 0;
    property.protectedUntil = 0;
  }
  p.cash = 0;
  p.deposit = 0;
  p.cards = [];
  p.bankrupt = true;
  for (const [tile, trap] of Object.entries(g.traps))
    if (trap.owner === p.id) delete g.traps[Number(tile)];
  if (g.trade && [g.trade.from, g.trade.to].includes(p.id)) g.trade = null;
  log(g, env, 'bankrupt', `${p.name}结束经营，可继续观战`, p.id);
  if (g.debt?.playerId === p.id) g.debt = null;
  if (!checkWinner(g, env)) {
    if (g.auction) {
      g.auction.passedIds.push(p.id);
      if (g.auction.highBidderId === p.id) {
        g.auction.highBidderId = null;
        g.auction.highBid = 0;
      }
      advanceAuction(g, env, true);
      return;
    }
    if (currentPlayer(g).id === p.id) advanceTurn(g, env);
  }
}
function ownProperty(g: GameState, p: PlayerState, tile: number): PropertyState {
  const property = propertyAt(g, tile);
  requireRule(property && property.owner === p.id, '这处地产不属于你');
  return property;
}
const MANAGE_PHASES: GameState['phase'][] = ['roll', 'jail', 'manage'];
function manageAllowed(g: GameState, p: PlayerState) {
  requireRule(
    currentPlayer(g).id === p.id && MANAGE_PHASES.includes(g.phase),
    '请等待自己的可操作阶段',
  );
}
function cardAction(
  g: GameState,
  p: PlayerState,
  action: Extract<GameAction, { type: 'playCard' }>,
  env: EngineEnvironment,
) {
  manageAllowed(g, p);
  const card = cardById(action.cardId);
  requireRule(card && p.cards.includes(card.id), '没有这张卡牌');
  requireRule(p.jailTurns === 0 || card.category !== 'move', '拘留中不能使用移动类卡牌');
  let target = p;
  let property: PropertyState | undefined;
  if (card.target === 'player') {
    const found = action.targetId && playerById(g, action.targetId);
    requireRule(found && !found.bankrupt && enemy(g, p, found), '请选择一名仍在经营的对手');
    target = found;
  } else if (['ownProperty', 'enemyProperty', 'emptyProperty', 'tile'].includes(card.target)) {
    requireRule(action.tile !== undefined, '请选择目标地产');
    property = propertyAt(g, action.tile);
    requireRule(property, '目标必须是地产');
    if (card.target === 'ownProperty') requireRule(property.owner === p.id, '请选择自己的地产');
    if (card.target === 'enemyProperty') {
      const owner = property.owner && playerById(g, property.owner);
      requireRule(owner && enemy(g, p, owner), '请选择对手地产');
      requireRule(property.protectedUntil < g.round, '这处建筑正在受到保护');
    }
    if (card.target === 'emptyProperty') requireRule(!property.owner, '请选择尚未出售的空地');
  }
  switch (card.effect) {
    case 'move':
      move(g, card.amount, env);
      break;
    case 'teleport':
      p.position = BOARD.start;
      reward(g, p, BOARD.salary, env, '回到起点');
      break;
    case 'dice':
      requireRule(
        action.value !== undefined &&
          Number.isInteger(action.value) &&
          action.value >= 1 &&
          action.value <= 6,
        '请选择骰子点数',
      );
      p.nextDice = action.value;
      break;
    case 'swap': {
      const old = p.position;
      p.position = target.position;
      target.position = old;
      break;
    }
    case 'money':
      reward(g, p, card.amount, env, card.name);
      break;
    case 'steal': {
      const amount = Math.min(target.cash, card.amount);
      target.cash -= amount;
      p.cash += amount;
      break;
    }
    case 'deposit':
      p.deposit += card.amount;
      break;
    case 'interest':
      reward(g, p, Math.max(80, Math.floor((p.deposit * card.amount) / 100)), env, card.name);
      break;
    case 'collect':
      for (const other of g.players.filter((x) => !x.bankrupt && enemy(g, p, x))) {
        const amount = Math.min(other.cash, card.amount);
        other.cash -= amount;
        p.cash += amount;
      }
      break;
    case 'upgrade':
      requireRule(property!.level < 3 && !property!.mortgaged, '建筑已满级或处于抵押状态');
      property!.level++;
      break;
    case 'discount':
      p.discount = true;
      break;
    case 'demolish':
      requireRule(property!.level > 0, '目标没有可拆除的建筑');
      property!.level--;
      break;
    case 'rentBoost':
      property!.boostUntil = g.round + card.amount - 1;
      break;
    case 'remoteBuy': {
      const price = tileAt(g, property!.tile).price;
      requireRule(p.cash >= price, `需要 ${price} 现金`);
      p.cash -= price;
      property!.owner = p.id;
      break;
    }
    case 'protect':
      property!.protectedUntil = g.round + card.amount - 1;
      break;
    case 'trap':
      g.traps[property!.tile] = { owner: p.id, until: g.round + 2, amount: card.amount };
      break;
    case 'skip':
      target.skipTurns = 1;
      break;
    case 'stealCard':
      requireRule(target.cards.length > 0 && p.cards.length < 8, '对手没有卡牌或手牌已满');
      p.cards.push(target.cards.splice(env.randomInt(target.cards.length), 1)[0]);
      break;
    case 'clearBoost':
      property!.boostUntil = 0;
      break;
    case 'rentCut':
      property!.cutUntil = g.round + card.amount - 1;
      break;
    case 'shield':
      p.shield += card.amount;
      break;
    case 'cleanse':
      p.skipTurns = 0;
      for (const prop of g.properties.filter((x) => x.owner === p.id)) prop.cutUntil = 0;
      break;
    case 'rescue':
      p.skipTurns = 0;
      if (p.jailTurns > 0) releaseFromJail(g, p, env, `使用「${card.name}」`);
      reward(g, p, 100, env, card.name);
      break;
    case 'insure':
      p.shield++;
      reward(g, p, card.amount, env, card.name);
      break;
    case 'taxShield':
      p.taxShield++;
      break;
  }
  p.cards.splice(p.cards.indexOf(card.id), 1);
  log(
    g,
    env,
    'card',
    `${p.name}使用「${card.name}」${target.id !== p.id ? `，目标：${target.name}` : property ? `，目标：${tileAt(g, property.tile).name}` : ''}`,
    p.id,
  );
}

export function applyAction(
  state: GameState,
  playerId: string,
  action: GameAction,
  env: EngineEnvironment,
): GameState {
  const g = structuredClone(state);
  requireRule(g.phase !== 'finished', '对局已经结束');
  if (checkWinner(g, env)) {
    g.revision++;
    return g;
  }
  const p = playerById(g, playerId);
  requireRule(p && !p.bankrupt, '此席位无法操作');
  if (g.trade && env.now >= g.trade.expiresAt) g.trade = null;
  requireRule(
    !g.trade || ['tradeAccept', 'tradeReject', 'surrender'].includes(action.type),
    '请先完成或撤回交易提案',
  );
  if (action.type === 'surrender') {
    bankrupt(g, p, env);
    g.revision++;
    return g;
  }
  switch (action.type) {
    case 'ferry': {
      manageAllowed(g, p);
      const target = ferryTarget(g, p.position);
      requireRule(g.phase === 'manage' && target !== undefined, '请在轮渡码头的经营阶段乘船');
      requireRule(p.cash >= FERRY_FARE, `轮渡需要 ${FERRY_FARE} 现金`);
      p.cash -= FERRY_FARE;
      p.position = target;
      setPhase(g, 'roll', env);
      log(
        g,
        env,
        'map',
        `${p.name}支付 ${FERRY_FARE} 乘坐轮渡，获得从另一座码头掷骰出发的机会`,
        p.id,
        -FERRY_FARE,
        [target],
      );
      break;
    }
    case 'bail': {
      requireRule(currentPlayer(g).id === p.id && g.phase === 'jail', '现在不在拘留所');
      requireRule(p.cash >= BOARD.bail, `保释金需要 ${BOARD.bail} 现金`);
      p.cash -= BOARD.bail;
      g.pot += BOARD.bail;
      log(
        g,
        env,
        'payment',
        `${p.name}：缴纳保释金 −${BOARD.bail}，计入停车场奖池`,
        p.id,
        -BOARD.bail,
      );
      releaseFromJail(g, p, env, '缴纳保释金');
      break;
    }
    case 'jailRoll': {
      requireRule(currentPlayer(g).id === p.id && g.phase === 'jail', '现在不在拘留所');
      const die = env.randomInt(6) + 1;
      g.lastDice = [die];
      log(g, env, 'dice', `${p.name}在拘留所掷出 ${die} 点`, p.id);
      p.jailTurns = 0;
      if (die >= BOARD.jailEscapeFace) {
        log(g, env, 'jail', `${p.name}掷出 ${die} 点，当场出狱并前进`, p.id);
        move(g, die + (p.characterId === 'runner' ? 1 : 0), env);
      } else {
        setPhase(g, 'manage', env);
        log(
          g,
          env,
          'jail',
          `${p.name}未掷出 ${BOARD.jailEscapeFace} 点，本回合留在拘留所，下回合自由出发`,
          p.id,
        );
      }
      break;
    }
    case 'roll': {
      requireRule(currentPlayer(g).id === p.id && g.phase === 'roll', '现在不能掷骰');
      // One six-sided die: a remote-dice card fixes the value, otherwise the server rolls.
      const die = p.nextDice ?? env.randomInt(6) + 1;
      p.nextDice = null;
      g.lastDice = [die];
      log(
        g,
        env,
        'dice',
        `${p.name}掷出 ${die} 点${p.characterId === 'runner' ? '，漫游者额外 +1' : ''}`,
        p.id,
      );
      move(g, die + (p.characterId === 'runner' ? 1 : 0), env);
      break;
    }
    case 'choosePath': {
      requireRule(
        currentPlayer(g).id === p.id &&
          g.phase === 'path' &&
          g.pendingPath?.choices.includes(action.tile),
        '请选择当前岔路',
      );
      const pending = g.pendingPath!;
      p.position = action.tile;
      if (p.position === 0) reward(g, p, 300, env, '经过起点');
      move(g, pending.remaining - 1, env, [...pending.path, p.position]);
      break;
    }
    case 'buy': {
      requireRule(currentPlayer(g).id === p.id && g.phase === 'purchase', '现在没有待购买的地产');
      const property = propertyAt(g, p.position)!,
        tile = tileAt(g, p.position);
      requireRule(!property.owner && p.cash >= tile.price, `需要 ${tile.price} 现金`);
      p.cash -= tile.price;
      property.owner = p.id;
      setPhase(g, 'manage', env);
      log(g, env, 'purchase', `${p.name}买下${tile.name}，花费 ${tile.price}`, p.id, -tile.price);
      break;
    }
    case 'pass':
      requireRule(currentPlayer(g).id === p.id && g.phase === 'purchase', '现在不能放弃购买');
      startAuction(g, env);
      break;
    case 'bid':
    case 'auctionPass': {
      const a = g.auction;
      requireRule(
        g.phase === 'auction' && a && a.bidderIds[a.bidderIndex] === p.id,
        '尚未轮到你竞拍',
      );
      if (action.type === 'bid') {
        requireRule(
          action.amount >= a.highBid + 10 && action.amount <= p.cash,
          '出价至少加价 10，且不能超过现金',
        );
        a.highBid = action.amount;
        a.highBidderId = p.id;
        log(g, env, 'bid', `${p.name}出价 ${action.amount}`, p.id);
      } else a.passedIds.push(p.id);
      advanceAuction(g, env);
      break;
    }
    case 'end':
      manageAllowed(g, p);
      requireRule(g.phase === 'manage', '请先掷骰并处理落点');
      advanceTurn(g, env);
      break;
    case 'build':
    case 'downgrade':
    case 'mortgage':
    case 'redeem': {
      requireRule(
        currentPlayer(g).id === p.id && [...MANAGE_PHASES, 'debt'].includes(g.phase),
        '请等待自己的经营阶段',
      );
      const property = ownProperty(g, p, action.tile),
        tile = tileAt(g, action.tile);
      if (action.type === 'build') {
        requireRule(
          g.phase !== 'debt' && property.level < 3 && !property.mortgaged,
          '负债、满级或抵押时不能建设',
        );
        const cost = buildCost(g, p, property);
        requireRule(p.cash >= cost, `建设需要 ${cost} 现金`);
        p.cash -= cost;
        p.discount = false;
        property.level++;
        log(
          g,
          env,
          'build',
          `${p.name}升级${tile.name}至 ${property.level} 级，花费 ${cost}`,
          p.id,
          -cost,
        );
      } else if (action.type === 'downgrade') {
        requireRule(property.level > 0, '没有可出售的建筑');
        property.level--;
        reward(g, p, Math.floor(tile.buildCost / 2), env, '出售建筑');
      } else if (action.type === 'mortgage') {
        requireRule(!property.mortgaged && property.level === 0, '请先出售建筑，或此地产已抵押');
        property.mortgaged = true;
        reward(g, p, Math.floor(tile.price / 2), env, '抵押地产');
      } else {
        const cost = Math.ceil(tile.price * 0.55);
        requireRule(
          g.phase !== 'debt' && property.mortgaged && p.cash >= cost,
          `赎回需要 ${cost} 现金`,
        );
        p.cash -= cost;
        property.mortgaged = false;
        log(g, env, 'redeem', `${p.name}赎回${tile.name}`, p.id, -cost);
      }
      settleDebt(g, env);
      break;
    }
    case 'bank': {
      requireRule(
        currentPlayer(g).id === p.id &&
          [...MANAGE_PHASES, 'debt'].includes(g.phase) &&
          (tileAt(g, p.position).kind === 'bank' || g.phase === 'debt'),
        '请在银行办理，负债时也可紧急取款',
      );
      requireRule(action.amount > 0, '金额必须大于零');
      if (action.direction === 'deposit') {
        requireRule(g.phase !== 'debt' && p.cash >= action.amount, '现金不足或正在偿债');
        p.cash -= action.amount;
        p.deposit += action.amount;
      } else {
        requireRule(p.deposit >= action.amount, '存款不足');
        p.deposit -= action.amount;
        p.cash += action.amount;
      }
      log(
        g,
        env,
        'bank',
        `${p.name}${action.direction === 'deposit' ? '存入' : '取出'} ${action.amount}`,
        p.id,
      );
      settleDebt(g, env);
      break;
    }
    case 'buyCard': {
      manageAllowed(g, p);
      requireRule(tileAt(g, p.position).kind === 'shop', '请在卡牌商店购买');
      const card = cardById(action.cardId);
      requireRule(card && p.cash >= card.price && p.cards.length < 8, '现金不足或手牌已满');
      p.cash -= card.price;
      p.cards.push(card.id);
      log(g, env, 'card', `${p.name}在商店购买一张卡牌`, p.id);
      break;
    }
    case 'ability': {
      manageAllowed(g, p);
      requireRule(g.round - p.abilityRound >= 3, '天赋每 3 轮只能使用一次');
      p.abilityRound = g.round;
      if (p.characterId === 'builder') reward(g, p, 180, env, '建设补助');
      if (p.characterId === 'landlord') reward(g, p, 150, env, '商业分红');
      if (p.characterId === 'runner') {
        p.shield++;
        reward(g, p, 80, env, '旅行奖励');
      }
      if (p.characterId === 'guardian') p.shield += 2;
      if (p.characterId === 'dealer') {
        requireRule(p.cards.length < 8, '手牌已满');
        drawCard(g, p, env);
      }
      if (p.characterId === 'explorer') {
        p.skipTurns = 0;
        if (p.jailTurns > 0) releaseFromJail(g, p, env, '凭探险家天赋');
        reward(g, p, 120, env, '探险奖励');
      }
      log(g, env, 'ability', `${p.name}使用角色天赋`, p.id);
      break;
    }
    case 'playCard':
      cardAction(g, p, action, env);
      break;
    case 'tradeOffer': {
      manageAllowed(g, p);
      requireRule(!g.trade, '已有交易等待处理');
      const target = playerById(g, action.to);
      requireRule(
        target &&
          target.id !== p.id &&
          !target.bankrupt &&
          p.cash >= action.giveCash &&
          target.cash >= action.wantCash,
        '交易对象或资金无效',
      );
      requireRule(
        action.giveCash + action.wantCash > 0 ||
          action.giveTile !== null ||
          action.wantTile !== null,
        '请填写交易内容',
      );
      if (action.giveTile !== null) {
        const prop = ownProperty(g, p, action.giveTile);
        requireRule(prop.level === 0 && !prop.mortgaged, '仅可交易没有建筑、未抵押的地产');
      }
      if (action.wantTile !== null) {
        const prop = ownProperty(g, target, action.wantTile);
        requireRule(prop.level === 0 && !prop.mortgaged, '仅可交易没有建筑、未抵押的地产');
      }
      g.trade = {
        id: `${g.id}-${g.revision}`,
        from: p.id,
        to: target.id,
        giveCash: action.giveCash,
        wantCash: action.wantCash,
        giveTile: action.giveTile,
        wantTile: action.wantTile,
        expiresAt: env.now + 30000,
      };
      log(g, env, 'trade', `${p.name}向${target.name}发起交易，30 秒内有效。`, p.id);
      break;
    }
    case 'tradeAccept':
    case 'tradeReject': {
      const offer = g.trade;
      requireRule(
        offer &&
          (offer.to === p.id || (action.type === 'tradeReject' && offer.from === p.id)) &&
          MANAGE_PHASES.includes(g.phase),
        '交易已结束或不属于你',
      );
      if (action.type === 'tradeAccept') {
        const from = playerById(g, offer.from)!;
        requireRule(
          !from.bankrupt && from.cash >= offer.giveCash && p.cash >= offer.wantCash,
          '交易资金已发生变化',
        );
        if (offer.giveTile !== null) {
          const prop = ownProperty(g, from, offer.giveTile);
          requireRule(prop.level === 0 && !prop.mortgaged, '地产状态已变化');
        }
        if (offer.wantTile !== null) {
          const prop = ownProperty(g, p, offer.wantTile);
          requireRule(prop.level === 0 && !prop.mortgaged, '地产状态已变化');
        }
        from.cash += offer.wantCash - offer.giveCash;
        p.cash += offer.giveCash - offer.wantCash;
        if (offer.giveTile !== null) propertyAt(g, offer.giveTile)!.owner = p.id;
        if (offer.wantTile !== null) propertyAt(g, offer.wantTile)!.owner = from.id;
        log(g, env, 'trade', `${p.name}与${from.name}完成交易，资产同时结算`, p.id);
      } else log(g, env, 'trade', `${p.name}结束了交易提案`, p.id);
      g.trade = null;
      break;
    }
  }
  checkWinner(g, env);
  g.revision++;
  assertInvariants(g);
  return g;
}

/** Whether the match must end now: one side left, or the clock ran out. No mutation. */
function winnerDue(g: GameState, env: EngineEnvironment) {
  if (env.now >= g.endsAt) return true;
  const alive = g.players.filter((p) => !p.bankrupt);
  return g.settings.mode === 'team'
    ? new Set(alive.map((p) => p.team)).size <= 1
    : alive.length <= 1;
}
export function tickGame(state: GameState, env: EngineEnvironment): GameState | null {
  if (state.phase === 'finished') return null;
  // Most ticks change nothing; decide before paying for a deep copy.
  if (!(state.trade && env.now >= state.trade.expiresAt) && !winnerDue(state, env)) return null;
  const g = structuredClone(state);
  let changed = false;
  if (g.trade && env.now >= g.trade.expiresAt) {
    g.trade = null;
    changed = true;
    log(g, env, 'trade', '交易提案已超时撤回。');
  }
  if (checkWinner(g, env)) changed = true;
  if (!changed) return null;
  g.revision++;
  return g;
}
export function actingPlayerId(g: GameState): string | null {
  if (g.phase === 'finished') return null;
  if (g.phase === 'auction' && g.auction) return g.auction.bidderIds[g.auction.bidderIndex];
  return currentPlayer(g).id;
}
export function assertInvariants(g: GameState) {
  requireRule(
    g.players.every(
      (p) =>
        Number.isSafeInteger(p.cash) &&
        p.cash >= 0 &&
        Number.isSafeInteger(p.deposit) &&
        p.deposit >= 0 &&
        p.position >= 0 &&
        p.position < mapById(g.settings.mapId).tiles.length &&
        (p.jailTurns === 0 || p.jailTurns === 1) &&
        p.cards.length <= 8,
    ),
    '资产或玩家状态不满足约束',
  );
  requireRule(new Set(g.players.map((p) => p.id)).size === g.players.length, '玩家 ID 必须唯一');
  requireRule(
    new Set(g.properties.map((p) => p.tile)).size === g.properties.length,
    '地产必须唯一',
  );
  requireRule(
    g.properties.every(
      (p) =>
        Number.isInteger(p.level) &&
        p.level >= 0 &&
        p.level <= 3 &&
        (!p.owner || g.players.some((x) => x.id === p.owner && !x.bankrupt)) &&
        (!p.mortgaged || p.level === 0),
    ),
    '地产状态不满足约束',
  );
  requireRule(g.phase !== 'path' || !!g.pendingPath, '岔路决策缺失');
  requireRule(g.phase !== 'auction' || !!g.auction, '拍卖决策缺失');
  requireRule(g.phase !== 'debt' || !!g.debt, '偿债决策缺失');
  requireRule(Number.isSafeInteger(g.pot) && g.pot >= 0, '奖池金额无效');
  requireRule(g.phase !== 'jail' || currentPlayer(g).jailTurns > 0, '拘留决策缺失');
}

export function actionsFor(g: GameState, id: string): ActionOption[] {
  const p = playerById(g, id);
  if (!p || p.bankrupt || g.phase === 'finished') return [];
  const options: ActionOption[] = [];
  const add = (action: GameAction, label: string, hint: string, primary = false) =>
    options.push({ action, label, hint, primary });
  if (g.trade?.to === id && MANAGE_PHASES.includes(g.phase)) {
    add({ type: 'tradeAccept' }, '接受交易', '现金与地产将同时交换');
    add({ type: 'tradeReject' }, '拒绝交易', '不改变资产');
  }
  if (g.trade?.from === id) add({ type: 'tradeReject' }, '撤回交易', '取消等待中的提案');
  if (g.trade || actingPlayerId(g) !== id) return options;
  if (g.phase === 'auction') {
    const minimum = g.auction!.highBid + 10;
    if (p.cash >= minimum)
      add(
        { type: 'bid', amount: minimum },
        `出价 ${minimum}`,
        `目前最高 ${g.auction!.highBid}；可以修改金额`,
        true,
      );
    add({ type: 'auctionPass' }, '退出竞拍', '本次拍卖不再出价');
    return options;
  }
  if (g.phase === 'path') {
    for (const tile of g.pendingPath!.choices)
      add(
        { type: 'choosePath', tile },
        `前往${tileAt(g, tile).name}`,
        `剩余 ${g.pendingPath!.remaining} 步`,
        true,
      );
    return options;
  }
  if (g.phase === 'purchase') {
    const tile = tileAt(g, p.position);
    if (p.cash >= tile.price)
      add(
        { type: 'buy' },
        `购买 · ${tile.price}`,
        `基础租金 ${tile.rent}，标准建设费 ${tile.buildCost}`,
        true,
      );
    add({ type: 'pass' }, '进入拍卖', '让所有玩家公开竞价');
    return options;
  }
  if (g.phase === 'roll') add({ type: 'roll' }, '掷骰出发', '可先使用卡牌或角色天赋', true);
  if (g.phase === 'jail') {
    add(
      { type: 'jailRoll' },
      `掷骰出狱`,
      `掷出 ${BOARD.jailEscapeFace} 点立即出狱并前进；否则本回合留下，下回合自由`,
      true,
    );
    if (p.cash >= BOARD.bail)
      add({ type: 'bail' }, `缴纳保释金 · ${BOARD.bail}`, '出狱后正常掷骰；保释金进入停车场奖池');
  }
  if (g.phase === 'manage' && ferryTarget(g, p.position) !== undefined && p.cash >= FERRY_FARE)
    add({ type: 'ferry' }, `轮渡捷径 · ${FERRY_FARE}`, '抵达另一座码头后再次掷骰');
  if (g.phase === 'manage') add({ type: 'end' }, '结束回合', '可先建设、交易或使用卡牌', true);
  for (const prop of g.properties.filter((x) => x.owner === id)) {
    const tile = tileAt(g, prop.tile);
    if (!prop.mortgaged && prop.level < 3 && g.phase !== 'debt' && p.cash >= buildCost(g, p, prop))
      add(
        { type: 'build', tile: prop.tile },
        `升级${tile.name}`,
        `费用 ${buildCost(g, p, prop)}，升至 ${prop.level + 1} 级`,
      );
    if (prop.level > 0)
      add(
        { type: 'downgrade', tile: prop.tile },
        `出售${tile.name}建筑`,
        `返还 ${Math.floor(tile.buildCost / 2)}`,
      );
    if (prop.level === 0 && !prop.mortgaged)
      add(
        { type: 'mortgage', tile: prop.tile },
        `抵押${tile.name}`,
        `获得 ${Math.floor(tile.price / 2)}，停止收租`,
      );
    if (prop.mortgaged && g.phase !== 'debt' && p.cash >= Math.ceil(tile.price * 0.55))
      add(
        { type: 'redeem', tile: prop.tile },
        `赎回${tile.name}`,
        `费用 ${Math.ceil(tile.price * 0.55)}`,
      );
  }
  if (tileAt(g, p.position).kind === 'bank' || g.phase === 'debt') {
    if (p.deposit > 0)
      add(
        { type: 'bank', direction: 'withdraw', amount: p.deposit },
        '取出全部存款',
        `${p.deposit} 可用于现金支付`,
      );
    if (g.phase !== 'debt' && p.cash >= 300)
      add({ type: 'bank', direction: 'deposit', amount: 300 }, '存入 300', '每轮银行利息 3%');
  }
  if (g.phase === 'debt') {
    add({ type: 'surrender' }, '宣布破产', '退出经营，仍可继续观战');
    return options;
  }
  if (g.round - p.abilityRound >= 3 && (p.characterId !== 'dealer' || p.cards.length < 8))
    add({ type: 'ability' }, '使用角色天赋', characterById(p.characterId).ability);
  return options;
}
/** Recent events sent to clients; the authoritative log keeps more for persistence. */
export const VIEW_EVENTS = 48;
const QUIET_EVENTS = new Set(['turn', 'start', 'move', 'ai']);
export function viewFor(g: GameState, viewerId: string | null): GameView {
  // Views are serialized immediately. Copy only the small mutable parts instead of the whole
  // state; event objects are append-only and safe to share.
  const { players, traps, properties, events, ...rest } = g;
  const publicState = structuredClone(rest);
  const viewer = playerById(g, viewerId ?? '');
  const lastAction = new Map<string, string>();
  for (let i = events.length - 1; i >= 0 && lastAction.size < players.length; i--) {
    const e = events[i];
    if (e.actor && !QUIET_EVENTS.has(e.kind) && !lastAction.has(e.actor))
      lastAction.set(e.actor, e.text);
  }
  return {
    ...publicState,
    events: events.slice(-VIEW_EVENTS),
    viewerId,
    activeId: actingPlayerId(g),
    actions: viewerId ? actionsFor(g, viewerId) : [],
    properties: properties.map((property) => {
      const owner = property.owner ? playerById(g, property.owner) : undefined;
      return {
        ...property,
        rent: rentOf(g, property),
        payableRent:
          owner &&
          viewer &&
          (owner.id === viewer.id ||
            (g.settings.mode === 'team' && owner.team === viewer.team) ||
            viewer.shield > 0)
            ? 0
            : rentOf(g, property, viewer),
        upgradeCost:
          owner || viewer
            ? buildCost(g, owner ?? viewer!, property)
            : tileAt(g, property.tile).buildCost,
      };
    }),
    players: players.map((p) => {
      const { cards, nextDice, ...pub } = p;
      const assets = assetsOf(g, p),
        debt = g.debt?.playerId === p.id ? g.debt.amount : 0;
      const owned = properties.filter((x) => x.owner === p.id);
      return {
        ...pub,
        cardCount: cards.length,
        ...(p.id === viewerId ? { cards: [...cards], nextDice } : {}),
        assets,
        propertyValue: assets - p.cash - p.deposit + debt,
        propertyCount: owned.length,
        buildingCount: owned.reduce((n, x) => n + x.level, 0),
        debt,
        lastAction: lastAction.get(p.id) ?? null,
      };
    }),
    traps: Object.fromEntries(
      Object.entries(traps)
        .filter(([, t]) => t.until >= g.round)
        .map(([index, t]) => [index, { until: t.until, amount: t.amount }]),
    ),
  };
}
