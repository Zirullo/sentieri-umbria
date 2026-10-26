# Sentieri Umbria – note per lo sviluppo

PWA statica (nessun build) in `app/`, pubblicata su GitHub Pages a ogni push su `main`
(`.github/workflows/pages.yml`: esegue `npm test`, imposta la versione del service worker, pubblica `app/`).
Utente e interfaccia in italiano. Obiettivo dell'app: non perdersi, quindi guida lungo il sentiero
e avviso fuori sentiero. Tenerla semplice.

## Comandi

```sh
npm test                                   # test Node (tests/*.test.mjs)
node tools/noise_report.mjs 120            # falsi allarmi e precisione con rumore GPS simulato
python -m http.server 8765 --directory app --bind 127.0.0.1   # poi http://127.0.0.1:8765/piedi/?sim
```

Rigenerare i dati: vedi README. `build_data.py` va lanciato con `python -P -E` (non `-I`):
`imagecodecs` è installato con `--user` e `-I` ignorerebbe i pacchetti utente.
`data/raw/` (OSM, confine regionale, DEM Copernicus ~230 MB) è in `.gitignore`.
Dopo `build_data.py` rilanciare sempre `tools/describe.py` (descrizioni da `data/descrizioni.json`):
i testi vanno scritti con parole proprie, mai copiati da altri siti. Per un percorso nuovo: scheda con
`tools/schede_percorsi.py … <id>`, testo in `percorsi` di `data/descrizioni.json` (solo fatti della scheda o di fonti).

## Ambiente Windows

- In PowerShell 5.1 i messaggi di commit con virgolette o trattini si rompono: scrivere il messaggio in un
  file e usare `git commit -F <file>`.
- `Set-Content`/`Get-Content` senza encoding corrompono gli accenti: usare gli strumenti di modifica file.

## Test nel browser (Playwright)

- `?sim` espone `simFix(lat, lon, acc)`, `simTrack()` e `appMap`; un clic sulla mappa di navigazione = fix GPS.
- Prima di ricaricare: svuotare `localStorage` (altrimenti riprende la navigazione attiva) e deregistrare il
  service worker / cancellare le cache, oppure usare un nuovo contesto con `serviceWorkers: 'block'`.
- Per il tocco usare un contesto `isMobile: true, hasTouch: true` e `page.touchscreen.tap`.
- Le icone piccole negli screenshot ingannano: verificare orientamenti e posizioni con misure
  (`getScreenCTM`, `getBoundingClientRect`), non a occhio.

## Due versioni: a piedi e in bici

- `app/piedi/` e `app/bici/` sono due app in cartelle sorelle: pagina, manifest, icone, dati e `sw.js` propri,
  codice e CSS comuni (`../js`, `../css`, `../sw-core.js`). Le differenze stanno in `app/js/config.js`, scelte da
  `<html data-mode="bici">`. Ogni modifica a `piedi/index.html` va ripetuta in `bici/index.html` (un test confronta gli id).
- Mai un'app nella cartella principale: il suo ambito conterrebbe l'altra e Chrome su Android le confonde
  all'installazione ("già installata"). `app/index.html` è solo una pagina di scelta che inoltra i vecchi link
  (`#sentiero=`, `?reset`, `?sim`) a `piedi/`; `app/sw.js` serve solo a disattivare il vecchio service worker.
- Stesso sito: chiavi di `localStorage` e nomi delle cache della bici hanno il prefisso `bici-` (`KEY_PREFIX`);
  a piedi niente prefisso (dati di prima del trasloco), salvo il guscio `piedi-shell-*`.
- Test nel browser: `http://127.0.0.1:8765/piedi/?sim` e `http://127.0.0.1:8765/bici/?sim`.

## Vincoli

- Versione unica per le due app in `app/js/config.js` (`VERSION`, visibile in fondo al pannello della legenda):
  a ogni rilascio pubblicato va incrementata di uno, 1.0 → 1.01 → 1.02 … (formato controllato dai test).
- Interfaccia in italiano e inglese (`app/js/i18n.js`, dizionario `app/js/en.js`): ogni testo visibile passa da
  `tr('frase italiana', { param })`, con frase fissa (niente `${…}`: parametri `{x}`, parole del modo `{one}` `{many}`);
  nelle pagine i testi fissi hanno `data-tr`. `tests/i18n.test.mjs` controlla che ogni frase abbia la traduzione.
  Le descrizioni restano solo in italiano e si traducono al momento: traduttore del telefono (Translator API) se
  c'è, altrimenti Google Traduttore dentro l'app (indirizzo senza chiave, non documentato; se fallisce, link alla pagina). `desc_en` nei file di dettaglio, se presente, avrebbe la precedenza.

- Il service worker precarica gli elenchi `OWN` e `SHARED` in `app/sw-core.js`: ogni nuovo modulo JS va aggiunto
  a `SHARED` (`tests/shell.test.mjs` lo controlla).
- Logica di guida in `app/js/nav.js`, coperta dai test: ogni modifica va verificata anche con `noise_report`.
- Mai mettere coordinate personali nel repository (è pubblico): i sentieri personali passano dal link
  `#sentiero=Nome|lat,lon;…` e restano nel `localStorage` del telefono.
