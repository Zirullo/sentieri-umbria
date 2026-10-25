// Fino all'ottobre 2026 l'app a piedi stava nella cartella principale, con questo service worker.
// Ora le app stanno in piedi/ e bici/ (cartelle sorelle, così Chrome le installa come due app distinte).
// Sui telefoni che avevano la vecchia versione questo file la sostituisce: cancella i file dell'app
// rimasti in cache (non mappe e tracce scaricate, che l'app a piedi riusa), si disattiva
// e ricarica le pagine aperte, che così mostrano la nuova pagina di scelta.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-')) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
