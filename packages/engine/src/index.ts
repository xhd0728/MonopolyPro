import {
  BOARD,
  CHANCE_CARDS,
  FATE_CARDS,
  cardById,
  randomCard,
  characterById,
  deckCardById,
  mapById,
  NEWS,
  newsById,
} from '../../content/src/index.ts';
import type {
  PlayerStats,
  ActionOption,
  DeckCardDefinition,
  DeckId,
  GameEvent,
  GameAction,
  GameState,
  GameView,
  PlayerState,
  PropertyState,
  RoomSettings,
  Seat,
  TileDefinition,
} from '../../shared/src/index.ts';
import { HARD_CAP_MINUTES } from '../../shared/src/index.ts';

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
/** The map in play, at the room's chosen board size. */
export const mapOf = (g: Pick<GameState, 'settings'>) => mapById(g.settings.mapId, g.settings.size);
const tileAt = (g: GameState, tile: number) => mapOf(g).tiles[tile];
const playerById = (g: GameState, id: string) => g.players.find((p) => p.id === id);
const enemy = (g: GameState, a: PlayerState, b: PlayerState) =>
  a.id !== b.id && (g.settings.mode !== 'team' || a.team !== b.team);
/** Opponents: everyone else in free play, the other team in team play. */
export const isEnemy = enemy;
export function log(
  g: GameState,
  env: EngineEnvironment,
  kind: string,
  text: string,
  actor?: string,
  amount?: number,
  path?: number[],
  meta?: Pick<GameEvent, 'spot' | 'tile' | 'card' | 'detail'>,
) {
  g.events.push({
    id: g.nextEvent++,
    at: env.now,
    kind,
    text,
    ...(actor !== undefined ? { actor } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(path !== undefined ? { path } : {}),
    ...meta,
  });
  if (g.events.length > 120) g.events.splice(0, g.events.length - 120);
}
export const handSize = (p: Pick<PlayerState, 'cards' | 'newCards'>) =>
  p.cards.length + (p.newCards?.length ?? 0);
export const handFull = (p: Pick<PlayerState, 'cards' | 'newCards'>) =>
  handSize(p) >= BOARD.handLimit;
/**
 * Give a random card. Cards gained during a turn wait in `newCards` until the player's next
 * turn, so a card can never be bought and played in the same turn; the opening hand is ready.
 */
function drawCard(g: GameState, p: PlayerState, env: EngineEnvironment, ready = false) {
  if (handFull(p)) return;
  const card = randomCard(env.randomInt);
  (ready ? p.cards : p.newCards).push(card.id);
  log(g, env, 'card', `${p.name}获得一张卡牌${ready ? '' : '（下回合可用）'}`, p.id);
}
/** Rent shields never stack. Returns false (and grants nothing) when one is already held. */
function grantShield(g: GameState, p: PlayerState, env: EngineEnvironment, source: string) {
  if (p.shield >= BOARD.shieldCap) return false;
  p.shield++;
  log(g, env, 'shield', `${p.name}通过「${source}」获得 1 次租金护盾`, p.id);
  return true;
}
/** Unlock last turn's cards and reset the per-turn card limits. */
function beginTurn(p: PlayerState) {
  p.cards.push(...p.newCards);
  p.newCards = [];
  p.cardPlayed = false;
  p.shopped = false;
  p.heldInJail = false;
}
const drawPriceOf = (p: PlayerState) =>
  p.characterId === 'dealer' ? BOARD.dealerDraw : BOARD.cardDraw;
export function assetsOf(g: GameState, p: PlayerState): number {
  const propertyValue = g.properties
    .filter((x) => x.owner === p.id)
    .reduce((sum, x) => {
      const tile = tileAt(g, x.tile);
      // Land counts at its price (a mortgaged lot only at its equity after redemption) and
      // buildings at three quarters of their cost, so buying land is not a net-worth loss.
      return (
        sum +
        (x.mortgaged ? tile.price - Math.ceil(tile.price * 0.55) : tile.price) +
        Math.floor((x.level * tile.buildCost * 3) / 4)
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
  if (g.finale) rent *= 1.5;
  const news = newsNow(g);
  if (news && g.news!.group === tile.group) {
    if (news.effect === 'groupBoom') rent *= 1.5;
    if (news.effect === 'groupSlump') rent *= 0.6;
  }
  return Math.max(0, Math.round(rent));
}
export function buildCost(g: GameState, p: PlayerState, property: PropertyState): number {
  return Math.round(
    tileAt(g, property.tile).buildCost *
      (p.characterId === 'builder' ? 0.85 : 1) *
      (p.discount ? 0.5 : 1) *
      (newsNow(g)?.effect === 'buildSale' ? 0.7 : 1),
  );
}
/** This round's world news, if any. */
export function newsNow(g: Pick<GameState, 'news' | 'round'>) {
  return g.news && g.news.round === g.round ? newsById(g.news.id) : undefined;
}
export const salaryOf = (g: GameState) =>
  mapOf(g).salary * (newsNow(g)?.effect === 'doubleSalary' ? 2 : 1);
export const bailOf = (g: GameState) =>
  BOARD.bail * (newsNow(g)?.effect === 'strictCustoms' ? 2 : 1);
/** Price of unowned land this round (land rush / land sale news). */
export function landPrice(g: GameState, tile: number) {
  const effect = newsNow(g)?.effect;
  return Math.round(
    tileAt(g, tile).price * (effect === 'landRush' ? 1.2 : effect === 'landSale' ? 0.8 : 1),
  );
}
const interestRate = (g: GameState) => {
  const effect = newsNow(g)?.effect;
  return effect === 'rateCut'
    ? 0
    : effect === 'rateHike'
      ? newsNow(g)!.amount / 100
      : BOARD.interest;
};
function groupNames(g: GameState, group: number) {
  return mapOf(g)
    .tiles.filter((t) => t.kind === 'property' && t.group === group)
    .map((t) => t.name)
    .join('、');
}
function flipNews(g: GameState, env: EngineEnvironment) {
  const choices = NEWS.filter((n) => n.id !== g.news?.id);
  const news = choices[env.randomInt(choices.length)];
  const group = ['groupBoom', 'groupSlump'].includes(news.effect) ? env.randomInt(8) : undefined;
  g.news = { id: news.id, round: g.round, ...(group !== undefined ? { group } : {}) };
  const detail =
    group !== undefined
      ? `${groupNames(g, group)}本轮租金${news.effect === 'groupBoom' ? ' +50%' : ' −40%'}`
      : news.text;
  log(
    g,
    env,
    'news',
    `第 ${g.round} 轮世界新闻「${news.name}」：${detail}`,
    undefined,
    undefined,
    undefined,
    {
      spot: 'news',
    },
  );
  const alive = g.players.filter((p) => !p.bankrupt);
  if (news.effect === 'festival') for (const p of alive) reward(g, p, news.amount, env, news.name);
  if (news.effect === 'wealthTax' && alive.length > 1) {
    const rich = alive.reduce((a, b) => (assetsOf(g, b) > assetsOf(g, a) ? b : a));
    const average = alive.reduce((n, x) => n + assetsOf(g, x), 0) / alive.length;
    // Only a clear leader pays: at least 20% above the table's average net worth.
    const tax =
      assetsOf(g, rich) >= average * 1.2
        ? Math.min(300, Math.round(((rich.cash + rich.deposit) * news.amount) / 100))
        : 0;
    if (!tax)
      log(
        g,
        env,
        'news',
        assetsOf(g, rich) >= average * 1.2
          ? `${rich.name}没有现金和存款，本轮富豪税为 0`
          : '暂无明显领先的富豪，本轮无人缴纳富豪税',
      );
    else {
      // Cash first, then savings: parking money in the bank no longer dodges the tax.
      const fromCash = Math.min(rich.cash, tax);
      rich.cash -= fromCash;
      rich.deposit -= tax - fromCash;
      g.pot += tax;
      log(g, env, 'payment', `${rich.name}缴纳富豪税 −${tax}，进入停车场奖池`, rich.id, -tax);
    }
  }
}
export const emptyStats = (): PlayerStats => ({
  rentIn: 0,
  rentOut: 0,
  biggestRent: 0,
  bought: 0,
  built: 0,
  laps: 0,
  jailed: 0,
  cards: 0,
  trades: 0,
});
function shuffle<T>(items: T[], env: EngineEnvironment): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = env.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
/**
 * Bring a stored version-2/3 game up to the current shape. Idempotent: fields added later in
 * version 3 (decks, news, guesses, prophet counts) get neutral defaults.
 */
export function migrateGame(state: GameState, randomInt?: (max: number) => number): GameState {
  const g = state as GameState & Partial<Pick<GameState, 'decks' | 'news' | 'guesses'>>;
  g.version = 3;
  g.pot ??= 0;
  const env = { now: 0, randomInt: randomInt ?? (() => 0) };
  g.decks ??= {
    chance: shuffle(
      CHANCE_CARDS.map((c) => c.id),
      env,
    ),
    fate: shuffle(
      FATE_CARDS.map((c) => c.id),
      env,
    ),
  };
  g.news ??= null;
  g.guesses ??= {};
  (g as Partial<GameState>).tradeMemo ??= {};
  (g as Partial<GameState>).finale ??= false;
  // Games saved before end conditions existed ended on the clock.
  g.settings = Object.assign(
    {
      turnSeconds: 0,
      end: 'time' as const,
      rounds: 12,
      target: 15000,
      size: 36 as const,
      // Games saved before this option used the old auction rule.
      auction: true,
    },
    g.settings,
  );
  // Offers saved before multi-square trades carried one square per side.
  if (g.trade) {
    const old = g.trade as unknown as { giveTile?: number | null; wantTile?: number | null };
    g.trade.giveTiles ??= old.giveTile != null ? [old.giveTile] : [];
    g.trade.wantTiles ??= old.wantTile != null ? [old.wantTile] : [];
  }
  for (const p of g.players) {
    (p as Partial<PlayerState>).prophet ??= 0;
    p.newCards ??= [];
    p.cardPlayed ??= false;
    p.shopped ??= false;
    // Older saves allowed eight cards and stacked shields; trim to the current limits.
    if (p.cards.length > BOARD.handLimit) p.cards.length = BOARD.handLimit;
    p.shield = Math.min(p.shield, BOARD.shieldCap);
    p.stats = { ...emptyStats(), ...p.stats };
  }
  return g as GameState;
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
          newCards: [],
          cardPlayed: false,
          shopped: false,
          bankrupt: false,
          shield: 0,
          taxShield: 0,
          skipTurns: 0,
          jailTurns: 0,
          prophet: 0,
          stats: emptyStats(),
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
    version: 3,
    id,
    revision: 0,
    settings,
    players,
    properties: mapById(settings.mapId, settings.size)
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
    endsAt:
      env.now + ((settings.end ?? 'time') === 'time' ? settings.minutes : HARD_CAP_MINUTES) * 60000,
    decisionAt: env.now,
    pendingPath: null,
    auction: null,
    debt: null,
    trade: null,
    traps: {},
    pot: 0,
    decks: {
      chance: shuffle(
        CHANCE_CARDS.map((c) => c.id),
        env,
      ),
      fate: shuffle(
        FATE_CARDS.map((c) => c.id),
        env,
      ),
    },
    news: null,
    guesses: {},
    tradeMemo: {},
    finale: false,
    events: [],
    nextEvent: 1,
    lastDice: [],
    winners: [],
    finishReason: '',
  };
  for (const p of players)
    for (let i = 0; i < (p.characterId === 'dealer' ? 3 : 2); i++) drawCard(g, p, env, true);
  // Moving first is worth real money (first pick of the land); later seats start a little richer.
  players.forEach((p, i) => {
    if (i) p.cash += i * BOARD.seatBonus;
  });
  if (players.length > 1)
    log(g, env, 'money', `后手补偿：从第 2 位起，每靠后一位多 ${BOARD.seatBonus} 起始现金`);
  log(g, env, 'start', '富翁之旅开始了！先使用卡牌或天赋，再掷骰出发。');
  // Everyone starts level, so the first round is calm; world news begins in round two.
  g.news = { id: 'calm', round: 1 };
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
  meta?: Pick<GameEvent, 'spot' | 'tile' | 'card'>,
  /** Several creditors share the amount equally (e.g. paying every rival). */
  split?: string[],
) {
  if (p.cash >= amount) {
    p.cash -= amount;
    if (split?.length) {
      const share = Math.floor(amount / split.length);
      split.forEach((id, n) => {
        const to = playerById(g, id)!;
        // Bankrupt creditors' shares go to the pot; any rounding remainder to the first.
        const part = share + (n === 0 ? amount - share * split.length : 0);
        if (to.bankrupt) g.pot += part;
        else to.cash += part;
      });
    } else if (creditorId && !playerById(g, creditorId)!.bankrupt)
      playerById(g, creditorId)!.cash += amount;
    else g.pot += amount;
    if (meta?.spot === 'rent' && creditorId && !playerById(g, creditorId)!.bankrupt) {
      const owner = playerById(g, creditorId)!;
      p.stats.rentOut += amount;
      owner.stats.rentIn += amount;
      owner.stats.biggestRent = Math.max(owner.stats.biggestRent, amount);
    }
    log(g, env, 'payment', `${p.name}：${reason} −${amount}`, p.id, -amount, undefined, meta);
  } else {
    g.debt = {
      playerId: p.id,
      amount,
      creditorId,
      reason,
      ...(split ? { split } : {}),
      ...(meta?.spot === 'rent' ? { rent: true } : {}),
    };
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
  charge(
    g,
    p,
    d.amount,
    d.creditorId,
    env,
    d.reason,
    d.rent ? { spot: 'rent' } : undefined,
    d.split,
  );
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
    finish(
      g,
      g.settings.end === 'time' ? '比赛时间结束，按净资产结算' : '达到最长时长，按净资产结算',
      env,
    );
    return true;
  }
  if (g.settings.end === 'rounds' && g.round > g.settings.rounds) {
    finish(g, `完成全部 ${g.settings.rounds} 轮，按净资产结算`, env);
    return true;
  }
  if (g.settings.end === 'target' && targetReached(g)) {
    finish(g, `${targetReached(g)}率先达到目标净资产 ${g.settings.target}`, env);
    return true;
  }
  return false;
}
/** Name of the player (or team) whose net worth reached the target, if any. */
/**
 * Best progress toward the target: each player's net worth, or in team games each team's
 * average per member (so team size never decides the race).
 */
function targetStandings(g: GameState): { name: string; worth: number }[] {
  const alive = g.players.filter((p) => !p.bankrupt);
  if (g.settings.mode === 'team')
    return [0, 1].flatMap((team) => {
      // Average over the whole roster with bankrupt members at 0, so surrendering a seat
      // never raises a team's score (and the ranking matches the final sum).
      const roster = g.players.filter((p) => p.team === team);
      return alive.some((p) => p.team === team)
        ? [
            {
              name: team === 0 ? '青队' : '橙队',
              worth:
                roster.reduce((n, p) => n + (p.bankrupt ? 0 : assetsOf(g, p)), 0) / roster.length,
            },
          ]
        : [];
    });
  return alive.map((p) => ({ name: p.name, worth: assetsOf(g, p) }));
}
/** Name of the leading player (or team) once they reached the target, if any. */
function targetReached(g: GameState): string | null {
  const best = targetStandings(g).sort((a, b) => b.worth - a.worth)[0];
  return best && best.worth >= g.settings.target ? best.name : null;
}
/** Whether the match is in its last stretch: final two rounds, last five minutes, or 80% of the target. */
export function finaleDue(g: GameState, now: number): boolean {
  if (g.settings.end === 'rounds') return g.round >= g.settings.rounds - 1;
  if (g.settings.end === 'target')
    return Math.max(...targetStandings(g).map((x) => x.worth)) >= g.settings.target * 0.8;
  return g.endsAt - now <= 5 * 60000;
}
function updateFinale(g: GameState, env: EngineEnvironment) {
  if (g.finale || g.phase === 'finished' || !finaleDue(g, env.now)) return false;
  g.finale = true;
  log(
    g,
    env,
    'news',
    '终局冲刺！比赛进入最后阶段：所有租金 ×1.5，抓紧最后的机会',
    undefined,
    undefined,
    undefined,
    {
      spot: 'news',
    },
  );
  return true;
}
function resolveGuesses(g: GameState, die: number, env: EngineEnvironment) {
  const result = die >= 4 ? 'high' : 'low';
  const right = g.players.filter((x) => !x.bankrupt && g.guesses[x.id] === result);
  g.guesses = {};
  if (!right.length) return;
  for (const x of right) {
    x.prophet++;
    if (x.prophet <= BOARD.guessCap) {
      x.cash += BOARD.guessReward;
      log(g, env, 'money', `${x.name}猜中点数 +${BOARD.guessReward}`, x.id, BOARD.guessReward);
    }
  }
  log(
    g,
    env,
    'guess',
    `猜「${result === 'high' ? '大' : '小'}」猜中了：${right.map((x) => x.name).join('、')}`,
    undefined,
    undefined,
    undefined,
    { spot: 'guess' },
  );
}
function advanceTurn(g: GameState, env: EngineEnvironment) {
  g.guesses = {};
  if (checkWinner(g, env)) return;
  g.trade = null;
  g.debt = null;
  g.auction = null;
  g.pendingPath = null;
  for (let i = 0; i < g.players.length * 2; i++) {
    g.turn = (g.turn + 1) % g.players.length;
    if (g.turn === 0) {
      // Interest uses the news of the round that just ended.
      const rate = interestRate(g);
      g.round++;
      if (checkWinner(g, env)) return;
      updateFinale(g, env);
      for (const p of g.players.filter((p) => !p.bankrupt && p.deposit > 0))
        if (Math.floor(p.deposit * rate) > 0)
          reward(g, p, Math.floor(p.deposit * rate), env, '银行利息');
      const map = mapOf(g);
      if (map.mechanic === 'gates')
        log(
          g,
          env,
          'map',
          g.round % 2 === 0 ? '丝路商路开放，可选择跨洲快线。' : '丝路商路关闭，沿常规环线前进。',
        );
      flipNews(g, env);
      // Travel stipend every four rounds keeps cash flowing; players far behind get more.
      if (g.round % 4 === 0)
        for (const x of g.players.filter((x) => !x.bankrupt))
          reward(
            g,
            x,
            isBehind(g, x) ? 140 : 60,
            env,
            isBehind(g, x) ? '环球补助（追赶加倍）' : '环球补助',
          );
    }
    const p = currentPlayer(g);
    if (p.bankrupt) continue;
    beginTurn(p);
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
        `轮到${p.name}，仍在${tileAt(g, mapOf(g).corners.jail).name}：缴纳 ${bailOf(g)} 保释金、使用「自由通行」或掷出 ${BOARD.jailEscapeFace} 点出狱`,
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
  const map = mapOf(g);
  if (map.mechanic === 'gates' && gatesOpen(g)) {
    const gate = map.shortcuts.find(([from]) => from === index);
    if (gate) return [(index + 1) % map.tiles.length, gate[1]];
  }
  return map.tiles[index].exits;
}
/** Partner port for the ferry map, or undefined when the tile is not a port. */
export function ferryTarget(g: GameState, index: number): number | undefined {
  const map = mapOf(g);
  if (map.tiles[index]?.kind !== 'transit') return undefined;
  const pair = map.shortcuts.find((link) => link.includes(index));
  return pair && (pair[0] === index ? pair[1] : pair[0]);
}
const FERRY_FARE = 80;
function sendToJail(g: GameState, p: PlayerState, env: EngineEnvironment, reason: string) {
  p.position = mapOf(g).corners.jail;
  p.jailTurns = 1;
  p.stats.jailed++;
  p.nextDice = null;
  g.pendingPath = null;
  setPhase(g, 'manage', env);
  log(
    g,
    env,
    'jail',
    `${p.name}${reason}，直接前往${tileAt(g, mapOf(g).corners.jail).name}，不经过起点`,
    p.id,
    undefined,
    [mapOf(g).corners.jail],
    { spot: 'jail', tile: mapOf(g).corners.jail },
  );
}
function releaseFromJail(g: GameState, p: PlayerState, env: EngineEnvironment, how: string) {
  p.jailTurns = 0;
  if (g.phase === 'jail') setPhase(g, 'roll', env);
  log(
    g,
    env,
    'jail',
    `${p.name}${how}，离开${tileAt(g, mapOf(g).corners.jail).name}`,
    p.id,
    undefined,
    undefined,
    {
      spot: 'release',
      tile: mapOf(g).corners.jail,
    },
  );
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
    // The fee never exceeds the cash in hand, so it cannot open a debt that would cancel the
    // rest of the landing (the purchase offer or the rent on this square).
    const fee = Math.min(trap.amount, p.cash);
    if (fee > 0) charge(g, p, fee, trap.owner, env, '道路施工');
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
      } else
        charge(g, p, rentOf(g, property, p), owner.id, env, `向${owner.name}支付租金`, {
          spot: 'rent',
          tile: p.position,
        });
    }
    return;
  }
  if (tile.kind === 'chance' || tile.kind === 'fate') drawDeck(g, p, tile.kind, env);
  else if (tile.kind === 'tax') {
    if (newsNow(g)?.effect === 'taxHoliday')
      log(g, env, 'shield', `${p.name}赶上税务假期，本次免税`, p.id);
    else if (p.taxShield > 0) {
      p.taxShield--;
      log(g, env, 'shield', `${p.name}使用税务减免`, p.id);
    } else charge(g, p, taxFor(g, p), null, env, '公共税费');
  } else if (tile.kind === 'gotojail') sendToJail(g, p, env, '在海关接受检查');
  else if (tile.kind === 'parking') {
    if (g.pot > 0) {
      const pot = g.pot;
      g.pot = 0;
      p.cash += pot;
      log(g, env, 'money', `${p.name}领走免费停车场奖池 +${pot}`, p.id, pot, undefined, {
        spot: 'pot',
        tile: p.position,
      });
    } else log(g, env, 'map', `${p.name}在免费停车场休息，奖池暂时为空`, p.id);
  } else if (tile.kind === 'jail') log(g, env, 'map', `${p.name}只是路过拘留所探访`, p.id);
  else if (tile.kind === 'transit')
    log(g, env, 'map', `港口已靠岸，可支付 ${FERRY_FARE} 乘船前往对岸港口。`, p.id);
}
/** Walk the ring square by square (ignoring forks) to a card's destination, then land. */
function walkTo(g: GameState, p: PlayerState, target: number, env: EngineEnvironment, why: string) {
  const size = mapOf(g).tiles.length;
  const path: number[] = [];
  for (let at = p.position; at !== target;) {
    at = (at + 1) % size;
    path.push(at);
    if (at === mapOf(g).corners.start) paySalary(g, p, env);
  }
  p.position = target;
  log(g, env, 'move', `${p.name}${why}，抵达${tileAt(g, target).name}`, p.id, undefined, path);
  land(g, env);
}
function walkBack(
  g: GameState,
  p: PlayerState,
  steps: number,
  env: EngineEnvironment,
  why: string,
) {
  const size = mapOf(g).tiles.length;
  const path = Array.from({ length: steps }, (_, n) => (p.position - n - 1 + size) % size);
  p.position = path.at(-1)!;
  log(
    g,
    env,
    'move',
    `${p.name}${why}，后退至${tileAt(g, p.position).name}`,
    p.id,
    undefined,
    path,
  );
  land(g, env);
}
const DECK_NAMES: Record<DeckId, string> = { chance: '机会', fate: '命运' };
/** Below 60% of the leader's net worth: eligible for the catch-up salary. */
export function isBehind(g: GameState, p: PlayerState): boolean {
  const alive = g.players.filter((x) => !x.bankrupt);
  if (alive.length < 2 || p.bankrupt) return false;
  return assetsOf(g, p) < Math.max(...alive.map((x) => assetsOf(g, x))) * 0.6;
}
/** Start salary, plus a visible +50% catch-up subsidy for players who are far behind. */
function paySalary(g: GameState, p: PlayerState, env: EngineEnvironment) {
  const behind = isBehind(g, p);
  p.stats.laps++;
  reward(g, p, salaryOf(g), env, '经过起点');
  if (behind) reward(g, p, Math.round(salaryOf(g) / 2), env, '追赶补贴（落后于领先者 40% 以上）');
}
/** Tax squares charge the round's base tax or 4% of net worth, whichever is higher. */
export const taxFor = (g: GameState, p: PlayerState) =>
  Math.max(120 + g.round * 5, Math.round(assetsOf(g, p) * 0.04));
/**
 * Catch-up: the poorest player who is clearly behind (under 70% of the leader's net worth,
 * with at least three players still in) gets visible help. Open to anyone who falls behind.
 */
export function isTrailing(g: GameState, p: PlayerState): boolean {
  const alive = g.players.filter((x) => !x.bankrupt);
  if (alive.length < 3 || p.bankrupt) return false;
  const worth = alive.map((x) => assetsOf(g, x));
  const mine = assetsOf(g, p);
  return mine === Math.min(...worth) && mine < Math.max(...worth) * 0.7;
}
function drawDeck(g: GameState, p: PlayerState, deck: DeckId, env: EngineEnvironment) {
  const order = g.decks[deck];
  let id = order.shift()!;
  if (isTrailing(g, p)) {
    // Best of two: turn over the next card as well and keep the better one.
    const other = order.shift()!;
    const keep = deckCardById(other)!.value > deckCardById(id)!.value ? other : id;
    const skip = keep === id ? other : id;
    log(
      g,
      env,
      'card',
      `${p.name}落后补偿：翻开「${deckCardById(id)!.name}」和「${deckCardById(other)!.name}」，保留更好的一张`,
      p.id,
    );
    order.push(skip);
    id = keep;
  }
  order.push(id);
  const card = deckCardById(id)!;
  log(
    g,
    env,
    'card',
    `${p.name}抽到${DECK_NAMES[deck]}卡「${card.name}」：${card.text}`,
    p.id,
    undefined,
    undefined,
    { spot: deck, card: card.id, tile: p.position },
  );
  // Lucky-day money arrives before the card so it can help pay what the card costs.
  if (newsNow(g)?.effect === 'luckyDraw') reward(g, p, 50, env, '幸运日抽卡奖励');
  applyDeckCard(g, p, card, env);
}
function applyDeckCard(
  g: GameState,
  p: PlayerState,
  card: DeckCardDefinition,
  env: EngineEnvironment,
) {
  const map = mapOf(g);
  const rivals = g.players.filter((x) => !x.bankrupt && enemy(g, p, x));
  switch (card.effect) {
    case 'gain':
      // The explorer's passive boosts cash rewards from chance and fate.
      reward(
        g,
        p,
        Math.round(card.amount * (p.characterId === 'explorer' ? 1.25 : 1)),
        env,
        card.name,
      );
      break;
    case 'pay':
      charge(g, p, card.amount, null, env, card.name);
      break;
    case 'advanceTo': {
      let target: number | undefined;
      if (card.target === 'start') target = mapOf(g).corners.start;
      else if (card.target === 'parking') target = mapOf(g).corners.parking;
      else if (card.target === 'priciest')
        target = map.tiles.reduce(
          (best, t) => (t.price > map.tiles[best].price ? t.index : best),
          0,
        );
      else if (card.target === 'nearestEmpty')
        for (let n = 1; n < map.tiles.length && target === undefined; n++) {
          const at = (p.position + n) % map.tiles.length;
          if (propertyAt(g, at) && !propertyAt(g, at)!.owner) target = at;
        }
      else if (typeof card.target === 'number') target = card.target;
      if (target === undefined) reward(g, p, card.amount, env, `${card.name}：已无空地`);
      else walkTo(g, p, target, env, `凭「${card.name}」`);
      break;
    }
    case 'move':
      if (card.amount > 0)
        walkTo(g, p, (p.position + card.amount) % map.tiles.length, env, `凭「${card.name}」`);
      else walkBack(g, p, -card.amount, env, `遇到${card.name}`);
      break;
    case 'jail':
      sendToJail(g, p, env, `抽到「${card.name}」`);
      break;
    case 'jailCard':
      if (!handFull(p)) {
        p.newCards.push('rescue');
        log(g, env, 'card', `${p.name}获得一张「自由通行」（下回合可用）`, p.id);
      } else reward(g, p, card.amount, env, `${card.name}（手牌已满）`);
      break;
    case 'repairs': {
      const levels = g.properties.filter((x) => x.owner === p.id).reduce((n, x) => n + x.level, 0);
      if (levels) charge(g, p, levels * card.amount, null, env, `${card.name}（${levels} 级建筑）`);
      else log(g, env, 'card', `${p.name}没有建筑，${card.name}无须付费`, p.id);
      break;
    }
    case 'payEach':
      // One payment shared by every rival, so a shortfall never skips the later rivals.
      if (rivals.length)
        charge(
          g,
          p,
          card.amount * rivals.length,
          null,
          env,
          `${card.name}：付给每位对手 ${card.amount}`,
          undefined,
          rivals.map((x) => x.id),
        );
      break;
    case 'collectEach': {
      let total = 0;
      for (const other of rivals) {
        const amount = Math.min(other.cash, card.amount);
        other.cash -= amount;
        total += amount;
      }
      p.cash += total;
      if (p.characterId === 'explorer' && total >= 4) {
        reward(g, p, Math.round(total * 0.25), env, '探险家加成');
      }
      log(g, env, 'money', `${p.name}：${card.name}，收到对手共 ${total}`, p.id, total);
      break;
    }
    case 'shield':
      if (!grantShield(g, p, env, card.name))
        reward(g, p, 80, env, `${card.name}（已有护盾，改发现金）`);
      if (card.amount)
        reward(
          g,
          p,
          Math.round(card.amount * (p.characterId === 'explorer' ? 1.25 : 1)),
          env,
          card.name,
        );
      break;
    case 'drawCard':
      if (!handFull(p)) drawCard(g, p, env);
      else reward(g, p, 80, env, `${card.name}（手牌已满）`);
      break;
    case 'upgradeRandom': {
      const lots = g.properties.filter((x) => x.owner === p.id && !x.mortgaged && x.level < 3);
      if (!lots.length) {
        reward(g, p, card.amount, env, `${card.name}（暂无可升级地产）`);
        break;
      }
      const lot = lots[env.randomInt(lots.length)];
      lot.level++;
      p.stats.built++;
      log(
        g,
        env,
        'build',
        `${p.name}的${tileAt(g, lot.tile).name}免费升至 ${lot.level} 级`,
        p.id,
        undefined,
        undefined,
        { spot: 'build', tile: lot.tile },
      );
      break;
    }
    case 'everyone':
      for (const x of g.players.filter((x) => !x.bankrupt))
        reward(g, x, card.amount, env, card.name);
      break;
    case 'robinHood': {
      const alive = g.players.filter((x) => !x.bankrupt);
      const rich = alive.reduce((a, b) => (b.cash > a.cash ? b : a));
      const poor = alive.reduce((a, b) => (b.cash < a.cash ? b : a));
      if (rich.id === poor.id || rich.cash === poor.cash) {
        log(g, env, 'card', `${card.name}：大家现金相同，无事发生`, p.id);
        break;
      }
      const amount = Math.min(rich.cash, card.amount);
      rich.cash -= amount;
      poor.cash += amount;
      log(
        g,
        env,
        'money',
        `${card.name}：${rich.name}向${poor.name}转赠 ${amount}`,
        poor.id,
        amount,
      );
      break;
    }
    case 'potHalf': {
      const half = Math.floor(g.pot / 2);
      g.pot -= half;
      p.cash += half;
      log(g, env, 'money', `${p.name}领取一半奖池 +${half}`, p.id, half, undefined, {
        spot: 'pot',
        tile: mapOf(g).corners.parking,
      });
      break;
    }
  }
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
    if (p.position === mapOf(g).corners.start) paySalary(g, p, env);
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
      p.stats.bought++;
      log(
        g,
        env,
        'auction',
        `${p.name}以 ${a.highBid} 竞得${tileAt(g, a.tile).name}`,
        p.id,
        -a.highBid,
        undefined,
        { spot: 'purchase', tile: a.tile },
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
    const heir = creditor && !creditor.bankrupt ? creditor : undefined;
    property.owner = heir ? heir.id : null;
    // A creditor takes mortgaged land as it is; land returned to the bank is free again.
    if (!heir) property.mortgaged = false;
    property.level = 0;
    property.boostUntil = 0;
    property.cutUntil = 0;
    property.protectedUntil = 0;
  }
  p.cash = 0;
  p.deposit = 0;
  p.cards = [];
  p.newCards = [];
  p.bankrupt = true;
  for (const [tile, trap] of Object.entries(g.traps))
    if (trap.owner === p.id) delete g.traps[Number(tile)];
  if (g.trade && [g.trade.from, g.trade.to].includes(p.id)) g.trade = null;
  log(g, env, 'bankrupt', `${p.name}结束经营，可继续观战`, p.id, undefined, undefined, {
    spot: 'bankrupt',
  });
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
  requireRule(
    card && p.cards.includes(card.id),
    card && p.newCards.includes(card.id) ? '这张卡本回合刚获得，下回合才能使用' : '没有这张卡牌',
  );
  requireRule(!p.cardPlayed, '每回合只能使用一张卡牌');
  requireRule(
    (p.jailTurns === 0 && !p.heldInJail) || card.category !== 'move',
    '拘留中不能使用移动类卡牌',
  );
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
      p.position = mapOf(g).corners.start;
      paySalary(g, p, env);
      // Like the move cards, a jump before rolling is this turn's movement.
      if (g.phase === 'roll') setPhase(g, 'manage', env);
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
      requireRule(target.jailTurns === 0, '对手正在拘留所，不能与其交换位置');
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
      p.stats.built++;
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
      const price = landPrice(g, property!.tile);
      requireRule(p.cash >= price, `需要 ${price} 现金`);
      p.cash -= price;
      property!.owner = p.id;
      p.stats.bought++;
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
      // The played card leaves the hand first, so a full hand still has room for the stolen one.
      requireRule(target.cards.length > 0, '对手没有可取走的卡牌');
      p.newCards.push(target.cards.splice(env.randomInt(target.cards.length), 1)[0]);
      break;
    case 'clearBoost':
      property!.boostUntil = 0;
      break;
    case 'rentCut':
      property!.cutUntil = g.round + card.amount - 1;
      break;
    case 'shield':
      requireRule(p.shield < BOARD.shieldCap, '已经持有护盾，护盾不能叠加');
      grantShield(g, p, env, card.name);
      break;
    case 'lottery':
      reward(g, p, [50, 100, 200, 400][env.randomInt(4)], env, card.name);
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
      grantShield(g, p, env, card.name);
      reward(g, p, card.amount, env, card.name);
      break;
    case 'taxShield':
      requireRule(p.taxShield < 1, '已经持有税务减免');
      p.taxShield = 1;
      break;
  }
  p.cardPlayed = true;
  p.cards.splice(p.cards.indexOf(card.id), 1);
  p.stats.cards++;
  log(
    g,
    env,
    'card',
    `${p.name}使用「${card.name}」${target.id !== p.id ? `，目标：${target.name}` : property ? `，目标：${tileAt(g, property.tile).name}` : ''}`,
    p.id,
    undefined,
    undefined,
    // Cards aimed at someone else are table-wide news; self cards stay in the ticker.
    target.id !== p.id || (property && property.owner !== p.id)
      ? { spot: 'card', card: card.id, ...(property ? { tile: property.tile } : {}) }
      : { card: card.id },
  );
}

