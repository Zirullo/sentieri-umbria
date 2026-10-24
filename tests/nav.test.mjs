import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Track, bearing, haversine } from '../app/js/geo.js';
import { Guide } from '../app/js/nav.js';

// Spostamento di m metri verso nord/est da un punto.
const move = ([lat, lon], north, east) => [lat + north / 110540, lon + east / (111320 * Math.cos((lat * Math.PI) / 180))];

// Sentiero a L: 1 km verso est, poi 1 km verso nord.
const A = [43.0, 12.5];
const pts = [];
for (let i = 0; i <= 50; i++) pts.push([...move(A, 0, i * 20), 500]);
for (let i = 1; i <= 50; i++) pts.push([...move(A, i * 20, 1000), 500 + i * 4]);
const L_TRACK = new Track(pts);

test('lunghezza e punto più vicino', () => {
  assert.ok(Math.abs(L_TRACK.length - 2000) < 5, `lunghezza ${L_TRACK.length}`);
  const n = L_TRACK.nearest(...move(A, 15, 300));
  assert.ok(Math.abs(n.d - 15) < 1, `d=${n.d}`);
  assert.ok(Math.abs(n.s - 300) < 2, `s=${n.s}`);
});

test('avvicinamento → sul sentiero → fuori → rientro → arrivo', () => {
  const g = new Guide(L_TRACK);
  let r = g.update(...move(A, -200, -100), 8);
  assert.equal(r.mode, 'approach');
  assert.ok(r.distToTrack > 150);

  r = g.update(...move(A, 5, 100), 8);
  assert.equal(r.mode, 'on');
  // la freccia punta in avanti lungo la traccia (verso est)
  assert.ok(Math.abs(r.targetBearing - 90) < 20, `bearing ${r.targetBearing}`);

  // un solo fix a 40 m: ancora sul sentiero (isteresi anti falsi allarmi)
  r = g.update(...move(A, 40, 300), 8);
  assert.equal(r.mode, 'on');
  r = g.update(...move(A, 45, 320), 8);
  assert.equal(r.mode, 'off');
  // la freccia punta verso il sentiero (sud)
  assert.ok(Math.abs(r.targetBearing - 180) < 15, `bearing ${r.targetBearing}`);

  // a 25 m resta "fuori" finché non si scende sotto 20 m
  r = g.update(...move(A, 25, 330), 8);
  assert.equal(r.mode, 'off');
  r = g.update(...move(A, 8, 340), 8);
  assert.equal(r.mode, 'on');

  // si cammina fino a oltre la curva: la freccia punta a nord
  for (let e = 360; e <= 1000; e += 20) g.update(...move(A, 2, e), 8);
  for (let n = 20; n < 300; n += 20) g.update(...move(A, n, 1002), 8);
  r = g.update(...move(A, 300, 1003), 8);
  assert.equal(r.mode, 'on');
  assert.ok(r.targetBearing < 20 || r.targetBearing > 340, `bearing ${r.targetBearing}`);
  assert.ok(Math.abs(r.done - 1300) < 10, `done ${r.done}`);

  for (let n = 320; n <= 990; n += 20) r = g.update(...move(A, n, 1000), 8);
  assert.equal(r.mode, 'arrived');
});

test('un punto GPS anomalo vicino a un altro tratto non fa saltare la guida', () => {
  const g = new Guide(L_TRACK);
  for (let e = 0; e <= 900; e += 20) g.update(...move(A, 2, e), 8);
  // fix anomalo che cade sul tratto nord (s ≈ 1200)
  g.update(...move(A, 200, 990), 8);
  const r = g.update(...move(A, 2, 920), 8);
  assert.ok(Math.abs(r.done - 920) < 20, `done ${r.done}`);
});

test('interruzione GPS: un salto reale in avanti viene accettato dopo conferma', () => {
  const g = new Guide(L_TRACK);
  for (let e = 0; e <= 400; e += 20) g.update(...move(A, 2, e), 8);
  let r;
  for (const n of [300, 310, 320]) r = g.update(...move(A, n, 1001), 8);
  assert.ok(Math.abs(r.done - 1320) < 20, `done ${r.done}`);
});

test('GPS a risparmio energetico (un fix al minuto): la progressiva avanza comunque', () => {
  const g = new Guide(L_TRACK);
  let r;
  let t = 0;
  for (let e = 0; e <= 1000; e += 80) { // 80 m tra un fix e l'altro, uno ogni 60 s
    r = g.update(...move(A, 2, e), 8, t);
    t += 60000;
  }
  assert.ok(Math.abs(r.done - 960) < 20, `done ${r.done}`);
});

test('fuori sentiero immediato se molto lontano', () => {
  const g = new Guide(L_TRACK);
  g.update(...move(A, 0, 100), 8);
  const r = g.update(...move(A, 80, 120), 8);
  assert.equal(r.mode, 'off');
});

test('GPS impreciso non genera allarmi', () => {
  const g = new Guide(L_TRACK);
  g.update(...move(A, 0, 100), 8);
  g.update(...move(A, 70, 120), 120);
  const r = g.update(...move(A, 70, 130), 120);
  assert.equal(r.mode, 'on');
  assert.equal(r.weak, true);
});

