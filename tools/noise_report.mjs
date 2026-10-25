// Misura falsi allarmi e precisione della guida con rumore GPS simulato su sentieri reali.
// Uso: node tools/noise_report.mjs [numero_sentieri]
import { readFileSync } from 'node:fs';
import { Track } from '../app/js/geo.js';
import { Guide } from '../app/js/nav.js';

const data = new URL('../app/piedi/data/', import.meta.url);
const move = ([lat, lon], n, e) => [lat + n / 110540, lon + e / (111320 * Math.cos((lat * Math.PI) / 180))];
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const limit = Number(process.argv[2] || 120);
const idx = JSON.parse(readFileSync(new URL('index.json', data)));
const sample = idx.trails.filter((t) => t.cai && t.len > 2000).slice(0, limit);

for (const sigma of [5, 8, 12]) {
  let fixes = 0, off = 0, arrived = 0, maxErr = 0;
  const t0 = Date.now();
  for (const t of sample) {
    const d = JSON.parse(readFileSync(new URL(`trails/${t.id}.json`, data)));
    const tr = new Track(d.segments.flat());
    const g = new Guide(tr);
    let r;
    for (let s = 0; s <= tr.length + 10; s += 4) {
      const p = tr.pointAt(s);
      let a = gauss() * sigma;
      let b = gauss() * sigma;
      if (rand() < 0.01) { a += 30; b += 15; }
      r = g.update(...move(p, a, b), sigma * 1.5);
      fixes++;
      if (r.mode === 'off') off++;
      else if (r.mode === 'on') maxErr = Math.max(maxErr, Math.abs(r.done - Math.min(s, tr.length)));
    }
    if (r.mode === 'arrived') arrived++;
  }
  const ms = (Date.now() - t0) / fixes;
  console.log(`σ=${sigma} m: ${sample.length} sentieri, ${fixes} fix, falsi allarmi ${off} (${((100 * off) / fixes).toFixed(3)}%), `
    + `arrivi ${arrived}/${sample.length}, errore max progressiva ${Math.round(maxErr)} m, ${ms.toFixed(3)} ms/fix`);
}
