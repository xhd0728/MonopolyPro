import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, MAPS, CHARACTERS, CARDS, countryFlag } from '../packages/content/src/index.ts';
const countriesOf = (map: (typeof MAPS)[number]) => map.tiles.filter((t) => t.kind === 'property');
test('content catalog identities, targets and all connected map nodes are valid', () => {
  assert.equal(MAPS.length, 4);
  assert.equal(CHARACTERS.length, 6);
  assert.equal(CARDS.length, 30);
  for (const list of [MAPS, CHARACTERS, CARDS])
    assert.equal(new Set(list.map((i) => i.id)).size, list.length);
  assert.equal(new Set(MAPS.map((m) => m.mechanic)).size, 4);
  for (const map of MAPS) {
    assert.equal(map.tiles.length, BOARD.tiles);
    assert.equal(new Set(map.tiles.map((t) => `${t.x}:${t.z}`)).size, BOARD.tiles);
    assert.deepEqual(
      [BOARD.start, BOARD.jail, BOARD.parking, BOARD.goToJail].map((i) => map.tiles[i].kind),
      ['start', 'jail', 'parking', 'gotojail'],
    );
    // Corners sit on the four grid corners of the 10x10 ring.
    assert.deepEqual(
      [BOARD.start, BOARD.jail, BOARD.parking, BOARD.goToJail].map(
        (i) => `${map.tiles[i].x}:${map.tiles[i].z}`,
      ),
      ['0:0', '9:0', '9:9', '0:9'],
    );
    assert.ok(map.tiles.every((t) => t.x === 0 || t.x === 9 || t.z === 0 || t.z === 9));
    assert.deepEqual(
      map.tiles.filter((t) => t.kind === 'chance' || t.kind === 'fate').map((t) => t.kind),
      ['chance', 'fate', 'chance', 'fate'],
      'two chance and two fate squares, alternating around the ring',
    );
    // Eight colour groups of two or three lots, priced in route order.
    const groups = new Map<number, number>();
    for (const t of countriesOf(map)) groups.set(t.group, (groups.get(t.group) ?? 0) + 1);
    assert.equal(groups.size, 8);
    assert.ok([...groups.values()].every((n) => n === 2 || n === 3));
    const prices = countriesOf(map).map((t) => t.price);
    assert.deepEqual(
      prices,
      [...prices].sort((a, b) => a - b),
    );
    for (const [from, to] of map.shortcuts)
      assert.ok(
        map.tiles[from].kind !== 'start' && to % 9 !== 0,
        'shortcuts never start or end on a corner',
      );
    const countries = map.tiles.filter((t) => t.kind === 'property');
    assert.equal(new Set(countries.map((t) => t.countryCode)).size, countries.length);
    assert.ok(countries.every((t) => /^[A-Z]{2}$/.test(t.countryCode ?? '') && t.name));
    assert.ok(countries.every((t) => [...countryFlag(t.countryCode)].length === 2));
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
    assert.equal(seen.size, BOARD.tiles);
  }
  assert.equal(new Set(CARDS.map((c) => c.category)).size, 5);
  assert.ok(CARDS.every((c) => c.description && c.price >= 100));
});
