import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, MAPS_XL, CHARACTERS, CARDS, countryFlag } from '../packages/content/src/index.ts';
const countriesOf = (map: (typeof MAPS)[number]) => map.tiles.filter((t) => t.kind === 'property');
test('content catalog identities, targets and all connected map nodes are valid', () => {
  assert.equal(MAPS.length, 4);
  assert.equal(CHARACTERS.length, 6);
  assert.equal(CARDS.length, 30);
  for (const list of [MAPS, CHARACTERS, CARDS])
    assert.equal(new Set(list.map((i) => i.id)).size, list.length);
  assert.equal(new Set(MAPS.map((m) => m.mechanic)).size, 4);
  assert.equal(MAPS_XL.length, 4);
  for (const map of [...MAPS, ...MAPS_XL]) {
    const size = map.tiles.length,
      last = map.side - 1;
    assert.ok(size === 36 || size === 44);
    assert.equal(size, (map.side - 1) * 4);
    assert.equal(new Set(map.tiles.map((t) => `${t.x}:${t.z}`)).size, size);
    const c = map.corners;
    assert.deepEqual(
      [c.start, c.jail, c.parking, c.goToJail].map((i) => map.tiles[i].kind),
      ['start', 'jail', 'parking', 'gotojail'],
    );
    // Corners sit on the four grid corners of the ring.
    assert.deepEqual(
      [c.start, c.jail, c.parking, c.goToJail].map((i) => `${map.tiles[i].x}:${map.tiles[i].z}`),
      ['0:0', `${last}:0`, `${last}:${last}`, `0:${last}`],
    );
    assert.ok(map.tiles.every((t) => t.x === 0 || t.x === last || t.z === 0 || t.z === last));
    assert.equal(map.salary, size === 36 ? 500 : 600);
    assert.deepEqual(
      map.tiles.filter((t) => t.kind === 'chance' || t.kind === 'fate').map((t) => t.kind),
      ['chance', 'fate', 'chance', 'fate'],
      'two chance and two fate squares, alternating around the ring',
    );
    // Eight colour groups (two to four lots), priced in route order.
    const groups = new Map<number, number>();
    for (const t of countriesOf(map)) groups.set(t.group, (groups.get(t.group) ?? 0) + 1);
    assert.equal(groups.size, 8);
    assert.ok([...groups.values()].every((n) => n >= 2 && n <= (size === 36 ? 3 : 4)));
    assert.equal(
      countriesOf(map).length,
      (size === 36 ? 24 : 32) - (map.mechanic === 'ferry' ? 2 : 0),
    );
    const prices = countriesOf(map).map((t) => t.price);
    assert.deepEqual(
      prices,
      [...prices].sort((a, b) => a - b),
    );
    for (const [from, to] of map.shortcuts)
      assert.ok(from % last !== 0 && to % last !== 0, 'shortcuts never start or end on a corner');
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
    assert.equal(seen.size, size);
  }
  assert.equal(new Set(CARDS.map((c) => c.category)).size, 5);
  assert.ok(CARDS.every((c) => c.description && c.price >= 100));
});
