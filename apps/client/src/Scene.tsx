import { lazy, Suspense, type ComponentProps } from 'react';
const Scene = lazy(() => import('./Board.tsx').then((m) => ({ default: m.Board })));
export function Board(props: ComponentProps<typeof Scene>) {
  return (
    <Suspense fallback={<div className="scene-loading">正在展开城市地图…</div>}>
      <Scene {...props} />
    </Suspense>
  );
}
