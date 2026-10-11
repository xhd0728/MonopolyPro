import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CHARACTERS } from '../../../packages/content/src/index.ts';
import type { GameView, MapDefinition } from '../../../packages/shared/src/index.ts';
export function Board({
  map,
  game,
  onTile,
  follow,
  reduced,
  highlight = [],
}: {
  map: MapDefinition;
  game?: GameView | null;
  onTile: (i: number) => void;
  follow: boolean;
  reduced: boolean;
  highlight?: number[];
}) {
  const host = useRef<HTMLDivElement>(null),
    live = useRef({ game, onTile, follow, reduced, highlight });
  live.current = { game, onTile, follow, reduced, highlight };
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const el = host.current!;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFallback(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    el.append(renderer.domElement);
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute(
      'aria-label',
      `${map.name}立体棋盘，拖动平移，滚轮缩放，点击查看地点`,
    );
    const scene = new T.Scene(),
      camera = new T.OrthographicCamera(-8, 8, 7, -7, 0.1, 100);
    camera.position.set(12, 15, 12);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enableDamping = true;
    controls.maxZoom = 2.3;
    controls.minZoom = 0.6;
    controls.mouseButtons.LEFT = T.MOUSE.PAN;
    controls.mouseButtons.RIGHT = T.MOUSE.PAN;
    controls.update();
    scene.add(new T.HemisphereLight('#fff9e9', '#576579', 2.6));
    const sun = new T.DirectionalLight('#fff7e3', 3.5);
    sun.position.set(-5, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
    sun.shadow.normalBias = 0.06;
    scene.add(sun);
    const mat = (c: string) => new T.MeshStandardMaterial({ color: c, roughness: 0.85 });
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      c: string,
      parent: T.Object3D = scene,
    ) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c));
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const cyl = (
      x: number,
      y: number,
      z: number,
      r: number,
      h: number,
      c: string,
      parent: T.Object3D = scene,
    ) => {
      const m = new T.Mesh(new T.CylinderGeometry(r, r, h, 12), mat(c));
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const island = map.id === 'islands',
      neon = map.id === 'neon',
      ancient = map.id === 'ancient';
    box(
      0,
      -0.38,
      0,
      9.5,
      0.6,
      9.5,
      island ? '#78b4c1' : neon ? '#72799a' : ancient ? '#aea685' : '#b2c5ae',
    );
    box(0, -0.78, 0, 9.65, 0.28, 9.65, '#f1e0c3');
    if (island) {
      box(-1.05, 0.02, 0.65, 3.6, 0.22, 3.2, '#dbd0a6');
      box(1.55, 0.07, -1.45, 2.1, 0.32, 2.6, '#dfd4a8');
    } else box(0, -0.03, 0, 5.5, 0.18, 5.5, neon ? '#939caf' : ancient ? '#d3bf9e' : '#d6d5b8');
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5,
        x = island ? (i < 5 ? -1.05 : 1.55) + Math.cos(a) * 0.75 : Math.cos(a) * 2.05,
        z = island ? (i < 5 ? 0.65 : -1.45) + Math.sin(a) * 0.75 : Math.sin(a) * 2.05;
      cyl(x, 0.35, z, 0.07, 0.7, '#99705b');
      const crown = new T.Mesh(new T.IcosahedronGeometry(0.36, 1), mat('#8da17a'));
      crown.position.set(x, 0.95, z);
      crown.castShadow = true;
      scene.add(crown);
    }
    if (ancient) {
      box(0, 0.6, 0, 1.6, 1.2, 1.35, '#b46e55');
      for (let i = 0; i < 3; i++)
        box(0, 1.28 + i * 0.3, 0, 2 - i * 0.4, 0.2, 1.7 - i * 0.3, '#646d67');
      box(-1.3, 0.5, 0, 0.2, 1, 0.2, '#a86e52');
      box(1.3, 0.5, 0, 0.2, 1, 0.2, '#a86e52');
      box(0, 1.05, 0, 3, 0.14, 0.28, '#74685a');
    } else if (neon) {
      for (let i = 0; i < 5; i++) {
        const x = ((i % 3) - 1) * 0.85,
          z = (Math.floor(i / 3) - 0.5) * 1.1,
          h = 1 + i * 0.25;
        box(x, h / 2, z, 0.62, h, 0.7, ['#9093be', '#769ba6', '#c08e99'][i % 3]);
        box(x, h + 0.08, z, 0.68, 0.1, 0.77, '#e6cb88');
        for (let l = 0; l < 3; l++)
          box(x, h * 0.25 + l * 0.3, z + 0.36, 0.45, 0.06, 0.02, '#f7dcaa');
      }
    } else if (island) {
      cyl(1.65, 0.85, -1.8, 0.25, 1.5, '#fff0d0');
      cyl(1.65, 1.7, -1.8, 0.35, 0.23, '#c7826b');
      box(-0.6, 0.32, 0.6, 1.5, 0.6, 1, '#f4d6a2');
      box(-0.6, 0.73, 0.6, 1.65, 0.2, 1.2, '#c78e71');
      box(1.2, -0.03, 1.7, 1.8, 0.15, 0.6, '#c3a385');
    } else {
      box(0, 0.42, 0, 1.6, 0.8, 1.15, '#f0d8ad');
      box(0, 0.94, 0, 1.8, 0.24, 1.4, '#c9866b');
      cyl(0, 1.28, 0, 0.2, 0.45, '#e1b774');
      box(0.8, 0.55, -1.3, 0.7, 1.1, 0.75, '#d9c0a6');
      box(-1.2, 0.18, -0.65, 1.3, 0.35, 0.8, '#a2bbad');
    }
    const palette = ['#ddaa78', '#81aca0', '#92aaca', '#b79bc1'],
      pickable: T.Object3D[] = [],
      buildings: T.Group[] = [],
      signatures = new Map<number, string>();
    for (const tile of map.tiles) {
      const group = new T.Group();
      group.position.set(tile.x - 3.5, 0, tile.z - 3.5);
      scene.add(group);
      const color =
        tile.kind === 'property'
          ? palette[tile.group]
          : tile.kind === 'start'
            ? '#edb66b'
            : tile.kind === 'bank'
              ? '#8eb5a3'
              : tile.kind === 'tax'
                ? '#c4938e'
                : tile.kind === 'transit'
                  ? '#85b6c7'
                  : '#b2a2c2';
      const base = box(0, 0.04, 0, 0.94, 0.18, 0.94, '#f7ecd7', group);
      base.userData.tile = tile.index;
      pickable.push(base);
      box(0, 0.15, -0.34, 0.88, 0.1, 0.18, color, group);
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 80;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#4c564f';
      ctx.font = 'bold 27px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        tile.kind === 'property'
          ? `${tile.index} · ${tile.price}`
          : ({
              start: '起点',
              bank: '银行',
              shop: '商店',
              event: '奇遇',
              tax: '税务',
              hospital: '休息',
              transit: '轮渡',
            }[tile.kind] ?? ''),
        128,
        42,
      );
      const sprite = new T.Sprite(
        new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), depthTest: false }),
      );
      sprite.scale.set(1.5, 0.47, 1);
      sprite.position.set(tile.x - 3.5, 0.4, tile.z - 3.5 + 0.3);
      scene.add(sprite);
      const b = new T.Group();
      group.add(b);
      buildings.push(b);
    }
    const routes = new T.Group();
    scene.add(routes);
    if (neon || ancient) {
      for (const [a, b] of neon
        ? [
            [9, 18],
            [23, 4],
          ]
        : [
            [9, 20],
            [23, 6],
          ]) {
        const start = map.tiles[a],
          end = map.tiles[b];
        const line = new T.Line(
          new T.BufferGeometry().setFromPoints([
            new T.Vector3(start.x - 3.5, 0.2, start.z - 3.5),
            new T.Vector3(end.x - 3.5, 0.2, end.z - 3.5),
          ]),
          new T.LineDashedMaterial({ color: '#cfbadb', dashSize: 0.22, gapSize: 0.15 }),
        );
        line.computeLineDistances();
        routes.add(line);
      }
    }
    const pawns = new Map<string, T.Group>(),
      ray = new T.Raycaster(),
      mouse = new T.Vector2();
    let down = { x: 0, y: 0 },
      animation = 0,
      lastTime = 0,
      oldActive = '';
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const pointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = el.getBoundingClientRect();
      mouse.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(pickable)[0];
      if (hit) live.current.onTile(hit.object.userData.tile);
    };
    el.addEventListener('pointerdown', pointerDown);
    el.addEventListener('pointerup', pointerUp);
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h);
      const aspect = w / h;
      camera.left = -6.9 * aspect;
      camera.right = 6.9 * aspect;
      camera.top = 6.9;
      camera.bottom = -6.9;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    function frame(time: number) {
      animation = requestAnimationFrame(frame);
      const { game: g, follow, reduced, highlight } = live.current,
        dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;
      for (const base of pickable) {
        const material = (base as T.Mesh).material as T.MeshStandardMaterial;
        material.emissive.set(highlight.includes(base.userData.tile) ? '#baa052' : '#000000');
        material.emissiveIntensity = 0.38;
      }
      routes.visible = !ancient || (!!g && g.round % 2 === 0);
      if (g) {
        for (const p of g.players) {
          let pawn = pawns.get(p.id);
          if (!pawn) {
            pawn = new T.Group();
            const c = CHARACTERS.find((c) => c.id === p.characterId)!;
            cyl(0, 0.29, 0, 0.14, 0.36, c.color, pawn);
            const head = new T.Mesh(new T.SphereGeometry(0.135, 12, 12), mat('#f5dabd'));
            head.position.y = 0.6;
            pawn.add(head);
            cyl(0, 0.73, 0, 0.17, 0.08, c.color, pawn);
            const ring = new T.Mesh(new T.TorusGeometry(0.24, 0.025, 8, 24), mat(c.color));
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 0.19;
            pawn.add(ring);
            const labelCanvas = document.createElement('canvas');
            labelCanvas.width = 256;
            labelCanvas.height = 64;
            const labelContext = labelCanvas.getContext('2d')!;
            labelContext.fillStyle = '#fffbed';
            labelContext.roundRect(6, 5, 244, 49, 12);
            labelContext.fill();
            labelContext.font = 'bold 24px sans-serif';
            labelContext.textAlign = 'center';
            labelContext.fillStyle = '#4e6255';
            labelContext.fillText(`${g.players.indexOf(p) + 1} ${p.name.slice(0, 5)}`, 128, 38);
            const nameTag = new T.Sprite(
              new T.SpriteMaterial({ map: new T.CanvasTexture(labelCanvas), depthTest: false }),
            );
            nameTag.position.y = 1.0;
            nameTag.scale.set(1.05, 0.27, 1);
            pawn.add(nameTag);
            scene.add(pawn);
            pawns.set(p.id, pawn);
            const tile = map.tiles[p.position];
            pawn.position.set(tile.x - 3.5, 0, tile.z - 3.5);
          }
          pawn.visible = !p.bankrupt;
          pawn.scale.setScalar(p.id === g.activeId ? 1.12 : 1);
          const tile = map.tiles[p.position],
            idx = g.players.indexOf(p),
            dest = new T.Vector3(
              tile.x - 3.5 + ((idx % 3) - 1) * 0.22,
              0,
              tile.z - 3.5 + (Math.floor(idx / 3) - 0.5) * 0.22,
            );
          pawn.position.lerp(dest, reduced ? 1 : Math.min(1, dt * 5));
        }
        const marker = `${g.activeId}:${g.players.find((p) => p.id === g.activeId)?.position}`;
        if (follow && marker !== oldActive) {
          const p = g.players.find((p) => p.id === g.activeId);
          if (p) {
            const tile = map.tiles[p.position];
            controls.target.set((tile.x - 3.5) * 0.25, 0, (tile.z - 3.5) * 0.25);
          }
          oldActive = marker;
        }
        for (const prop of g.properties) {
          const sig = `${prop.owner}-${prop.level}-${prop.mortgaged}`;
          if (signatures.get(prop.tile) === sig) continue;
          signatures.set(prop.tile, sig);
          const b = buildings[prop.tile];
          for (const child of [...b.children]) {
            b.remove(child);
            if (child instanceof T.Mesh) {
              child.geometry.dispose();
              (child.material as T.Material).dispose();
            }
          }
          if (prop.owner) {
            const owner = g.players.find((p) => p.id === prop.owner)!,
              c = CHARACTERS.find((c) => c.id === owner.characterId)!.color,
              h = 0.22 + prop.level * 0.23;
            box(0, 0.2 + h / 2, 0, 0.48, h, 0.43, prop.mortgaged ? '#a5aaa6' : c, b);
            box(0, 0.23 + h, 0, 0.56, 0.09, 0.5, '#f9e4bd', b);
            if (prop.level > 1) box(0, 0.33 + h, 0, 0.25, 0.18, 0.24, c, b);
          }
        }
      }
      controls.update();
      renderer.render(scene, camera);
    }
    animation = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(animation);
      observer.disconnect();
      el.removeEventListener('pointerdown', pointerDown);
      el.removeEventListener('pointerup', pointerUp);
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof T.Mesh || o instanceof T.Line) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
        if (o instanceof T.Sprite) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [map.id]);
  return (
    <div className="board-canvas" ref={host}>
      {fallback && (
        <div className="flat-board">
          {map.tiles.map((t) => (
            <button
              key={t.index}
              onClick={() => onTile(t.index)}
              style={{ gridColumn: t.x + 1, gridRow: t.z + 1 }}
            >
              {t.index} {t.name}
              <small>{t.price || t.kind}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
