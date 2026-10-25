// Sentieri personali: salvati solo su questo telefono, aggiunti da un link
//   https://…/sentieri-umbria/piedi/#sentiero=Nome|lat,lon;lat,lon;…
//   https://…/sentieri-umbria/bici/#percorso=Nome|lat,lon;…   (versione in bici)
// La parte dopo # non viene mai inviata al server, quindi le coordinate restano private.
import { haversine } from './geo.js';
import { BIKE, KEY_PREFIX, W } from './config.js';

const KEY = `${KEY_PREFIX}custom-trails`;
export const CUSTOM_SECTOR = `${W.Many} personali`;

function idFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) | 0;
  return -Math.abs(h || 1); // id negativi: mai in conflitto con le relazioni OSM
}

export function makeTrail(name, pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += haversine(pts[i - 1], pts[i]);
  const lats = pts.map((p) => p[0]);
  const lons = pts.map((p) => p[1]);
  return {
    id: idFor(name),
    custom: true,
    ref: '★',
    name,
    from: '',
    to: '',
    sector: CUSTOM_SECTOR,
    scale: BIKE ? '' : 'T',
    kind: BIKE ? 'road' : undefined,
    cai: false,
    len: Math.round(len),
    up: null,
    down: null,
    bbox: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)],
    start: pts[0],
    end: pts[pts.length - 1],
    gaps: 0,
    geom: [pts],
    tags: {},
    segments: [pts.map((p) => [p[0], p[1], null])],
    extras: [],
  };
}

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* spazio esaurito */ }
}

export const loadCustom = () => read().map(({ name, pts }) => makeTrail(name, pts));

export function removeCustom(name) {
  write(read().filter((t) => t.name !== name));
}

// Legge un sentiero dall'indirizzo, lo salva e ripulisce l'indirizzo. Restituisce il nome o null.
export function importFromHash() {
  const m = /^#(?:sentiero|percorso)=([^|]+)\|(.+)$/.exec(decodeURIComponent(location.hash));
  if (!m) return null;
  const name = m[1].trim().slice(0, 60);
  const pts = m[2].split(';').map((p) => p.split(',').map(Number)).filter((p) => p.length === 2
    && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 && p.every(Number.isFinite));
  history.replaceState(null, '', location.pathname + location.search);
  if (!name || pts.length < 2) return null;
  write([...read().filter((t) => t.name !== name), { name, pts }]);
  return name;
}
