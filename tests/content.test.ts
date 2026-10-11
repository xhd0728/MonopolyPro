import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, CHARACTERS, CARDS } from '../packages/content/src/index.ts';
test('content catalog identities, targets and all connected map nodes are valid', () => {
  assert.equal(MAPS.length, 4);
  assert.equal(CHARACTERS.length, 6);
  assert.equal(CARDS.length, 30);
  for (const list of [MAPS, CHARACTERS, CARDS])
    assert.equal(new Set(list.map((i) => i.id)).size, list.length);
  assert.equal(new Set(MAPS.map((m) => m.mechanic)).size, 4);
  for (const map of MAPS) {
    assert.equal(map.tiles.length, 28);
    assert.equal(new Set(map.tiles.map((t) => `${t.x}:${t.z}`)).size, 28);
    for (const t of map.tiles) {
      assert.ok(t.exits.length);
      assert.ok(t.exits.every((i) => i >= 0 && i < map.tiles.length));
      assert.ok(Number.isInteger(t.price) && t.price >= 0);
    }
    const seen = new Set<number>();
    function walk(i: number) {
      if (seen.has(i)) return;
      seen.add(i);
      map.tiles[i].exits.forEach(walk);
    }
    walk(0);
    assert.equal(seen.size, 28);
  }
  assert.equal(new Set(CARDS.map((c) => c.category)).size, 5);
  assert.ok(CARDS.every((c) => c.description && c.price >= 100));
});
