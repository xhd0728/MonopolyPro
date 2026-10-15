import { useEffect, useRef } from 'react';
import type { ActionOption, GameAction } from '../../../packages/shared/src/index.ts';

interface Shortcuts {
  enabled: boolean;
  actions: ActionOption[];
  run: (action: GameAction) => void;
  trade: () => void;
  guess?: (pick: 'high' | 'low') => void;
  help: () => void;
}
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
/**
 * Desktop keyboard play. Keys only map to actions the server currently offers, so they can
 * never do anything the buttons could not.
 */
export function useShortcuts(options: Shortcuts) {
  const current = useRef(options);
  current.current = options;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const o = current.current;
      if (document.querySelector('dialog[open]')) return;
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') {
        o.help();
        return;
      }
      if (!o.enabled) return;
      const find = (...types: string[]) => o.actions.find((a) => types.includes(a.action.type));
      let action: ActionOption | undefined;
      const key = e.key.toLowerCase();
      if (key === ' ' || key === 'enter') {
        // Space and Enter press the main action, unless a button already has focus. Buying
        // spends money, so it needs its own key (B): a second Space to roll never buys.
        if (e.target instanceof HTMLButtonElement) return;
        action = o.actions.find(
          (a) => a.primary && ['roll', 'jailRoll', 'end'].includes(a.action.type),
        );
      } else if (key === 'b') action = find('buy');
      else if (key === 'p') action = find('pass', 'auctionPass');
      else if (key === 'e') action = find('end');
      else if (key === 't') {
        e.preventDefault();
        o.trade();
        return;
      } else if (/^[1-3]$/.test(key))
        action = o.actions.filter((a) => a.action.type === 'choosePath')[Number(key) - 1];
      else if ((key === 'arrowup' || key === 'arrowdown') && o.guess) {
        e.preventDefault();
        o.guess(key === 'arrowup' ? 'high' : 'low');
        return;
      }
      if (!action || action.disabled) return;
      e.preventDefault();
      o.run(action.action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
