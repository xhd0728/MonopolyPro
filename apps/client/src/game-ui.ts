const moneyFormatter = new Intl.NumberFormat('zh-CN');
export const money = (n: number) => moneyFormatter.format(n);
const colors = ['#337878', '#c78445', '#8470ac', '#a55e71', '#587fbd', '#788e43'];
export const playerColor = (index: number) => colors[index % colors.length];
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
