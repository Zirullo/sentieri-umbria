"""Scrive una breve descrizione di ogni percorso nei file di dettaglio (campo "desc").

I testi stanno in data/descrizioni.json: note originali su percorsi, cammini, luoghi e zone, scritte a
partire dai dati (tools/schede_percorsi.py) e da informazioni raccolte online, riformulate (niente testo
copiato). Per ogni percorso si sceglie:
  0. il testo proprio del percorso, se c'è (sezione "percorsi", per id della relazione OSM);
  1. il cammino a tappe di cui fa parte (dal nome, dal codice o dalle note OSM);
  2. fino a tre note sui luoghi di partenza, arrivo e passaggio (tag from/to/via, nome del percorso)
     o sui luoghi che il tracciato tocca (data/raw/luoghi.json, se c'è: tools/fetch_osm.py --luoghi);
  3. se non c'è nessuna nota sui luoghi, quella della zona (montagna, parco) o del settore;
  4. le avvertenze delle note OSM (frane, tratti chiusi, segnaletica mancante).

Da lanciare dopo build_data.py, che riscrive i file di dettaglio senza descrizione:
  python -P -E tools/describe.py data/descrizioni.json app/piedi/data [data/raw/luoghi.json]
  python -P -E tools/describe.py data/descrizioni.json app/bici/data [data/raw/luoghi.json]
"""
import json
import math
import re
import sys
import unicodedata
from pathlib import Path

MAX_PLACES = 3
LONG_M = 40000  # oltre, i luoghi lungo il tracciato sono troppi: contano solo partenza, arrivo e "via"
NEAR_M = {"town": 700, "other": 250}

# un nome di luogo dentro un nome generico ("Monte Foce", "Bivio Gualdo") non è quel luogo
GENERIC = re.compile(r"^(monte|m\.|sella|poggio|colle|col|fosso|valle|val|forca|forcella|bivio|croce|strada|cimitero|"
                     r"podere|rifugio|fonte|sorgente|fontana|passo|pian|piano|casa|case|ponte|torrente|rio|"
                     r"sentiero|parcheggio|intersezione|innesto|località|loc\.)\b")

WARN = re.compile(r"frana|smott|non (?:ancora )?(?:percorribil|transitabil|installat)|temporaneamente|cautela|"
                  r"terremoto|cani|da completare|cunicolo|lavori|verificare|controllare", re.I)
SKIP_NOTE = re.compile(r"aggiornamento|relazione compilata|controllare se sentiero", re.I)


def norm(s):
    s = unicodedata.normalize("NFKC", s).lower().replace("’", "'")
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"\bs\. ?", "san ", s)
    return re.sub(r"\s+", " ", s).strip()


def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(a))


class Places:
    """Note sui luoghi, cercate per nome dentro un testo (partenza, arrivo…)."""

    def __init__(self, notes):
        self.notes = notes
        self.keys = sorted(((norm(k.lstrip("=")), k) for k in notes), key=lambda kv: -len(kv[0]))
        # per i luoghi OSM lungo il tracciato: stesso nome, non solo contenuto, e mai i nomi comuni
        self.by_name = {nk: k for nk, k in self.keys if not k.startswith("=")}

    def find(self, text):
        t = norm(text)
        if not t:
            return []
        hits = []
        for nk, k in self.keys:
            if k.startswith("="):  # nome comune ("Foce", "Campi"): vale solo se è tutto il testo
                if t == nk:
                    hits.append(k)
                continue
            m = re.search(r"(?<![\w'])" + re.escape(nk) + r"(?![\w'])", t)
            if not m:
                continue
            if any(nk in norm(h.lstrip("=")) for h in hits):
                continue  # "Norcia" dentro "Castelluccio di Norcia", già preso
            before = t[:m.start()].strip(" -–,;")
            last = re.split(r"\s[-–]\s|,|;", before)[-1].strip() if before else ""
            if last and GENERIC.match(last) and not GENERIC.match(nk):
                continue  # "Monte Foce" non è "Foce"
            hits.append(k)
        # in ordine di comparsa nel testo
        return sorted(hits, key=lambda k: t.find(norm(k.lstrip("="))))


def load_pois(path, places):
    """Luoghi OSM che hanno una nota: (nome, lat, lon, è un centro abitato grande).
    Di chiese e cappelle dedicate a un santo ce ne sono ovunque: per quei nomi valgono solo i paesi."""
    if not path or not Path(path).exists():
        return []
    out = []
    for e in json.load(open(path, encoding="utf-8"))["elements"]:
        t = e.get("tags", {})
        name = t.get("name:it") or t.get("name")
        c = e if "lat" in e else e.get("center")
        if not (name and c and norm(name) in places.by_name):
            continue
        if re.match(r"(san|santa|santo|sant'|madonna|chiesa)\b", norm(name)) and "place" not in t:
            continue
        out.append((name, c["lat"], c["lon"], t.get("place") in ("city", "town")))
    # stesso nome in posti lontani (c'è un Monte Cucco anche in Toscana): non si sa a quale va la nota
    spread = {}
    for name, lat, lon, _ in out:
        spread.setdefault(norm(name), []).append((lat, lon))
    ambiguous = {n for n, ps in spread.items() if any(haversine(*a, *b) > 20000 for a in ps for b in ps)}
    return [p for p in out if norm(p[0]) not in ambiguous]


