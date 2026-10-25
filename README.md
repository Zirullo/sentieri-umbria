# Sentieri Umbria

App web installabile (PWA) per seguire i sentieri CAI dell'Umbria senza perdersi:
scegli il sentiero, una freccia ti guida lungo la traccia e un avviso rosso compare
appena esci di più di 30 m. Funziona anche senza rete.

## Uso sul telefono (Android, Chrome)

1. Apri https://zirullo.github.io/sentieri-umbria/, scegli **A piedi** (o **In bici**) e poi,
   dal menu ⋮ di Chrome, **Installa app**. Le due app stanno in cartelle sorelle (`piedi/`, `bici/`)
   e si installano ognuna per conto suo.
2. A casa, con la rete: apri un sentiero e premi **Scarica offline**
   (mappa topografica intorno al sentiero, di solito 3–10 MB).
3. Al punto di partenza premi **Inizia**. Lo schermo resta acceso.

In navigazione:

| Banner | Significato |
|---|---|
| 🔵 Raggiungi il sentiero | non sei ancora sulla traccia: la freccia porta al punto più vicino |
| 🟢 Sul sentiero | la freccia punta ~35 m più avanti lungo la traccia |
| 🔴 FUORI SENTIERO | oltre 30 m dalla traccia: la freccia riporta al punto più vicino |
| 🟤 Segnale GPS debole | precisione peggiore di 60 m: nessun allarme finché non migliora |

La riga 🏁 indica sempre distanza e direzione in linea d'aria della meta.

Limiti: a schermo spento il browser non riceve il GPS, quindi niente avvisi;
la bussola del telefono va ricalibrata ogni tanto (movimento a "8").

Se l'app si blocca o Chrome non lascia reinstallarla: pulsante della mappa (fogli sovrapposti) →
**Cancella tutti i dati dell'app**, oppure apri l'indirizzo con `?reset`.

## Versione in bici

`…/sentieri-umbria/bici/` è un'app a parte (**Bici Umbria**, icona blu) con ciclovie e percorsi MTB.
Stessa guida, tarata sulla velocità della bici, e in più vibrazione e suono quando esci dal percorso
o ci rientri. Filtri per tipo (ciclovia/MTB), difficoltà MTB (scala CAI TC–EC), lunghezza e salita.
Dati, preferenze e mappe scaricate sono separati da quelli della versione a piedi.

## Dati

- **Sentieri**: relazioni `route=hiking` di [OpenStreetMap](https://www.openstreetmap.org/copyright)
  che toccano l'Umbria (© OpenStreetMap contributors, ODbL). Sono la base
  del catasto CAI (INFOMONT), vedi [Umbria/Sentieri](https://wiki.openstreetmap.org/wiki/Umbria/Sentieri).
- **Quote**: Copernicus DEM GLO-30 (© DLR / Airbus, fornito dal programma Copernicus).
- **Mappa**: [OpenTopoMap](https://opentopomap.org) (CC-BY-SA).

### Aggiornare i dati

```sh
python -I tools/fetch_osm.py data/raw/osm_umbria.json      # sentieri da Overpass
python -I tools/fetch_dem.py data/raw/dem                   # solo la prima volta (~230 MB)
python -P -E tools/build_data.py data/raw/osm_umbria.json data/raw/dem app/piedi/data

# versione in bici: relazioni route=bicycle e route=mtb
python -I tools/fetch_osm.py --bici data/raw/osm_umbria_bici.json
python -P -E tools/build_data.py --bici data/raw/osm_umbria_bici.json data/raw/dem app/bici/data
```

Poi le descrizioni (`build_data.py` riscrive i file dei percorsi senza):

```sh
python -I tools/fetch_osm.py --luoghi data/raw/luoghi.json  # facoltativo: luoghi lungo i percorsi
python -P -E tools/describe.py data/descrizioni.json app/piedi/data data/raw/luoghi.json
python -P -E tools/describe.py data/descrizioni.json app/bici/data data/raw/luoghi.json
```

I testi stanno in `data/descrizioni.json`: note su cammini, luoghi, zone e settori, scritte da zero
a partire da informazioni trovate online (niente testo copiato da altri siti). Ogni percorso riceve
il testo del cammino di cui fa parte, fino a tre note sui luoghi che tocca (partenza, arrivo, `via`,
o luoghi lungo il tracciato) e, se non ce ne sono, quella della zona o del settore; in coda le
avvertenze delle note OSM (frane, tratti chiusi). Un test controlla che nessun percorso resti senza.

Insieme ai percorsi si scaricano gallerie e ponti: lì la quota si interpola tra gli estremi,
perché il DEM darebbe quella della montagna sopra la galleria o del fondovalle sotto il ponte.
Si scaricano anche le etichette di tutte le strade dei percorsi, per calcolare la quota su strade
principali (statali, regionali, provinciali senza pista ciclabile separata): il filtro
«Evita strade principali» esclude i percorsi che ne hanno più del 10%.

Nella versione in bici ogni percorso ha un codice breve per etichette e ricerca: il numero ufficiale
se c'è ed è unico, altrimenti C1, C2… (ciclovie) e M1, M2… (MTB), in ordine di relazione OSM.

`build_data.py` richiede `numpy`, `shapely`, `tifffile`, `imagecodecs`.

## Sviluppo

```sh
npm test          # test della logica di guida
npm run serve     # http://127.0.0.1:8765/piedi/?sim  (?sim: clic sulla mappa = posizione GPS finta)
```

Ogni push su `main` esegue i test e pubblica la cartella `app/` su GitHub Pages.

| File | Contenuto |
|---|---|
| `app/js/nav.js` | stati di guida: avvicinamento, sul sentiero, fuori, arrivo |
| `app/js/geo.js` | distanze, rotte, proiezione sulla traccia |
| `app/js/compass.js` | bussola del telefono con ripiego sulla rotta GPS |
| `app/js/offline.js` | scaricamento della mappa lungo un corridoio attorno al sentiero |
| `app/js/plan.js` | tempo di percorrenza (DIN 33466 a piedi, stima in bici) e tramonto |
| `app/js/config.js` | differenze tra versione a piedi e in bici (`<html data-mode="bici">`) |
| `app/sw-core.js` | service worker per l'uso offline, importato da `piedi/sw.js` e `bici/sw.js` con cache proprie |
| `app/index.html`, `app/sw.js` | pagina di scelta tra le due app; disattivazione del vecchio service worker |
