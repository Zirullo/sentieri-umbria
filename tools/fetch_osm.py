"""Scarica da Overpass tutte le relazioni route=hiking che toccano l'Umbria, e il confine regionale.
Con --bici scarica invece i percorsi in bici (route=bicycle e route=mtb).

Uso: python -I tools/fetch_osm.py data/raw/osm_umbria.json [data/raw/umbria_confine.json]
     python -I tools/fetch_osm.py --bici data/raw/osm_umbria_bici.json
"""
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

# Oltre alle relazioni, gallerie e ponti dei percorsi: lì il DEM dà la quota della montagna
# o del fondovalle, non quella del percorso.
QUERY = """
[out:json][timeout:600];
area["name"="Umbria"]["admin_level"="4"]["boundary"="administrative"]->.u;
relation["type"="route"]["route"="hiking"](area.u)->.r;
.r out geom;
(way(r.r)["tunnel"]["tunnel"!="no"]; way(r.r)["bridge"]["bridge"!="no"];);
out geom;
"""

BIKE_QUERY = QUERY.replace('["route"="hiking"]', '["route"~"^(bicycle|mtb)$"]')

BOUNDARY_QUERY = """
[out:json][timeout:300];
relation["name"="Umbria"]["admin_level"="4"]["boundary"="administrative"];
out geom;
"""

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def fetch(query: str, out_path: str) -> None:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    body = urllib.parse.urlencode({"data": query}).encode()
    last_err = None
    for attempt, url in enumerate(ENDPOINTS * 3):
        if attempt >= len(ENDPOINTS):
            time.sleep(30 * (attempt // len(ENDPOINTS)))  # server occupati: attendi e riprova
        try:
            print(f"Interrogo {url} ...")
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "sentieri-umbria-pwa/0.1"})
            with urllib.request.urlopen(req, timeout=900) as resp:
                out.write_bytes(resp.read())
            print(f"Salvato {out} ({out.stat().st_size / 1e6:.1f} MB)")
            return
        except Exception as e:  # prova l'endpoint successivo
            last_err = e
            print(f"  errore: {e}")
    raise SystemExit(f"Download fallito: {last_err}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--bici"]
    if "--bici" in sys.argv:
        fetch(BIKE_QUERY, args[0])  # il confine è lo stesso dei sentieri
    else:
        fetch(QUERY, args[0])
        fetch(BOUNDARY_QUERY, args[1] if len(args) > 1 else str(Path(args[0]).with_name("umbria_confine.json")))