def along(d, pois, places):
    """Note dei luoghi che il tracciato tocca, nell'ordine in cui si incontrano."""
    if not pois or d["len"] > LONG_M:
        return []
    pts = [p for seg in d["segments"] for p in seg]
    b = d["bbox"]
    found = {}
    for name, lat, lon, town in pois:
        if not (b[0] - 0.01 <= lat <= b[2] + 0.01 and b[1] - 0.01 <= lon <= b[3] + 0.01):
            continue
        key = places.by_name.get(norm(name))
        if not key:
            continue
        lim = NEAR_M["town" if town else "other"]
        best = min(range(0, len(pts), 2), key=lambda i: haversine(pts[i][0], pts[i][1], lat, lon))
        if haversine(pts[best][0], pts[best][1], lat, lon) <= lim:
            found.setdefault(key, best)
    return sorted(found, key=found.get)


def zone_of(d, zones):
    pts = [p for seg in d["segments"] for p in seg]
    probe = [pts[0], pts[len(pts) // 2], pts[-1]]
    best = None
    for z in zones:
        r = min(haversine(p[0], p[1], z["lat"], z["lon"]) for p in probe) / (z["raggio_km"] * 1000)
        if r <= 1 and (best is None or r < best[0]):
            best = (r, z)
    return best[1] if best else None


def warnings(tags):
    seen = []
    for k in ("description:it", "note:it", "description", "note"):
        v = tags.get(k, "").strip()
        if not v or SKIP_NOTE.search(v) or not WARN.search(v):
            continue
        if k in ("description", "note") and tags.get(f"{k}:it"):
            continue  # c'è già la versione in italiano
        if re.search(r"[a-z] (?:the|to|of|and|be) ", v):
            continue  # nota solo in inglese
        if v.rstrip(".") not in seen:
            seen.append(v.rstrip("."))
    if re.search(r"partially marked", tags.get("note", ""), re.I):
        seen.append("segnaletica presente solo in parte")
    return [f"Segnalazione nei dati OSM: «{v[:1].upper() + v[1:]}»." for v in seen]


def sector_finder(data_dir, settori):
    """Settore del sentiero a piedi più vicino: per i percorsi fuori regione, di lunga percorrenza o in bici."""
    index = Path(data_dir).resolve().parent.parent / "piedi" / "data" / "index.json"
    ref = [(t["start"], t["sector"]) for t in json.load(open(index, encoding="utf-8"))["trails"] if t["sector"] in settori]

    def find(d):
        if d.get("sector") in settori:
            return d["sector"]
        lat, lon = d["start"]
        return min(ref, key=lambda r: haversine(lat, lon, *r[0]))[1]
    return find


def describe(d, texts, places, pois, sector_of):
    tags = d.get("tags", {})
    fields = [d.get("name", ""), d.get("ref", "")] + [tags.get(k, "") for k in
                                                     ("note:it", "description:it", "note", "description", "mtb:description")]
    route = next((it for it in texts["itinerari"]
                  if any(f and re.search(it["cerca"], f, re.I) for f in fields)), None)
    own = texts["percorsi"].get(str(d["id"]))
    out = ([own] if own else []) + ([route["testo"]] if route else [])

    names = [d.get("from", ""), d.get("to", "")] + tags.get("via", "").split(";")
    if not route:
        names.append(d.get("name", ""))  # "Cammino di San Benedetto" non è l'abbazia di San Benedetto
    keys = []
    for n in names:
        keys += [k for k in places.find(n) if k not in keys]
    keys += [k for k in along(d, pois, places) if k not in keys]
    notes = []
    for k in keys:
        if places.notes[k] not in notes and places.notes[k] not in out:
            notes.append(places.notes[k])
    out += notes[:MAX_PLACES - 1 if own else MAX_PLACES]

    if not notes and not own:
        z = zone_of(d, texts["zone"])
        text = (places.notes.get(z["luogo"]) if z and "luogo" in z else z and z.get("testo"))
        if not text and not route:
            text = texts["settori"][sector_of(d)]
        if text and text not in out:
            out.append(text)
    out += warnings(tags)
    return "\n\n".join(out)


def main(texts_path, data_dir, pois_path=None):
    texts = json.load(open(texts_path, encoding="utf-8"))
    places = Places(texts["luoghi"])
    pois = load_pois(pois_path, places)
    sector_of = sector_finder(data_dir, texts["settori"])
    files = sorted((Path(data_dir) / "trails").glob("*.json"))
    empty = 0
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        if d.get("extra"):  # percorso aggiuntivo da GPX (build_extra.py): ha già il suo testo
            continue
        d["desc"] = describe(d, texts, places, pois, sector_of)
        empty += not d["desc"]
        f.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(files)} percorsi, {len(files) - empty} con descrizione ({len(places.notes)} note sui luoghi, "
          f"{len(pois)} luoghi OSM)")


if __name__ == "__main__":
    main(*sys.argv[1:4])
