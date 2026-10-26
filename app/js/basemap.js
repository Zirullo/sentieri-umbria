// Sfondo della mappa: topografica, satellite o stradale. La scelta vale per tutte le mappe e resta sul telefono.
// La topografica rimane sempre sotto: è l'unica scaricata per l'offline, così senza rete,
// al posto del satellite o della stradale, si vede comunque quella.
import { KEY_PREFIX } from './config.js';
import { tr } from './i18n.js';

const KEY = `${KEY_PREFIX}basemap`;
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

export const BASEMAPS = {
  topo: { label: tr('Topografica'), layers: () => [] },
  sat: {
    label: 'Satellite',
    layers: () => [
      L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 18, maxZoom: 18, zIndex: 2, attribution: tr('Immagini © Esri, Maxar, Earthstar Geographics') }),
      // nomi di paesi e località sopra le immagini
      L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 18, maxZoom: 18, zIndex: 3 }),
    ],
  },
  road: {
    label: tr('Stradale'),
    layers: () => [L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 18, zIndex: 2, attribution: '© OpenStreetMap' })],
  },
};

let current = 'topo';
try { if (BASEMAPS[localStorage.getItem(KEY)]) current = localStorage.getItem(KEY); } catch { /* ignorato */ }
const maps = [];

function apply(e) {
  for (const l of e.extra) l.remove();
  e.extra = BASEMAPS[current].layers();
  for (const l of e.extra) l.addTo(e.map);
}

export const currentBase = () => current;

export function addBaseMap(map) {
  const e = { map, extra: [] };
  maps.push(e);
  apply(e);
}

export function setBase(kind) {
  if (!BASEMAPS[kind] || kind === current) return;
  current = kind;
  try { localStorage.setItem(KEY, kind); } catch { /* ignorato */ }
  maps.forEach(apply);
}
