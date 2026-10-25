// Filtri per scegliere il percorso. Valgono per la mappa e per l'elenco; i percorsi personali restano sempre visibili.
// Tre tipi di gruppo: multi (più scelte insieme, nessuna = tutti), one (una fascia, la prima = qualsiasi), check.
// Lo stato salvato è { chiave: [indici] | indice | true/false }.
import { haversine } from './geo.js';
import { BIKE, KEY_PREFIX, W } from './config.js';

const KEY = `${KEY_PREFIX}filters`;

// Anello: si torna al punto di partenza (dichiarato in OSM o estremi vicini).
export const isLoop = (t) => t.tags?.roundtrip === 'yes' || haversine(t.start, t.end) < Math.min(150, t.len / 10);

const opt = (label, test) => ({ label, test });
const any = opt('Qualsiasi', () => true);
const upTo = (m) => opt(`≤ ${m} m`, (t) => t.up != null && t.up <= m);
const hours = (lo, hi, label) => opt(label, (t, h) => h >= lo && h < hi);
const km = (lo, hi, label) => opt(label, (t) => t.len >= lo * 1000 && t.len < hi * 1000);
const scales = (list) => list.map(([s, label]) => opt(`<b>${s}</b> ${label}`, (t) => t.scale === s));
const loop = { key: 'loop', type: 'check', label: 'Solo anelli (torni alla partenza)', test: isLoop };

export const HIKE_FILTERS = [
  { key: 'scales', type: 'multi', title: 'Difficoltà', options: scales([['T', 'turistico'], ['E', 'escursionistico'], ['EE', 'esperti'], ['EEA', 'attrezzato']]) },
  { key: 'dur', type: 'one', title: 'Durata stimata', options: [any, hours(0, 2, '≤ 2 h'), hours(2, 4, '2–4 h'), hours(4, 6, '4–6 h'), hours(6, Infinity, '> 6 h')] },
  { key: 'climb', type: 'one', title: 'Salita totale', options: [any, upTo(300), upTo(600), upTo(1000)] },
  loop,
  { key: 'cai', type: 'check', label: `Solo ${W.many} CAI`, test: (t) => t.cai },
];

export const BIKE_FILTERS = [
  { key: 'kinds', type: 'multi', title: 'Tipo', options: [opt('<b>Ciclovia</b>', (t) => t.kind === 'road'), opt('<b>MTB</b>', (t) => t.kind === 'mtb')] },
  { key: 'scales', type: 'multi', title: 'Difficoltà MTB (scala CAI)', options: scales([['TC', 'turistico'], ['MC', 'media'], ['BC', 'buona'], ['OC', 'ottima'], ['EC', 'eccellente']]) },
  { key: 'len', type: 'one', title: 'Lunghezza', options: [any, km(0, 20, '≤ 20 km'), km(20, 50, '20–50 km'), km(50, 100, '50–100 km'), km(100, Infinity, '> 100 km')] },
  { key: 'climb', type: 'one', title: 'Salita totale', options: [any, upTo(500), upTo(1000), upTo(2000)] },
  loop,
];

export const FILTERS = BIKE ? BIKE_FILTERS : HIKE_FILTERS;

export const noFilters = (groups = FILTERS) =>
  Object.fromEntries(groups.map((g) => [g.key, g.type === 'multi' ? [] : g.type === 'one' ? 0 : false]));

// h: durata stimata in ore, che dipende dal verso e dai dati CAI e quindi la calcola chi chiama.
export function matches(t, f, h, groups = FILTERS) {
  if (t.custom) return true;
  for (const g of groups) {
    const v = f[g.key];
    if (g.type === 'multi' && v.length && !v.some((i) => g.options[i].test(t, h))) return false;
    if (g.type === 'one' && v && !g.options[v].test(t, h)) return false;
    if (g.type === 'check' && v && !g.test(t, h)) return false;
  }
  return true;
}

export const activeCount = (f, groups = FILTERS) =>
  groups.filter((g) => (g.type === 'multi' ? f[g.key].length : f[g.key])).length;

// Stato salvato, ripulito da valori non validi (ad esempio dopo un cambio dei filtri disponibili).
export function loadFilters(groups = FILTERS) {
  const f = noFilters(groups);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* nessun filtro salvato */ }
  for (const g of groups) {
    const v = saved[g.key];
    const ok = (i) => Number.isInteger(i) && i >= 0 && i < g.options?.length;
    if (g.type === 'multi' && Array.isArray(v) && v.every(ok)) f[g.key] = v;
    if (g.type === 'one' && ok(v)) f[g.key] = v;
    if (g.type === 'check' && typeof v === 'boolean') f[g.key] = v;
  }
  return f;
}

export function saveFilters(f) {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* ignorato */ }
}