export const TRADE_COOLDOWN_MS = 15000,
  TRADE_OFFER_MS = 60000,
  /** Offers between two players who are not on turn hold up the table for less time. */
  SIDE_TRADE_MS = 30000,
  MAX_COUNTERS = 2;
/** An unanswered offer lapses: the proposer waits before offering again, and the clock resets. */
function expireTrade(g: GameState, env: EngineEnvironment) {
  const offer = g.trade!;
  g.tradeMemo[offer.from] = {
    ...(g.tradeMemo[offer.from] ?? { round: 0 }),
    until: env.now + TRADE_COOLDOWN_MS,
  };
  g.trade = null;
  g.decisionAt = env.now;
}
function tradeSquares(list: number[] = [], single?: number | null): number[] {
  return [...new Set([...list, ...(single !== undefined && single !== null ? [single] : [])])];
}
function checkTradeSquares(g: GameState, owner: PlayerState, tiles: number[], message: string) {
  for (const t of tiles) {
    const prop = ownProperty(g, owner, t);
    requireRule(prop.level === 0 && !prop.mortgaged, message);
  }
}
function proposeTrade(
  g: GameState,
  p: PlayerState,
  target: PlayerState,
  giveCash: number,
  wantCash: number,
  giveTiles: number[],
  wantTiles: number[],
  counter: boolean,
  env: EngineEnvironment,
) {
  requireRule(p.cash >= giveCash, '给出的现金超过你的余额');
  requireRule(target.cash >= wantCash, '希望获得的现金超过对方余额');
  requireRule(giveCash + wantCash > 0 || giveTiles.length + wantTiles.length > 0, '请填写交易内容');
  const rule = '仅可交易没有建筑、未抵押的地产；先出售建筑或赎回';
  checkTradeSquares(g, p, giveTiles, rule);
  checkTradeSquares(g, target, wantTiles, rule);
  if (enemy(g, p, target)) {
    // Between rivals both sides must give something, and cash cannot exceed twice the listed
    // price of the land it buys: no gifts, no kingmaking through the trade window.
    requireRule(
      (giveCash > 0 || giveTiles.length > 0) && (wantCash > 0 || wantTiles.length > 0),
      '对手之间的交易需要双方都付出现金或地产，不能单方面赠送',
    );
    const listed = (tiles: number[]) => tiles.reduce((n, t) => n + tileAt(g, t).price, 0);
    requireRule(
      giveCash <= listed(wantTiles) * 2 && wantCash <= listed(giveTiles) * 2,
      '现金不能超过所换地产标价的 2 倍',
    );
  }
  g.trade = {
    id: `${g.id}-${g.revision}`,
    from: p.id,
    to: target.id,
    giveCash,
    wantCash,
    giveTiles,
    wantTiles,
    ...(counter ? { counter: true } : {}),
    expiresAt:
      env.now + ([p.id, target.id].includes(currentPlayer(g).id) ? TRADE_OFFER_MS : SIDE_TRADE_MS),
  };
  // The table waits for the offer, so the active player's decision clock restarts afterwards.
  g.decisionAt = env.now;
  g.tradeMemo[p.id] = { until: g.tradeMemo[p.id]?.until ?? 0, round: g.round };
  log(
    g,
    env,
    'trade',
    `${p.name}${counter ? '还价给' : '向'}${target.name}${counter ? '' : '提出交易'}，60 秒内有效`,
    p.id,
    undefined,
    undefined,
    { spot: 'offer' },
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
  if (action.type === 'guess') {
    // A free side guess by a waiting player. It does not advance the revision, so it can
    // never make the acting player's command stale.
    requireRule(g.phase === 'roll' && currentPlayer(g).id !== p.id, '只能在别人掷骰前猜点数');
    requireRule(!g.guesses[p.id], '本回合已经猜过了');
    g.guesses[p.id] = action.pick;
    return g;
  }
  if (g.trade && env.now >= g.trade.expiresAt) expireTrade(g, env);
  requireRule(
    !g.trade || ['tradeAccept', 'tradeReject', 'tradeCounter', 'surrender'].includes(action.type),
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
      const bail = bailOf(g);
      requireRule(p.cash >= bail, `保释金需要 ${bail} 现金`);
      p.cash -= bail;
      g.pot += bail;
      log(g, env, 'payment', `${p.name}：缴纳保释金 −${bail}，计入停车场奖池`, p.id, -bail);
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
        p.heldInJail = true;
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
      const fixed = p.nextDice !== null;
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
      if (fixed) {
        // The roller chose this value after seeing the guesses, so it is not scored.
        if (Object.keys(g.guesses).length)
          log(g, env, 'guess', '遥控骰子指定了点数，本次猜一猜不结算');
        g.guesses = {};
      } else resolveGuesses(g, die, env);
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
      if (p.position === mapOf(g).corners.start) paySalary(g, p, env);
      move(g, pending.remaining - 1, env, [...pending.path, p.position]);
      break;
    }
    case 'buy': {
      requireRule(currentPlayer(g).id === p.id && g.phase === 'purchase', '现在没有待购买的地产');
      const property = propertyAt(g, p.position)!,
        tile = tileAt(g, p.position);
      const price = landPrice(g, p.position);
      requireRule(!property.owner && p.cash >= price, `需要 ${price} 现金`);
      p.cash -= price;
      property.owner = p.id;
      p.stats.bought++;
      setPhase(g, 'manage', env);
      log(g, env, 'purchase', `${p.name}买下${tile.name}，花费 ${price}`, p.id, -price, undefined, {
        spot: 'purchase',
        tile: p.position,
      });
      break;
    }
    case 'pass':
      requireRule(currentPlayer(g).id === p.id && g.phase === 'purchase', '现在不能放弃购买');
      if (g.settings.auction) startAuction(g, env);
      else {
        // Only the player who landed here may buy; declining leaves the square for later.
        setPhase(g, 'manage', env);
        log(
          g,
          env,
          'purchase',
          `${p.name}放弃购买${tileAt(g, p.position).name}，地块继续空置`,
          p.id,
        );
      }
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
        p.stats.built++;
        log(
          g,
          env,
          'build',
          `${p.name}升级${tile.name}至 ${property.level} 级，花费 ${cost}`,
          p.id,
          -cost,
          undefined,
          { spot: 'build', tile: action.tile },
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
      // Only on the turn you arrive: standing on the market at the start of the next turn
      // does not give a second draw.
      requireRule(g.phase === 'manage', '抵达卡牌市场后才能抽卡');
      requireRule(!p.shopped, '每回合只能在卡牌市场抽一次');
      requireRule(!handFull(p), `手牌已满（最多 ${BOARD.handLimit} 张）`);
      const drawPrice = drawPriceOf(p);
      requireRule(p.cash >= drawPrice, `抽卡需要 ${drawPrice} 现金`);
      // A blind draw at a flat price: nobody can buy the exact combo they want.
      p.cash -= drawPrice;
      p.shopped = true;
      const card = randomCard(env.randomInt);
      p.newCards.push(card.id);
      log(g, env, 'card', `${p.name}在卡牌市场抽了一张卡（下回合可用）`, p.id, -drawPrice);
      break;
    }
    case 'ability': {
      manageAllowed(g, p);
      requireRule(g.round - p.abilityRound >= 3, '天赋每 3 轮只能使用一次');
      p.abilityRound = g.round;
      if (p.characterId === 'builder') reward(g, p, 150, env, '建设补助');
      if (p.characterId === 'landlord') reward(g, p, 150, env, '商业分红');
      if (p.characterId === 'runner') reward(g, p, 60, env, '旅行补贴');
      if (p.characterId === 'guardian') {
        p.taxShield = 1;
        reward(g, p, 150, env, '应急金');
      }
      if (p.characterId === 'dealer') {
        requireRule(!handFull(p), '手牌已满');
        drawCard(g, p, env);
      }
      if (p.characterId === 'explorer') {
        p.skipTurns = 0;
        if (p.jailTurns > 0) releaseFromJail(g, p, env, '凭探险家天赋');
        reward(g, p, 160, env, '探险奖励');
      }
      log(g, env, 'ability', `${p.name}使用角色天赋`, p.id);
      break;
    }
    case 'playCard':
      cardAction(g, p, action, env);
      break;
    case 'tradeOffer': {
      // Anyone still playing may propose, not only the player whose turn it is.
      requireRule(!g.trade, '已有交易等待处理');
      requireRule(MANAGE_PHASES.includes(g.phase), '请在掷骰、拘留或经营阶段发起交易');
      requireRule((g.tradeMemo[p.id]?.until ?? 0) <= env.now, '刚被拒绝或撤回，请稍等十几秒再发起');
      const target = playerById(g, action.to);
      requireRule(target && target.id !== p.id && !target.bankrupt, '请选择一位仍在经营的玩家');
      const give = tradeSquares(action.giveTiles, action.giveTile),
        want = tradeSquares(action.wantTiles, action.wantTile);
      // Offers between two players who are not on turn pause the table, so each player gets
      // one such offer per round.
      const side = ![p.id, target.id].includes(currentPlayer(g).id);
      requireRule(
        !side || g.tradeMemo[p.id]?.side !== g.round,
        '不在自己回合时，每轮只能发起一次交易',
      );
      proposeTrade(g, p, target, action.giveCash, action.wantCash, give, want, false, env);
      if (side) g.tradeMemo[p.id]!.side = g.round;
      break;
    }
    case 'tradeCounter': {
      const offer = g.trade;
      requireRule(offer && offer.to === p.id, '没有可以还价的提案');
      requireRule((offer.depth ?? 0) < MAX_COUNTERS, '已经来回还价两次，请接受或拒绝');
      const target = playerById(g, offer.from)!;
      const depth = (offer.depth ?? 0) + 1;
      g.trade = null;
      proposeTrade(
        g,
        p,
        target,
        action.giveCash,
        action.wantCash,
        tradeSquares(action.giveTiles),
        tradeSquares(action.wantTiles),
        true,
        env,
      );
      g.trade!.depth = depth;
      break;
    }
    case 'tradeAccept':
    case 'tradeReject': {
      const offer = g.trade;
      requireRule(
        offer &&
          (offer.to === p.id ||
            (action.type === 'tradeReject' &&
              (offer.from === p.id ||
                // The player on turn may wave away an offer between two others.
                (currentPlayer(g).id === p.id && offer.to !== p.id)))) &&
          MANAGE_PHASES.includes(g.phase),
        '交易已结束或不属于你',
      );
      if (action.type === 'tradeAccept') {
        const from = playerById(g, offer.from)!;
        requireRule(
          !from.bankrupt && from.cash >= offer.giveCash && p.cash >= offer.wantCash,
          '交易资金已发生变化',
        );
        checkTradeSquares(g, from, offer.giveTiles, '地产状态已变化');
        checkTradeSquares(g, p, offer.wantTiles, '地产状态已变化');
        from.cash += offer.wantCash - offer.giveCash;
        p.cash += offer.giveCash - offer.wantCash;
        for (const t of offer.giveTiles) propertyAt(g, t)!.owner = p.id;
        p.stats.trades++;
        from.stats.trades++;
        for (const t of offer.wantTiles) propertyAt(g, t)!.owner = from.id;
        requireRule(
          g.settings.end !== 'target' || !targetReached(g),
          '交易不能让任何一方直接达到目标净资产',
        );
        log(
          g,
          env,
          'trade',
          `${p.name}与${from.name}完成交易，资产同时结算`,
          p.id,
          undefined,
          undefined,
          {
            spot: 'trade',
          },
        );
      } else {
        log(
          g,
          env,
          'trade',
          offer.from === p.id
            ? `${p.name}撤回了交易提案`
            : offer.to === p.id
              ? `${p.name}拒绝了交易提案`
              : `${p.name}要继续回合，跳过了旁人的交易提案`,
          p.id,
        );
        // A short pause before the same player can propose again keeps offers from piling up.
        g.tradeMemo[offer.from] = {
          ...(g.tradeMemo[offer.from] ?? { round: 0 }),
          until: env.now + TRADE_COOLDOWN_MS,
        };
      }
      g.trade = null;
      g.decisionAt = env.now;
      break;
    }
  }
  // Safety net: if money arrived after a debt was created, settle it instead of leaving
  // the player in a debt phase they can already pay.
  if (g.debt) settleDebt(g, env);
  if (!checkWinner(g, env)) updateFinale(g, env);
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
  if (
    !(state.trade && env.now >= state.trade.expiresAt) &&
    !winnerDue(state, env) &&
    (state.finale || !finaleDue(state, env.now))
  )
    return null;
  const g = structuredClone(state);
  let changed = false;
  if (g.trade && env.now >= g.trade.expiresAt) {
    expireTrade(g, env);
    changed = true;
    log(g, env, 'trade', '交易提案已超时撤回。');
  }
  if (checkWinner(g, env)) changed = true;
  if (updateFinale(g, env)) changed = true;
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
        p.position < mapOf(g).tiles.length &&
        (p.jailTurns === 0 || (p.jailTurns === 1 && p.position === mapOf(g).corners.jail)) &&
        handSize(p) <= BOARD.handLimit &&
        p.shield <= BOARD.shieldCap,
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
    const tile = tileAt(g, p.position),
      price = landPrice(g, p.position);
    if (p.cash >= price)
      add(
        { type: 'buy' },
        `购买 · ${price}`,
        `基础租金 ${tile.rent}，标准建设费 ${tile.buildCost}`,
        true,
      );
    if (g.settings.auction) add({ type: 'pass' }, '进入拍卖', '让所有玩家公开竞价');
    else add({ type: 'pass' }, '放弃购买', '地块继续空置，以后停在这里的人可以买');
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
    if (p.cash >= bailOf(g))
      add({ type: 'bail' }, `缴纳保释金 · ${bailOf(g)}`, '出狱后正常掷骰；保释金进入停车场奖池');
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
      add(
        { type: 'bank', direction: 'deposit', amount: 300 },
        '存入 300',
        `每轮银行利息 ${BOARD.interest * 100}%`,
      );
  }
  if (g.phase === 'debt') {
    add({ type: 'surrender' }, '宣布破产', '退出经营，仍可继续观战');
    return options;
  }
  if (
    g.phase === 'manage' &&
    tileAt(g, p.position).kind === 'shop' &&
    !p.shopped &&
    !handFull(p) &&
    p.cash >= drawPriceOf(p)
  )
    add(
      { type: 'buyCard' },
      `抽一张卡 · ${drawPriceOf(p)}`,
      '随机抽取，下回合才能使用；每回合限一次',
    );
  if (g.round - p.abilityRound >= 3 && (p.characterId !== 'dealer' || !handFull(p)))
    add({ type: 'ability' }, '使用角色天赋', characterById(p.characterId).ability);
  return options;
}
/** Recent events sent to clients; the authoritative log keeps more for persistence. */
export const VIEW_EVENTS = 60;
const QUIET_EVENTS = new Set(['turn', 'start', 'move', 'ai']);
export function viewFor(g: GameState, viewerId: string | null): GameView {
  // Views are serialized immediately. Copy only the small mutable parts instead of the whole
  // state; event objects are append-only and safe to share.
  // Deck order is hidden information: it never leaves the server.
  const { players, traps, properties, events, decks: _decks, ...rest } = g;
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
        price: landPrice(g, property.tile),
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
      const { cards, newCards, nextDice, ...pub } = p;
      const assets = assetsOf(g, p),
        debt = g.debt?.playerId === p.id ? g.debt.amount : 0;
      const owned = properties.filter((x) => x.owner === p.id);
      return {
        ...pub,
        cardCount: cards.length + newCards.length,
        ...(p.id === viewerId ? { cards: [...cards], newCards: [...newCards], nextDice } : {}),
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
