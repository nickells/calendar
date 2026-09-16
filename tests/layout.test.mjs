import test from 'node:test';
import assert from 'node:assert/strict';
import { packRow } from '../layout.mjs';

const days = Array.from({ length: 7 }, () => ({ headerTop: 6, bodyTop: 36, gap: 2 }));
const item = (id, columns, height = 28, header = false, timed = false) =>
  ({ id, columns, height, header, headerHeight: 22, timed });
const overlap = (a, b) => a.columns.some(c => b.columns.includes(c));

function check(items, placements) {
  assert.equal(placements.length, items.length);
  assert.equal(new Set(placements.map(p => p.id)).size, items.length);
  for (const p of placements) {
    const event = items[p.index];
    assert.ok(Number.isFinite(p.top));
    assert.equal(p.height, p.header ? event.headerHeight : event.height);
    assert.ok(p.top >= (p.header ? days[event.columns[0]].headerTop : days[event.columns[0]].bodyTop));
    if (p.header) { assert.ok(event.header); assert.equal(event.columns.length, 1); }
    for (const q of placements) {
      if (p.index === q.index || !overlap(event, items[q.index])) continue;
      assert.ok(p.top + p.height + 2 <= q.top || q.top + q.height + 2 <= p.top,
        `No overlap: ${p.id} / ${q.id}`);
      if (p.index < q.index && (event.timed || items[q.index].timed)) {
        assert.ok(p.top + p.height + 2 <= q.top, 'Explicit time order is mandatory');
      }
    }
  }
}

test('short single can use header above an earlier untimed span', () => {
  const items = [item('beg', [0, 1]), item('test', [0], 28, true)];
  const result = packRow(items, days.map(day => ({ ...day, bottom: 80 })));
  check(items, result);
  assert.ok(result.find(p => p.id === 'test').header);
});

test('low arrow leaves a usable gap above its continuation', () => {
  const items = [
    item('test', [0], 28, true), item('third', [0]), item('new', [0]),
    item('low', [0, 1], 42), item('next', [1, 2, 3], 42)
  ];
  const result = packRow(items, days);
  check(items, result);
  assert.ok(result.find(p => p.id === 'next').top < result.find(p => p.id === 'low').top);
});

test('bounded search improves a greedy ordering of interlocking spans', () => {
  const items = [item('a', [0, 1]), item('b', [3, 4]), item('c', [1, 2]), item('d', [2, 3])];
  const extent = result => Math.max(...result.map(p => p.top + p.height));
  const greedy = packRow(items, days, { beamWidth: 1, choices: 1 });
  const searched = packRow(items, days);
  check(items, searched);
  assert.ok(extent(searched) < extent(greedy));
});

test('deterministic varied rows preserve all hard constraints', () => {
  let seed = 91823;
  const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let trial = 0; trial < 80; trial++) {
    const items = Array.from({ length: 5 + random(12) }, (_, i) => {
      const start = random(7), length = 1 + random(7 - start);
      return item(String(i), Array.from({ length }, (_, c) => c + start),
        28 + random(4) * 16, length === 1 && random(2) === 0, random(3) === 0);
    });
    const result = packRow(items, days);
    check(items, result);
    assert.deepEqual(packRow(items, days), result);
  }
});

test('continuing arrows retain previous row order ahead of compactness', () => {
  const items = [item('tt', [0, 1]), item('blue', [0, 1, 2])];
  const previousTops = new Map([['tt', 40], ['blue', 70]]);
  const result = packRow(items, days, { previousTops });
  check(items, result);
  assert.ok(result.find(p => p.id === 'tt').top < result.find(p => p.id === 'blue').top);
  // The opposite incoming order is also honored, independent of name order.
  const reversed = packRow(items, days, { previousTops: new Map([['tt', 70], ['blue', 40]]) });
  check(items, reversed);
  assert.ok(reversed.find(p => p.id === 'blue').top < reversed.find(p => p.id === 'tt').top);
});

test('explicit time order still wins over a conflicting continuation preference', () => {
  const items = [item('early', [0, 1], 28, false, true), item('late', [0, 1, 2], 28, false, true)];
  const result = packRow(items, days, { previousTops: new Map([['late', 40], ['early', 70]]) });
  check(items, result);
});

test('continuity baseline handles continuing arrows beyond the beam choices', () => {
  const items = Array.from({ length: 9 }, (_, i) => item(String(i), [0, 1]));
  const previousTops = new Map(items.map((event, i) => [event.id, (9 - i) * 30]));
  const result = packRow(items, days, { previousTops });
  check(items, result);
  assert.deepEqual(result.slice().sort((a, b) => a.top - b.top).map(p => p.id),
    items.map(i => i.id).reverse());
});

test('wrapped start reserves extra height only in its own column', () => {
  const wrapped = { ...item('wrapped', [0, 1, 2], 68), heights: { 0: 68, 1: 28, 2: 28 } };
  const items = [wrapped, item('below', [1, 2], 28, false, true), item('start-day', [0], 28, false, true)];
  const result = packRow(items, days);
  const byId = id => result.find(p => p.id === id);
  assert.equal(byId('below').top, byId('wrapped').top + 30);
  assert.equal(byId('start-day').top, byId('wrapped').top + 70);
  assert.equal(byId('wrapped').heights[1], 28);
});

test('date corner is reserved for actual crowding, and only on the crowded day', () => {
  const items = [item('short', [0], 28, true), item('another', [0]), item('sparse', [1], 28, true)];
  const spacious = packRow(items, days.map(day => ({ ...day, bottom: 150 })));
  assert.ok(spacious.every(p => !p.header));
  const crowded = packRow(items, days.map(day => ({ ...day, bottom: 80 })));
  assert.ok(crowded.find(p => p.id === 'short').header);
  assert.ok(!crowded.find(p => p.id === 'sparse').header);
  const lone = packRow([items[0]], days.map(day => ({ ...day, bottom: 50 })));
  assert.ok(!lone[0].header, 'A lone event stays below the date');
});
