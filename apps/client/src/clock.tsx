import { useSyncExternalStore, type ReactNode } from 'react';

/** Offset between the server clock and this browser, updated whenever a view arrives. */
let serverOffset = 0;
export const setServerOffset = (offset: number) => {
  serverOffset = offset;
};
export const serverTime = () => Date.now() + serverOffset;

// One interval for the whole page; subscribers re-render only themselves.
const listeners = new Set<() => void>();
let second = Math.floor(Date.now() / 1000);
let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    second = Math.floor(Date.now() / 1000);
    for (const l of listeners) l();
  }, 1000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
/** Server time, refreshed once per second. */
export function useServerNow(): number {
  useSyncExternalStore(subscribe, () => second);
  return serverTime();
}
/** Render-prop clock so a parent does not re-render every second. */
export function Clock({ children }: { children: (now: number) => ReactNode }) {
  return <>{children(useServerNow())}</>;
}
