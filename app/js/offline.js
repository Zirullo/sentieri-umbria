// Scaricamento della mappa e della traccia di un sentiero per l'uso senza rete.
import { latToTileY, lonToTileX } from './geo.js';

export const TILE_CACHE = 'tiles-v1';
export const TRAIL_CACHE = 'trails-v1';
export const TILE_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
export const MAX_NATIVE_ZOOM = 16;
const BBOX_ZOOMS = [10, 11, 12, 13];   // panoramica: tutto il riquadro del sentiero
// dettaglio: corridoio attorno alla traccia, più largo ai livelli meno dettagliati,
// così anche chi si allontana parecchio ha ancora una mappa per orientarsi
const CORRIDOR_M = { 14: 2000, 15: 1000, 16: 500 };
const BBOX_PAD_M = 3000;
const CONCURRENCY = 4;
const REGISTRY_KEY = 'offline-trails';

// Chiave unica in cache, indipendente dal sottodominio a/b/c.
export const tileKey = (z, x, y) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`;
const tileUrl = (z, x, y) => `https://${'abc'[(x + y) % 3]}.tile.opentopomap.org/${z}/${x}/${y}.png`;

function padBox(lat, lon, m) {
  const dLat = m / 110540;
  const dLon = m / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

function addBox(set, z, [s, w, n, e]) {
  const x0 = lonToTileX(w, z);
  const x1 = lonToTileX(e, z);
  const y0 = latToTileY(n, z);
  const y1 = latToTileY(s, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set.add(`${z}/${x}/${y}`);
}

// Elenco dei riquadri "z/x/y" necessari per un sentiero (punti già densificati ≤ 40 m).
export function tilesFor(trail) {
  const set = new Set();
  const [s, w, n, e] = trail.bbox;
  const a = padBox(s, w, BBOX_PAD_M);
  const b = padBox(n, e, BBOX_PAD_M);
  for (const z of BBOX_ZOOMS) addBox(set, z, [a[0], a[1], b[2], b[3]]);
  const pts = [...trail.segments.flat(), ...(trail.extras || []).flatMap((x) => x.pts)];
  for (const [z, m] of Object.entries(CORRIDOR_M)) {
    // un punto ogni ~quarto di riquadro basta a coprire il corridoio
    const stride = Math.max(1, Math.floor(m / 4 / 40));
    for (let i = 0; i < pts.length; i += stride) addBox(set, +z, padBox(pts[i][0], pts[i][1], m));
    const last = pts[pts.length - 1];
    addBox(set, +z, padBox(last[0], last[1], m));
  }
  return [...set];
}

export function registry() {
  try { return JSON.parse(localStorage.getItem(REGISTRY_KEY)) || {}; } catch { return {}; }
}
function saveRegistry(r) {
  try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(r)); } catch { /* spazio esaurito: il registro resta in memoria */ }
}
export const isDownloaded = (id) => !!registry()[id]?.complete;

export async function downloadTrail(trail, trailUrl, onProgress, signal) {
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if (trailUrl) { // i sentieri personali non hanno un file sul server
    const trailCache = await caches.open(TRAIL_CACHE);
    const res = await fetch(trailUrl);
    if (!res.ok) throw new Error(`traccia: HTTP ${res.status}`);
    await trailCache.put(new URL(trailUrl, location.href).href, res);
  }

  const tiles = tilesFor(trail);
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  let failed = 0;
  let bytes = 0;
  const queue = [...tiles];
  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) throw new DOMException('annullato', 'AbortError');
      const t = queue.shift();
      const [z, x, y] = t.split('/').map(Number);
      const key = tileKey(z, x, y);
      if (!(await cache.match(key))) {
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            const r = await fetch(tileUrl(z, x, y), { signal, mode: 'cors' });
            if (r.ok) {
              const blob = await r.blob();
              bytes += blob.size;
              await cache.put(key, new Response(blob, { headers: { 'Content-Type': 'image/png' } }));
              ok = true;
            }
          } catch (err) {
            if (err.name === 'AbortError') throw err;
          }
          if (!ok) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
        if (!ok) failed++;
      }
      done++;
      onProgress?.(done, tiles.length, failed);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const r = registry();
  r[trail.id] = { tiles, failed, bytes, date: new Date().toISOString(), complete: failed === 0, name: trail.name, ref: trail.ref };
  saveRegistry(r);
  return { total: tiles.length, failed, bytes };
}

export async function deleteTrail(id, trailUrl) {
  const r = registry();
  const mine = r[id]?.tiles || [];
  delete r[id];
  const stillUsed = new Set(Object.values(r).flatMap((v) => v.tiles || []));
  const cache = await caches.open(TILE_CACHE);
  await Promise.all(mine.filter((t) => !stillUsed.has(t)).map((t) => {
    const [z, x, y] = t.split('/').map(Number);
    return cache.delete(tileKey(z, x, y));
  }));
  if (trailUrl) await (await caches.open(TRAIL_CACHE)).delete(new URL(trailUrl, location.href).href);
  saveRegistry(r);
}

// Quando i dati vengono rigenerati, le tracce già in cache vanno aggiornate per restare coerenti con l'indice.
export async function syncDataVersion(version) {
  const KEY = 'data-version';
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch { return; }
  if (!version || stored === version) return;
  if (stored && navigator.onLine) {
    const cache = await caches.open(TRAIL_CACHE);
    for (const req of await cache.keys()) {
      try {
        const res = await fetch(req.url, { cache: 'no-store' });
        if (res.ok) await cache.put(req.url, res);
        else if (res.status === 404) await cache.delete(req.url); // sentiero rimosso da OSM
      } catch {
        return; // rete caduta: riprova al prossimo avvio
      }
    }
  } else if (stored) {
    return; // offline: aggiorna quando torna la rete
  }
  try { localStorage.setItem(KEY, version); } catch { /* ignorato */ }
}
