import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SECTOR_ORDER } from '../app/js/config.js';
import { DICTS, LANGS, tr } from '../app/js/i18n.js';

const app = new URL('../app/', import.meta.url);
const read = (f) => readFileSync(new URL(f, app), 'utf8');
const DICT_FILES = Object.keys(LANGS).filter((l) => l !== 'it').map((l) => `${l}.js`);
const JS = readdirSync(new URL('js/', app)).filter((f) => !DICT_FILES.includes(f)).map((f) => [f, read(`js/${f}`)]);
const PAGES = ['piedi/index.html', 'bici/index.html'];
const FOREIGN = Object.entries(DICTS).filter(([l]) => l !== 'it');

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

// tutte le frasi di una voce: stringa, varianti piedi/bici, forme del plurale
const variants = (v) => (typeof v === 'string' ? [v] : Object.values(v).flatMap(variants));

test('ogni lingua ha un dizionario e ogni frase dell\'interfaccia la sua traduzione', () => {
  assert.deepEqual(Object.keys(DICTS).sort(), Object.keys(LANGS).sort());
  const all = phrases();
  assert.ok(all.size > 100);
  // a piedi i gruppi dell'elenco sono nomi di luogo (restano uguali), gli altri si traducono
  const sectors = SECTOR_ORDER.filter((s) => !/^(Alto|Valle|Val|Amerino|Orvietano|Perugino)/.test(s));
  const BIKE_SECTORS = ['Ciclovie', 'Mountain bike', 'Itinerari a tappe', 'Regioni confinanti'];
  for (const [lang, dict] of FOREIGN) {
    const missing = [...all, ...sectors, ...BIKE_SECTORS].filter((k) => !dict[k]);
    assert.deepEqual(missing, [], `${lang}: frasi senza traduzione`);
  }
});

test('nessuna traduzione inutilizzata', () => {
  const all = phrases();
  const code = JS.map(([, s]) => s).join('\n');
  // le chiavi usate solo come valori nei dati (gruppi dell'elenco) compaiono come stringhe nel codice
  for (const [lang, dict] of Object.entries(DICTS)) {
    const unused = Object.keys(dict).filter((k) => !all.has(k) && !code.includes(`'${k}'`));
    assert.deepEqual(unused, [], `${lang}: voci inutilizzate`);
  }
});

test('frasi fisse: tr() non riceve testo costruito con ${…}, segnaposto e numeri coincidono', () => {
  for (const [f, s] of JS) assert.doesNotMatch(s, /\btr\(`/, `${f}: tr() con un template, la frase non si troverebbe nel dizionario`);
  // {one} {many} {One} {Many} si possono scambiare (in inglese "Nessun {one}" è "No {many}"), gli altri no;
  // nelle forme del plurale {n} può mancare (in tedesco "ein Filter")
  const slots = (x) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !/^(one|many|n)$/i.test(k)).sort().join();
  const nums = (x) => (x.match(/\d+/g) || []).join();
  for (const [lang, dict] of Object.entries(DICTS)) {
    for (const [it, v] of Object.entries(dict)) {
      for (const x of variants(v)) {
        assert.equal(slots(x), slots(it), `${lang}: segnaposto diversi in «${it}»`);
        // i numeri delle frasi (10%, 1 interruzione…) devono restare gli stessi
        assert.equal(nums(x), nums(it), `${lang}: numeri diversi in «${it}»`);
      }
      if (typeof v === 'object' && !('piedi' in v)) assert.ok(v.other, `${lang}: plurale senza «other» in «${it}»`);
    }
  }
});

test('fuori dal browser l\'interfaccia resta in italiano, con le parole della versione e i plurali', () => {
  assert.equal(tr('Nessun {one} trovato'), 'Nessun sentiero trovato');
  assert.equal(tr('{d} da te', { d: '2 km' }), '2 km da te');
  assert.equal(tr('{n} filtri attivi', { n: 1 }), '1 filtro attivo');
  assert.equal(tr('{n} filtri attivi', { n: 3 }), '3 filtri attivi');
});
