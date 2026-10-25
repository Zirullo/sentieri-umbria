import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_FILTERS, activeCount, isLoop, matches } from '../app/js/filters.js';

const base = { cai: true, scale: 'E', len: 8000, up: 500, start: [43, 12.5], end: [43.05, 12.5] };
const f = (o) => ({ ...NO_FILTERS, ...o });

test('senza filtri passa tutto', () => {
  assert.ok(matches(base, NO_FILTERS, 3));
  assert.equal(activeCount(NO_FILTERS), 0);
});

test('difficoltà, durata, salita, CAI', () => {
  assert.ok(matches(base, f({ scales: ['T', 'E'] }), 3));
  assert.ok(!matches(base, f({ scales: ['EE'] }), 3));
  assert.ok(!matches({ ...base, scale: null }, f({ scales: ['E'] }), 3));
  assert.ok(matches(base, f({ dur: 2 }), 2));    // 2–4 h, estremo incluso
  assert.ok(!matches(base, f({ dur: 2 }), 4));   // 4 h appartiene a 4–6 h
  assert.ok(!matches(base, f({ dur: 1 }), 3));
  assert.ok(matches(base, f({ climb: 2 }), 3));  // fino a 600 m
  assert.ok(!matches(base, f({ climb: 1 }), 3)); // fino a 300 m
  assert.ok(!matches({ ...base, up: null }, f({ climb: 3 }), 3));
  assert.ok(!matches({ ...base, cai: false }, f({ cai: true }), 3));
  assert.equal(activeCount(f({ scales: ['E', 'T'], dur: 1, loop: true })), 3);
});

test('anelli e sentieri personali', () => {
  const ring = { ...base, end: [43.0005, 12.5] };
  assert.ok(isLoop(ring));
  assert.ok(!isLoop(base));
  assert.ok(isLoop({ ...base, tags: { roundtrip: 'yes' } }));
  assert.ok(matches(ring, f({ loop: true }), 3));
  assert.ok(!matches(base, f({ loop: true }), 3));
  assert.ok(matches({ ...base, custom: true, cai: false }, f({ cai: true, loop: true }), 3));
});