test('andata e ritorno sullo stesso tracciato non fa saltare la progressiva', () => {
  const ob = [];
  for (let i = 0; i <= 50; i++) ob.push([...move(A, 0, i * 20), 500]);
  for (let i = 49; i >= 0; i--) ob.push([...move(A, 3, i * 20), 500]); // ritorno 3 m a fianco
  const tr = new Track(ob);
  const g = new Guide(tr);
  for (let e = 0; e <= 1000; e += 50) g.update(...move(A, 1, e), 5);
  // ora si torna indietro: la progressiva deve continuare a crescere (seconda metà)
  let r;
  for (let e = 950; e >= 500; e -= 50) r = g.update(...move(A, 2, e), 5);
  assert.ok(r.done > 1400, `done ${r.done}`);
  assert.equal(r.mode, 'on');
});

test('verso invertito', () => {
  const rev = L_TRACK.reversed();
  const g = new Guide(rev);
  const r = g.update(...move(A, 500, 1002), 8);
  assert.equal(r.mode, 'on');
  assert.ok(r.targetBearing > 160 && r.targetBearing < 200, `bearing ${r.targetBearing}`);
  assert.ok(Math.abs(r.done - 500) < 10);
});

test('anello: alla partenza non risulta già arrivato', () => {
  // quadrato di 4 km che torna al punto di partenza
  const sq = [];
  const corners = [[0, 0], [0, 1000], [1000, 1000], [1000, 0], [0, 0]];
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < 50; i++) {
      const [n0, e0] = corners[c];
      const [n1, e1] = corners[c + 1];
      sq.push([...move(A, n0 + ((n1 - n0) * i) / 50, e0 + ((e1 - e0) * i) / 50), 500]);
    }
  }
  sq.push([...A, 500]);
  const tr = new Track(sq);
  const g = new Guide(tr);
  let r = g.update(...move(A, -5, 3), 8);
  assert.equal(r.mode, 'on');
  assert.ok(r.done < 50, `done ${r.done}`);
  for (let s = 0; s < tr.length; s += 50) r = g.update(...tr.pointAt(s).slice(0, 2), 8);
  r = g.update(...move(A, -5, 3), 8);
  assert.equal(r.mode, 'arrived');
});

test('avvicinamento da lontano: la progressiva segue il punto in cui si entra davvero', () => {
  const g = new Guide(L_TRACK);
  g.update(...move(A, 800, 700), 8);           // lontano: il punto più vicino è sul tratto nord
  const r = g.update(...move(A, 4, 150), 8);   // si entra invece a 150 m dall'inizio
  assert.equal(r.mode, 'on');
  assert.ok(Math.abs(r.done - 150) < 10, `done ${r.done}`);
});

test('bearing e distanza di base', () => {
  assert.ok(Math.abs(bearing([43, 12], [44, 12])) < 0.01);
  assert.ok(Math.abs(haversine([43, 12], [43, 13]) - 81300) < 500);
});

// Generatore pseudo-casuale riproducibile e rumore gaussiano.
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function gauss(rand) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

test('rumore GPS nel bosco: nessun falso allarme su 20 sentieri reali', () => {
  const idx = JSON.parse(readFileSync(new URL('../app/data/index.json', import.meta.url)));
  const sample = idx.trails.filter((t) => t.cai && t.gaps === 0 && t.len > 3000).slice(0, 20);
  const rand = rng(42);
  let fixes = 0;
  let falseAlarms = 0;
  let maxErr = 0;
  for (const t of sample) {
    const d = JSON.parse(readFileSync(new URL(`../app/data/trails/${t.id}.json`, import.meta.url)));
    const tr = new Track(d.segments.flat());
    const g = new Guide(tr);
    for (let s = 0; s <= tr.length; s += 4) { // ~1 fix al secondo camminando
      const p = tr.pointAt(s);
      let n = gauss(rand) * 8;
      let e = gauss(rand) * 8;
      if (rand() < 0.01) { n += 30; e += 15; } // salto occasionale (riflessi, canyon)
      const r = g.update(...move(p, n, e), 12);
      fixes++;
      if (r.mode === 'off') falseAlarms++;
      if (r.mode === 'on') maxErr = Math.max(maxErr, Math.abs(r.done - Math.min(s, tr.length)));
    }
  }
  assert.ok(fixes > 5000, `fix ${fixes}`);
  assert.ok(maxErr < 120, `errore progressiva ${Math.round(maxErr)} m`);
  assert.ok(falseAlarms / fixes < 0.002, `falsi allarmi ${falseAlarms} su ${fixes}`);
});

test('sentiero reale: camminata simulata con deviazione', () => {
  const idx = JSON.parse(readFileSync(new URL('../app/data/index.json', import.meta.url)));
  const t = idx.trails.find((x) => x.ref === '501' && x.cai) || idx.trails.find((x) => x.cai && x.gaps === 0 && x.len > 5000);
  const d = JSON.parse(readFileSync(new URL(`../app/data/trails/${t.id}.json`, import.meta.url)));
  const tr = new Track(d.segments.flat());
  const g = new Guide(tr);
  let offSeen = false;
  let last;
  for (let s = 0; s <= tr.length; s += 15) {
    const p = tr.pointAt(s);
    // tra 40% e 45% del percorso ci si allontana di 60 m verso est
    const dev = s > tr.length * 0.4 && s < tr.length * 0.45 ? 60 : 3;
    last = g.update(...move(p, 0, dev), 8);
    if (last.mode === 'off') offSeen = true;
  }
  assert.ok(offSeen, 'la deviazione deve essere segnalata');
  assert.equal(last.mode, 'arrived');
});
