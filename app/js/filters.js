// Filtri per scegliere il sentiero: difficoltà, durata, salita, anelli, solo CAI.
// Valgono per la mappa e per l'elenco; i sentieri personali restano sempre visibili.
import { haversine } from './geo.js';

const KEY = 'filters';

export const SCALES = { T: 'turistico', E: 'escursionistico', EE: 'esperti', EEA: 'attrezzato' };
// [da ore, fino a ore, etichetta]
export const DURATIONS = [[0, Infinity, 'Qualsiasi'], [0, 2, '≤ 2 h'], [2, 4, '2–4 h'], [4, 6, '4–6 h'], [6, Infinity, '> 6 h']];
// [salita massima in metri, etichetta]
export const CLIMBS = [[Infinity, 'Qualsiasi'], [300, '≤ 300 m'], [600, '≤ 600 m'], [1000, '≤ 1000 m']];

export const NO_FILTERS = { scales: [], dur: 0, climb: 0, loop: false, cai: false };

// Anello: si torna al punto di partenza (dichiarato in OSM o estremi vicini).
export const isLoop = (t) => t.tags?.roundtrip === 'yes' || haversine(t.start, t.end) < Math.min(150, t.len / 10);

export function matches(t, f, hours) {
  if (t.custom) return true;
  if (f.cai && !t.cai) return false;
  if (f.scales.length && !f.scales.includes(t.scale)) return false;
  if (f.dur) {
    const [lo, hi] = DURATIONS[f.dur];
    if (hours < lo || hours >= hi) return false;
  }
  if (f.climb && !(t.up != null && t.up <= CLIMBS[f.climb][0])) return false;
  if (f.loop && !isLoop(t)) return false;
  return true;
}

export const activeCount = (f) => (f.scales.length ? 1 : 0) + (f.dur ? 1 : 0) + (f.climb ? 1 : 0) + (f.loop ? 1 : 0) + (f.cai ? 1 : 0);

export function loadFilters() {
  try {
    const f = { ...NO_FILTERS, ...JSON.parse(localStorage.getItem(KEY)) };
    if (!Array.isArray(f.scales) || !DURATIONS[f.dur] || !CLIMBS[f.climb]) return { ...NO_FILTERS };
    return f;
  } catch { return { ...NO_FILTERS }; }
}

export function saveFilters(f) {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* ignorato */ }
}
