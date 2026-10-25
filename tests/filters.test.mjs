import test from 'node:test';
import assert from 'node:assert/strict';
import { BIKE_FILTERS, HIKE_FILTERS, activeCount, isLoop, matches, noFilters } from '../app/js/filters.js';

const base = { cai: true, scale: 'E', len: 8000, up: 500, start: [43, 12.5], end: [43.05, 12.5] };
const H = HIKE_FILTERS;
const f = (o, groups = H) => ({ ...noFilters(groups), ...o });
const ok = (t, filt, h = 3, groups = H) => matches(t, filt, h, groups);

test('senza filtri passa tutto', () => {
  assert.ok(ok(base, noFilters(H)));
  assert.equal(activeCount(noFilters(H), H), 0);
});

test('a piedi: difficoltà, durata, salita, CAI', () => {
  assert.ok(ok(base, f({ scales: [0, 1] })));   // T o E
  assert.ok(!ok(base, f({ scales: [2] })));     // EE
  assert.ok(!ok({ ...base, scale: '' }, f({ scales: [1] })));
  assert.ok(ok(base, f({ dur: 2 }), 2));        // 2–4 h, estremo incluso
  assert.ok(!ok(base, f({ dur: 2 }), 4));       // 4 h appartiene a 4–6 h
  assert.ok(!ok(base, f({ dur: 1 }), 3));
  assert.ok(ok(base, f({ climb: 2 })));         // ≤ 600 m
  assert.ok(!ok(base, f({ climb: 1 })));        // ≤ 300 m
  assert.ok(!ok({ ...base, up: null }, f({ climb: 3 })));
  assert.ok(!ok({ ...base, cai: false }, f({ cai: true })));
  assert.equal(activeCount(f({ scales: [1, 0], dur: 1, loop: true }), H), 3);
});

test('in bici: tipo, difficoltà MTB, lunghezza', () => {
  const B = BIKE_FILTERS;
  const road = { ...base, kind: 'road', scale: '', len: 45000 };
  const mtb = { ...base, kind: 'mtb', scale: 'MC', len: 25000, up: 900 };
  assert.ok(ok(road, f({ kinds: [0] }, B), 3, B));
  assert.ok(!ok(mtb, f({ kinds: [0] }, B), 3, B));
  assert.ok(ok(mtb, f({ scales: [1] }, B), 3, B));   // MC
  assert.ok(!ok(road, f({ scales: [1] }, B), 3, B)); // ciclovia senza scala MTB
  assert.ok(ok(road, f({ len: 2 }, B), 3, B));       // 20–50 km
  assert.ok(!ok(road, f({ len: 1 }, B), 3, B));      // ≤ 20 km
  assert.ok(ok(mtb, f({ climb: 2 }, B), 3, B));      // ≤ 1000 m
  assert.ok(!ok(mtb, f({ climb: 1 }, B), 3, B));     // ≤ 500 m
});

test('strade principali: al massimo il 10% del percorso, in entrambe le versioni', () => {
  for (const groups of [H, BIKE_FILTERS]) {
    const q = f({ quiet: true }, groups);
    assert.ok(ok({ ...base, kind: 'road', main: 0.1 }, q, 3, groups));
    assert.ok(!ok({ ...base, kind: 'road', main: 0.11 }, q, 3, groups));
    assert.ok(!ok({ ...base, kind: 'road', main: null }, q, 3, groups)); // strade non note: escluso
  }
});

test('anelli e percorsi personali', () => {
  const ring = { ...base, end: [43.0005, 12.5] };
  assert.ok(isLoop(ring));
  assert.ok(!isLoop(base));
  assert.ok(isLoop({ ...base, tags: { roundtrip: 'yes' } }));
  assert.ok(ok(ring, f({ loop: true })));
  assert.ok(!ok(base, f({ loop: true })));
  assert.ok(ok({ ...base, custom: true, cai: false }, f({ cai: true, loop: true })));
});
