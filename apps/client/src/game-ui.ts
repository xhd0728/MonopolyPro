const moneyFormatter = new Intl.NumberFormat('zh-CN');
export const money = (n: number) => moneyFormatter.format(n);
// Pawn colours: distinct from each other and from the group bands at small sizes.
const colors = ['#e2483b', '#2f7fd8', '#21a36b', '#f0a21c', '#8a4fd1', '#e0559b'];
export const playerColor = (index: number) => colors[index % colors.length];
// Eight colour groups in route order, like the bands on a classic board.
const groups = [
  '#9a6b4a',
  '#4fb3e3',
  '#d4569b',
  '#f08c2e',
  '#e04848',
  '#e9c43b',
  '#2fa36b',
  '#3f5bd6',
];
export const groupColor = (group: number) => groups[group % groups.length];
import type { CardDefinition, GameView, PlayerView } from '../../../packages/shared/src/index.ts';
export function cardTargetReason(
  card: CardDefinition,
  game: GameView,
  me: PlayerView | undefined,
  target: string,
): string {
  if (!me) return '观众不能使用卡牌';
  if (card.effect === 'stealCard') {
    if (me.cardCount >= 8) return '自己的手牌已满';
    if (!game.players.find((p) => p.id === target)?.cardCount) return '对手没有手牌';
  }
  const property = game.properties.find((p) => String(p.tile) === target);
  if (!property) return '';
  if (card.target === 'enemyProperty' && property.protectedUntil >= game.round)
    return '地产受到保护';
  if (card.effect === 'upgrade' && (property.level >= 3 || property.mortgaged))
    return property.mortgaged ? '地产已抵押' : '建筑已满级';
  if (card.effect === 'demolish' && !property.level) return '没有可拆除的建筑';
  if (card.effect === 'remoteBuy' && property.owner) return '地产已出售';
  return '';
}
export const validMoney = (amount: number) => Number.isSafeInteger(amount) && amount >= 0;
