# Sentieri Umbria

App web installabile (PWA) per seguire i sentieri CAI dell'Umbria senza perdersi:
scegli il sentiero, una freccia ti guida lungo la traccia e un avviso rosso compare
appena esci di più di 30 m. Funziona anche senza rete.

## Uso sul telefono (Android, Chrome)

1. Apri il sito pubblicato su GitHub Pages e scegli **Aggiungi a schermata Home**.
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
python -P -E tools/build_data.py data/raw/osm_umbria.json data/raw/dem app/data
```

`build_data.py` richiede `numpy`, `shapely`, `tifffile`, `imagecodecs`.

## Sviluppo

```sh
npm test          # test della logica di guida
npm run serve     # http://127.0.0.1:8765/?sim  (?sim: clic sulla mappa = posizione GPS finta)
```

Ogni push su `main` esegue i test e pubblica la cartella `app/` su GitHub Pages.

| File | Contenuto |
|---|---|
| `app/js/nav.js` | stati di guida: avvicinamento, sul sentiero, fuori, arrivo |
| `app/js/geo.js` | distanze, rotte, proiezione sulla traccia |
| `app/js/compass.js` | bussola del telefono con ripiego sulla rotta GPS |
| `app/js/offline.js` | scaricamento della mappa lungo un corridoio attorno al sentiero |
| `app/js/plan.js` | tempo di percorrenza (DIN 33466) e tramonto |
| `app/sw.js` | service worker per l'uso offline |
