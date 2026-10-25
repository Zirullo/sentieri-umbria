# Sentieri Umbria – note per lo sviluppo

PWA statica (nessun build) in `app/`, pubblicata su GitHub Pages a ogni push su `main`
(`.github/workflows/pages.yml`: esegue `npm test`, imposta la versione del service worker, pubblica `app/`).
Utente e interfaccia in italiano. Obiettivo dell'app: non perdersi, quindi guida lungo il sentiero
e avviso fuori sentiero. Tenerla semplice.

## Comandi

```sh
npm test                                   # test Node (tests/*.test.mjs)
node tools/noise_report.mjs 120            # falsi allarmi e precisione con rumore GPS simulato
python -m http.server 8765 --directory app --bind 127.0.0.1   # poi http://127.0.0.1:8765/?sim
```

Rigenerare i dati: vedi README. `build_data.py` va lanciato con `python -P -E` (non `-I`):
`imagecodecs` è installato con `--user` e `-I` ignorerebbe i pacchetti utente.
`data/raw/` (OSM, confine regionale, DEM Copernicus ~230 MB) è in `.gitignore`.

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

## Vincoli

- Il service worker precarica l'elenco `SHELL` in `app/sw.js`: ogni nuovo modulo JS va aggiunto lì
  (`tests/shell.test.mjs` lo controlla).
- Logica di guida in `app/js/nav.js`, coperta dai test: ogni modifica va verificata anche con `noise_report`.
- Mai mettere coordinate personali nel repository (è pubblico): i sentieri personali passano dal link
  `#sentiero=Nome|lat,lon;…` e restano nel `localStorage` del telefono.
