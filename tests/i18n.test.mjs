import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { EN } from '../app/js/en.js';
import { SECTOR_ORDER } from '../app/js/config.js';
import { tr } from '../app/js/i18n.js';

const app = new URL('../app/', import.meta.url);
const read = (f) => readFileSync(new URL(f, app), 'utf8');
const JS = readdirSync(new URL('js/', app)).filter((f) => f !== 'en.js').map((f) => [f, read(`js/${f}`)]);
const PAGES = ['piedi/index.html', 'bici/index.html'];

// Frasi passate a tr() come testo fisso nel codice, più i testi fissi delle pagine.
function phrases() {
  const out = new Set();
  for (const [, s] of JS) {
    for (const m of s.matchAll(/\btr\((?:'((?:[^'\\]|\\.)*)'|"([^"]*)")/g)) out.add((m[1] ?? m[2]).replace(/\\'/g, "'"));
  }
  for (const p of PAGES) {
    const s = read(p);
    for (const m of s.matchAll(/data-tr>([^<]*)</g)) out.add(m[1].trim());
    for (const m of s.matchAll(/(?:aria-label|placeholder)="([^"]*)"/g)) out.add(m[1]);
  }
  return out;
}

test('ogni frase dell\'interfaccia ha la traduzione inglese', () => {
  const all = phrases();
  assert.ok(all.size > 100);
  // a piedi i gruppi dell'elenco sono nomi di luogo (restano uguali), gli altri si traducono
  const sectors = SECTOR_ORDER.filter((s) => !/^(Alto|Valle|Val|Amerino|Orvietano|Perugino)/.test(s));
  const BIKE_SECTORS = ['Ciclovie', 'Mountain bike', 'Itinerari a tappe', 'Regioni confinanti'];
  const missing = [...all, ...sectors, ...BIKE_SECTORS].filter((k) => !EN[k]);
  assert.deepEqual(missing, []);
});

test('nessuna traduzione inutilizzata', () => {
  const all = phrases();
  const code = JS.map(([, s]) => s).join('\n');
  // le chiavi usate solo come valori nei dati (gruppi dell'elenco) compaiono come stringhe nel codice
  const unused = Object.keys(EN).filter((k) => !all.has(k) && !code.includes(`'${k}'`));
  assert.deepEqual(unused, []);
});

test('frasi fisse: tr() non riceve testo costruito con ${…}, i segnaposto coincidono', () => {
  for (const [f, s] of JS) assert.doesNotMatch(s, /\btr\(`/, `${f}: tr() con un template, la frase non si troverebbe nel dizionario`);
  // {one} {many} {One} {Many} si possono scambiare (in inglese "Nessun {one}" è "No {many}"), gli altri no
  const slots = (x) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !/^(one|many)$/i.test(k)).sort().join();
  for (const [it, en] of Object.entries(EN)) assert.equal(slots(en), slots(it), `segnaposto diversi: ${it}`);
  // i numeri delle frasi (10%, 1 interruzione…) devono restare gli stessi
  const nums = (x) => (x.match(/\d+/g) || []).join();
  for (const [it, en] of Object.entries(EN)) assert.equal(nums(en), nums(it), `numeri diversi: ${it}`);
});

test('fuori dal browser l\'interfaccia resta in italiano, con le parole della versione', () => {
  assert.equal(tr('Nessun {one} trovato'), 'Nessun sentiero trovato');
  assert.equal(tr('{d} da te', { d: '2 km' }), '2 km da te');
});
