// Service worker comune alle due app: piedi/sw.js e bici/sw.js impostano self.APP e importano questo file.
// Le app stanno sullo stesso sito, quindi le cache hanno nomi distinti:
//   APP.prefix  cache di mappe e tracce (a piedi vuoto: restano quelle scaricate prima del trasloco in piedi/)
//   APP.shell   cache dei file dell'app
//   APP.shared  percorso dei file comuni (../)
const APP = self.APP;
const VERSION = 'v1';
const SHELL_CACHE = `${APP.shell}shell-${VERSION}`;
const TRAIL_CACHE = `${APP.prefix}trails-v1`;      // nomi uguali a quelli di js/offline.js
const TILE_CACHE = `${APP.prefix}tiles-v1`;        // riquadri scaricati esplicitamente
const SEEN_CACHE = `${APP.prefix}tiles-seen-v1`;   // riquadri visti navigando online (limitati)
const SEEN_MAX = 2500;

// file propri di ciascuna app (nella sua cartella) e file comuni (nella cartella principale)
const OWN = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'data/index.json'];
const SHARED = [
  'css/app.css',
  'js/app.js', 'js/geo.js', 'js/nav.js', 'js/compass.js', 'js/offline.js', 'js/plan.js', 'js/profile.js', 'js/custom.js',
  'js/filters.js', 'js/basemap.js', 'js/config.js', 'js/alert.js', 'js/i18n.js', 'js/en.js', 'js/de.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
];
const SHELL = [...OWN, ...SHARED.map((f) => APP.shared + f)];

self.addEventListener('install', (e) => {
  // cache: 'reload' scavalca la cache HTTP (GitHub Pages la tiene 10 minuti), altrimenti si precaricherebbero file vecchi
  e.waitUntil(caches.open(SHELL_CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(`${APP.shell}shell-`) && k !== SHELL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const tileMatch = /^https:\/\/[abc]\.tile\.opentopomap\.org\/(\d+)\/(\d+)\/(\d+)\.png$/;

async function trimSeen() {
  const c = await caches.open(SEEN_CACHE);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - SEEN_MAX; i++) await c.delete(keys[i]);
}

async function tile(req, key) {
  const hit = (await caches.match(key, { cacheName: TILE_CACHE })) || (await caches.match(key, { cacheName: SEEN_CACHE }));
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const c = await caches.open(SEEN_CACHE);
    c.put(key, res.clone()).then(() => (Math.random() < 0.02 ? trimSeen() : null));
  }
  return res;
}

async function trail(req) {
  const c = await caches.open(TRAIL_CACHE);
  // le tracce scaricate quando l'app a piedi stava nella cartella principale hanno l'indirizzo senza /piedi
  const hit = (await c.match(req.url)) || (await c.match(req.url.replace('/piedi/data/', '/data/')));
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req.url, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const c = await caches.open(SHELL_CACHE);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || new Response('offline', { status: 503 });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const m = tileMatch.exec(req.url);
  if (m) {
    e.respondWith(tile(req, `https://tile.opentopomap.org/${m[1]}/${m[2]}/${m[3]}.png`));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/data/trails/')) {
    e.respondWith(trail(req));
    return;
  }
  e.respondWith(staleWhileRevalidate(req));
});
