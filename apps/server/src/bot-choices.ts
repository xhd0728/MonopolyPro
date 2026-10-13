import { CARDS } from '../../../packages/content/src/index.ts';
import type { GameAction, GameState } from '../../../packages/shared/src/index.ts';
import { actionsFor, applyAction, viewFor } from '../../../packages/engine/src/index.ts';
/** Enumerate proposals; simulation only tests legality, never previews the real dice/randomness. */
export function botChoices(game: GameState, id: string): GameAction[] {
  const view = viewFor(game, id),
    me = view.players.find((p) => p.id === id);
  if (!me) return [];
  const proposals = actionsFor(game, id)
    .filter((a) => !a.disabled)
    .map((a) => a.action);
  if (!game.trade && ['roll', 'jail', 'manage'].includes(game.phase) && view.activeId === id) {
    for (const cardId of me.cards ?? []) {
      const card = CARDS.find((c) => c.id === cardId)!;
      if (card.effect === 'dice')
        for (let value = 1; value <= 6; value++)
          proposals.push({ type: 'playCard', cardId, value });
      else if (card.target === 'self') proposals.push({ type: 'playCard', cardId });
      else if (card.target === 'player')
        for (const p of view.players) proposals.push({ type: 'playCard', cardId, targetId: p.id });
      else
        for (const property of view.properties)
          proposals.push({ type: 'playCard', cardId, tile: property.tile });
    }
    // Market draws come from actionsFor: one blind draw, no card choice.
  }
  const unique = [...new Map(proposals.map((a) => [JSON.stringify(a), a])).values()];
  return unique
    .filter((action) => {
      try {
        applyAction(game, id, action, { now: game.decisionAt, randomInt: () => 0 });
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, 128);
}
