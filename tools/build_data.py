"""Converte i dati OSM + DEM nei file usati dalla PWA.

Uso: python -P -E tools/build_data.py data/raw/osm_umbria.json data/raw/dem app/piedi/data
     python -P -E tools/build_data.py --bici data/raw/osm_umbria_bici.json data/raw/dem app/bici/data

Produce:
  app/piedi/data/index.json      elenco sentieri + geometria semplificata per la mappa generale
  app/piedi/data/trails/<id>.json traccia dettagliata ordinata con quote, per la navigazione
"""
import json
import math
import re
import sys
from pathlib import Path

import shapely
import tifffile
from shapely.geometry import LineString
from shapely.ops import polygonize, unary_union

MAIN_ROLES = {"", "main", "forward", "backward"}
SIMPLIFY_DETAIL_M = 3
SIMPLIFY_OVERVIEW_M = 25
DENSIFY_M = 40
GAP_M = 150  # oltre questa distanza due tratti consecutivi sono considerati staccati

SECTORS = {
    1: "Alto Tevere",
    2: "Alto Chiascio",
    3: "Valle Umbra Nord",
    4: "Valle Spoletina",
    5: "Valnerina",
    6: "Valle del Nera",
    7: "Amerino",
    8: "Orvietano-Tuderte",
    9: "Perugino-Trasimeno",
}

KEEP_TAGS = [
    "ref", "name", "from", "to", "via", "cai_scale", "sac_scale", "duration:forward", "duration:backward",
    "distance", "ascent", "descent", "roundtrip", "operator", "network", "osmc:symbol", "symbol:it",
    "description:it", "description", "note:it", "note", "website", "survey:date", "check_date", "ref:REI",
    "source", "ele:max", "ele:min",
    "cai_scale:mtb", "cai_scale:mtb:uphill", "mtb:scale", "mtb:scale:uphill", "mtb:description", "mtb:type", "surface",
]

MIN_ROUTE_M = 200  # relazioni quasi vuote (solo un cartello o pochi metri) non sono percorsi

# Strade principali, per chi cammina: qualunque strada aperta al traffico, anche comunale, residenziale o di
# servizio (statali, provinciali, comunali, vicinali asfaltate), dove le auto passano vicino a chi è a piedi.
# Non contano le sterrate (surface non asfaltato), i tratti chiusi alle auto e quelli con una pista ciclabile
# separata dalla carreggiata (cycleway=track).
MAIN_HIGHWAYS = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "road",
}
# Fondi con cui una strada è asfaltata o lastricata; con un altro fondo indicato (ghiaia, terra, compattato…)
# la strada è una sterrata, quindi non conta come strada principale. Senza tag "surface" si assume asfalto.
PAVED = {
    "asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "cobblestone",
    "chipseal", "bricks", "metal",
}
NO_CARS = {"no", "private", "agricultural", "forestry", "delivery", "permit"}
CYCLEWAY_KEYS = ("cycleway", "cycleway:both", "cycleway:right", "cycleway:left")

# mtb:scale (0–6) → scala CAI del cicloescursionismo, usata dal Sentiero Italia in bici
MTB_SCALE = {"0": "TC", "1": "MC", "2": "BC", "3": "OC", "4": "EC", "5": "EC", "6": "EC"}
LONG_BIKE_NETWORKS = ("icn", "ncn")

R_EARTH = 6371008.8


def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(a))


class Dem:
    """Copernicus GLO-30: tile 1x1 grado, 3600x3600, angolo in alto a sinistra in (lon, lat+1)."""

    def __init__(self, folder: Path):
        self.tiles = {}
        for f in folder.glob("Copernicus_DSM_COG_10_N*_E*_DEM.tif"):
            parts = f.stem.split("_")
            lat, lon = int(parts[4][1:]), int(parts[6][1:])
            self.tiles[(lat, lon)] = tifffile.imread(f)
        print(f"DEM: {len(self.tiles)} tile caricati")

    def ele(self, lat, lon):
        key = (math.floor(lat), math.floor(lon))
        a = self.tiles.get(key)
        if a is None:
            return None
        n = a.shape[0]
        r = (key[0] + 1 - lat) * n
        c = (lon - key[1]) * a.shape[1]
        r0, c0 = min(int(r), n - 2), min(int(c), a.shape[1] - 2)
        fr, fc = r - r0, c - c0
        v = (a[r0, c0] * (1 - fr) * (1 - fc) + a[r0, c0 + 1] * (1 - fr) * fc
             + a[r0 + 1, c0] * fr * (1 - fc) + a[r0 + 1, c0 + 1] * fr * fc)
        return float(v)


def way_coords(member):
    return [(p["lat"], p["lon"]) for p in member.get("geometry", []) if p]


def chain_ways(ways):
    """Concatena le way nell'ordine dei membri, orientandole. Restituisce una lista di tratti continui."""
    ways = [w for w in ways if len(w) >= 2]
    if not ways:
        return []
    first = list(ways[0])
    if len(ways) > 1:
        nxt = ways[1]
        d_end = min(haversine(*first[-1], *nxt[0]), haversine(*first[-1], *nxt[-1]))
        d_start = min(haversine(*first[0], *nxt[0]), haversine(*first[0], *nxt[-1]))
        if d_start < d_end:
            first.reverse()
    segments = [first]
    for w in ways[1:]:
        cur = segments[-1]
        end = cur[-1]
        d_fwd = haversine(*end, *w[0])
        d_rev = haversine(*end, *w[-1])
        w = list(w) if d_fwd <= d_rev else list(reversed(w))
        if min(d_fwd, d_rev) <= GAP_M:
            cur.extend(w[1:] if min(d_fwd, d_rev) < 1 else w)
        else:
            segments.append(w)
    return segments


def seg_len(seg):
    return sum(haversine(*a, *b) for a, b in zip(seg, seg[1:]))


MIN_FRAGMENT_M = 150


def tidy_segments(segments):
    """Se la relazione è spezzata: scarta i frammenti minuscoli e riordina i pezzi per estremi più vicini,
    mantenendo il verso originale (dal primo membro della relazione)."""
    if len(segments) < 2:
        return segments
    first_pt = segments[0][0]
    segs = [s for s in segments if seg_len(s) >= MIN_FRAGMENT_M] or [max(segments, key=seg_len)]
    segs.sort(key=seg_len, reverse=True)
    result = [segs.pop(0)]
    while segs:
        best = None
        for i, s in enumerate(segs):
            start, end = result[0][0], result[-1][-1]
            for d, where, rev in ((haversine(*end, *s[0]), "end", False), (haversine(*end, *s[-1]), "end", True),
                                  (haversine(*start, *s[-1]), "start", False), (haversine(*start, *s[0]), "start", True)):
                if best is None or d < best[0]:
                    best = (d, i, where, rev)
        _, i, where, rev = best
        s = segs.pop(i)
        s = list(reversed(s)) if rev else s
        if where == "end":
            result.append(s)
        else:
            result.insert(0, s)
    if haversine(*first_pt, *result[-1][-1]) < haversine(*first_pt, *result[0][0]):
        result = [list(reversed(s)) for s in reversed(result)]
    return result


def to_xy(coords, lat0):
    k = math.cos(math.radians(lat0))
    return [(lon * k * 111320.0, lat * 110540.0) for lat, lon in coords]


def from_xy(xy, lat0):
    k = math.cos(math.radians(lat0))
    return [(y / 110540.0, x / (k * 111320.0)) for x, y in xy]


def simplify(coords, tol_m, lat0):
    if len(coords) < 3:
        return coords
    ls = LineString(to_xy(coords, lat0)).simplify(tol_m, preserve_topology=False)
    return from_xy(list(ls.coords), lat0)


def densify(coords, step_m):
    out = [coords[0]]
    for a, b in zip(coords, coords[1:]):
        d = haversine(*a, *b)
        n = int(d // step_m)
        for i in range(1, n + 1):
            t = i / (n + 1)
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        out.append(b)
    return out


def ascent_descent(eles, threshold=5.0):
    """Dislivello con isteresi, per non sommare il rumore del DEM."""
    up = down = 0.0
    ref = eles[0]
    for e in eles[1:]:
        if e - ref >= threshold:
            up += e - ref
            ref = e
        elif ref - e >= threshold:
            down += ref - e
            ref = e
    return round(up), round(down)


STRUCT_M = 6  # un punto della traccia entro questa distanza da una galleria o da un ponte ne fa parte


def load_structures(osm, lat0=43.0):
    """Gallerie e ponti scaricati insieme ai percorsi, come indice spaziale in metri."""
    lines = [LineString(to_xy([(p["lat"], p["lon"]) for p in e["geometry"]], lat0))
             for e in osm["elements"] if e["type"] == "way" and len(e.get("geometry", [])) >= 2]
    print(f"{len(lines)} gallerie e ponti")
    return shapely.STRtree(lines) if lines else None


def fix_structures(pts, tree, lat0=43.0):
    """Nelle gallerie e sui ponti la quota del DEM è sbagliata: si interpola tra i punti all'aperto."""
    if tree is None or len(pts) < 3:
        return
    xy = shapely.points(to_xy([(p[0], p[1]) for p in pts], lat0))
    inside = set(tree.query(xy, predicate="dwithin", distance=STRUCT_M)[0].tolist())
    n = len(pts)
    i = 0
    while i < n:
        if i not in inside:
            i += 1
            continue
        j = i
        while j < n and j in inside:
            j += 1
        # tratto [i, j) in galleria o su un ponte, tra i punti all'aperto i-1 e j
        ea = pts[i - 1][2] if i > 0 else None
        eb = pts[j][2] if j < n else None
        for k in range(i, j):
            if ea is not None and eb is not None:
                pts[k][2] = round(ea + (eb - ea) * (k - i + 1) / (j - i + 1))
            elif ea is not None or eb is not None:
                pts[k][2] = ea if ea is not None else eb
        i = j


def load_boundary(path: Path):
    """Poligono dell'Umbria (lon, lat) dalle way 'outer' della relazione amministrativa."""
    if not path.exists():
        print(f"Confine regionale non trovato ({path}): nessun controllo fuori regione")
        return None
    rel = next(e for e in json.load(open(path, encoding="utf-8"))["elements"] if e["type"] == "relation")
    lines = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
             for m in rel["members"] if m["type"] == "way" and m.get("role") == "outer"]
    poly = unary_union(list(polygonize(unary_union(lines))))
    shapely.prepare(poly)
    return poly


def share_inside(poly, pts):
    if poly is None:
        return 1.0
    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    return float(shapely.contains_xy(poly, lons, lats).mean())


def sector_of(tags, inside):
    ref = (tags.get("ref") or "").strip()
    # le tappe dei percorsi lunghi che entrano in Umbria anche solo in parte restano tra i percorsi lunghi
    if tags.get("network") in ("iwn", "nwn", "rwn") and inside >= 0.2:
        return "Lunga percorrenza"
    if inside < 0.5:
        return "Regioni confinanti"
    digits = ref.split()[0] if ref else ""
    num = "".join(ch for ch in digits if ch.isdigit())
    if len(num) == 3 and digits[:3].isdigit():
        return SECTORS.get(int(num[0]), "Altri sentieri")
    return "Altri sentieri"


def is_main_road(tags):
    if tags.get("highway") not in MAIN_HIGHWAYS:
        return False
    if any(tags.get(k) in NO_CARS for k in ("motor_vehicle", "motorcar", "vehicle", "access")):
        return False
    if tags.get("surface", "asphalt") not in PAVED:
        return False
    return not any(tags.get(k) == "track" for k in CYCLEWAY_KEYS)


def main_road_share(members, way_tags):
    """Quota della lunghezza del percorso su strade principali (0–1), o None se le strade non sono note."""
    total = main = 0.0
    for m in members:
        if m["type"] != "way" or m.get("role", "") not in MAIN_ROLES or m["ref"] not in way_tags:
            continue
        length = seg_len(way_coords(m))
        total += length
        if is_main_road(way_tags[m["ref"]]):
            main += length
    return round(main / total, 2) if total else None


def drop_return_legs(index, details, near_m=1000, overlap=0.85, tol_m=50):
    """Andata e ritorno mappati come due relazioni (A–B e B–A sullo stesso tracciato): resta solo la più vecchia,
    il verso si sceglie nella scheda. Due percorsi sono una coppia se ognuno parte dove l'altro arriva e
    ognuno sta per almeno `overlap` entro `tol_m` dall'altro."""
    def cells(entry):
        grid = {}
        for seg in details[entry["id"]]["segments"]:
            for p in seg:
                grid.setdefault((round(p[0] * 500), round(p[1] * 500)), []).append(p)
        return grid

    def share_near(a, grid):
        # celle di ~200 m: basta guardare la cella del punto e le otto vicine
        pts = [p for seg in details[a["id"]]["segments"] for p in seg]
        near = 0
        for p in pts:
            ci, cj = round(p[0] * 500), round(p[1] * 500)
            cand = [q for di in (-1, 0, 1) for dj in (-1, 0, 1) for q in grid.get((ci + di, cj + dj), ())]
            if any(haversine(p[0], p[1], q[0], q[1]) < tol_m for q in cand):
                near += 1
        return near / len(pts)

    grids = {}
    dropped = set()
    for a in sorted(index, key=lambda e: e["id"]):
        if a["id"] in dropped:
            continue
        for b in index:
            if b["id"] <= a["id"] or b["id"] in dropped or b.get("kind") != a.get("kind"):
                continue
            if haversine(*a["start"], *b["end"]) > near_m or haversine(*a["end"], *b["start"]) > near_m:
                continue
            ga = grids.setdefault(a["id"], cells(a))
            gb = grids.setdefault(b["id"], cells(b))
            if share_near(a, gb) >= overlap and share_near(b, ga) >= overlap:
                print(f"andata e ritorno: tengo {a['id']} {a['name']!r}, tolgo {b['id']} {b['name']!r}")
                dropped.add(b["id"])
    index[:] = [e for e in index if e["id"] not in dropped]


LINKED_REF = re.compile(r"(?:percors[oi]|sentiero|sent\.|bivio|innesto|intersezione|\bn\.?)\s*N?([0-9]{2,3}[A-Z]?)\b", re.I)


def fix_from_to(index, details, places_path):
    """Partenza e arrivo dei tag OSM a volte sono al contrario rispetto al verso della traccia: l'app li
    mostrerebbe scambiati (scheda, scelta del verso). Si scambiano quando un estremo dichiarato (un luogo con
    quel nome, o il sentiero di cui si dice l'incrocio) è nettamente più vicino all'altro capo della traccia."""
    places = {}
    if places_path.exists():
        for e in json.load(open(places_path, encoding="utf-8"))["elements"]:
            t, c = e.get("tags", {}), e if "lat" in e else e.get("center")
            if t.get("name") and c:
                places.setdefault(t["name"].lower(), []).append((c["lat"], c["lon"]))
    by_ref = {}
    for e in index:
        by_ref.setdefault(e["ref"], []).append(e)

    def dist_to_ends(entry, label):
        m = LINKED_REF.search(label)
        pts = [p for o in by_ref.get(m.group(1), []) if o["id"] != entry["id"] for seg in o["geom"] for p in seg] if m else []
        if not pts:
            pts = [c for c in places.get(label.split(" - ")[0].split(",")[0].strip().lower(), [])
                   if min(haversine(*entry["start"], *c), haversine(*entry["end"], *c)) < 5000]
        if not pts:
            return None
        return (min(haversine(*entry["start"], *p) for p in pts), min(haversine(*entry["end"], *p) for p in pts))

    def near_end(d):  # (distanza dalla partenza, dall'arrivo): vicino all'arrivo, lontano dalla partenza
        return d is not None and d[1] < 1500 and d[0] > 300 and d[1] < d[0] / 2

    for e in index:
        if not e["from"] or not e["to"] or haversine(*e["start"], *e["end"]) < 300:
            continue
        f, t = dist_to_ends(e, e["from"]), dist_to_ends(e, e["to"])
        t_near_start = t and near_end((t[1], t[0]))
        if (near_end(f) and (t is None or t_near_start)) or (t_near_start and f is None):
            print(f"partenza e arrivo scambiati: {e['id']} {e['ref']} {e['from']!r} ↔ {e['to']!r}")
            e["from"], e["to"] = e["to"], e["from"]
            tags = details[e["id"]]["tags"]
            tags["from"], tags["to"] = e["from"], e["to"]


def bike_codes(index):
    """Codice breve per etichette ed elenco: il numero ufficiale se c'è ed è unico,
    altrimenti C1, C2… per le ciclovie e M1, M2… per la MTB, in ordine di relazione OSM (stabile)."""
    refs = [e["ref"] for e in index]
    counters = {"road": 0, "mtb": 0}
    for e in sorted(index, key=lambda e: e["id"]):
        ref = e["ref"].strip()
        if ref and len(ref) <= 6 and refs.count(e["ref"]) == 1:
            continue
        counters[e["kind"]] += 1
        e["ref"] = f"{'C' if e['kind'] == 'road' else 'M'}{counters[e['kind']]}"


def bike_sector(tags, inside):
    name = tags.get("name", "")
    if (tags.get("network") in LONG_BIKE_NETWORKS or "Tappa" in name) and inside >= 0.2:
        return "Itinerari a tappe"
    if inside < 0.5:
        return "Regioni confinanti"
    return "Ciclovie" if tags.get("route") == "bicycle" else "Mountain bike"


def bike_scale(tags):
    return tags.get("cai_scale:mtb") or MTB_SCALE.get(tags.get("mtb:scale", "").strip()[:1], "")


def is_cai(tags):
    """Sentiero del catasto CAI: operatore CAI, codice REI o rilievo CAI dichiarato."""
    op = tags.get("operator", "").lower()
    return ("club alpino" in op or op.startswith("cai") or "ref:REI" in tags
            or "cai" in tags.get("source", "").lower())


def r5(v):
    return round(v, 5)


def main(osm_path, dem_dir, out_dir, bike=False):
    osm = json.load(open(osm_path, encoding="utf-8"))
    dem = Dem(Path(dem_dir))
    umbria = load_boundary(Path(osm_path).with_name("umbria_confine.json"))
    structures = load_structures(osm)
    out = Path(out_dir)
    (out / "trails").mkdir(parents=True, exist_ok=True)

    rels = {e["id"]: e for e in osm["elements"] if e["type"] == "relation"}
    way_tags = {e["id"]: e["tags"] for e in osm["elements"] if e["type"] == "way" and "tags" in e and "highway" in e["tags"]}
    # nomi ripetuti (es. le tappe "SICAI Ciclo"): si distinguono con partenza e arrivo
    names = [t.get("name") for t in (r.get("tags", {}) for r in rels.values()) if t.get("from") and t.get("to")]
    index = []
    details = {}
    total_pts = 0

    for rid, rel in rels.items():
        tags = dict(rel.get("tags", {}))
        if tags.get("name") and names.count(tags["name"]) > 1 and tags.get("from") and tags.get("to"):
            tags["name"] = f"{tags['name']}: {tags['from']} – {tags['to']}"
        members = rel.get("members", [])
        main_ways = [way_coords(m) for m in members if m["type"] == "way" and m.get("role", "") in MAIN_ROLES]
        extra_ways = [(m.get("role"), way_coords(m)) for m in members
                      if m["type"] == "way" and m.get("role", "") not in MAIN_ROLES]
        if not main_ways:
            # superroute: concatena le relazioni figlie presenti nel dataset
            for m in members:
                child = rels.get(m["ref"]) if m["type"] == "relation" else None
                if child:
                    main_ways += [way_coords(c) for c in child.get("members", [])
                                  if c["type"] == "way" and c.get("role", "") in MAIN_ROLES]
        segments = tidy_segments(chain_ways(main_ways))
        if not segments:
            continue

        lat0 = segments[0][0][0]
        detail_segs, ov_segs = [], []
        length = 0.0
        all_eles = []
        for seg in segments:
            s = densify(simplify(seg, SIMPLIFY_DETAIL_M, lat0), DENSIFY_M)
            pts = []
            for lat, lon in s:
                e = dem.ele(lat, lon)
                pts.append([r5(lat), r5(lon), None if e is None else round(e)])
            fix_structures(pts, structures)
            for a, b in zip(s, s[1:]):
                length += haversine(*a, *b)
            all_eles += [p[2] for p in pts if p[2] is not None]
            detail_segs.append(pts)
            ov_segs.append([[round(lat, 4), round(lon, 4)] for lat, lon in simplify(seg, SIMPLIFY_OVERVIEW_M, lat0)])
            total_pts += len(pts)
        if length < MIN_ROUTE_M:
            continue

        extras = []
        for role, w in extra_ways:
            if len(w) >= 2:
                extras.append({"role": role, "pts": [[r5(a), r5(b)] for a, b in simplify(w, SIMPLIFY_DETAIL_M, lat0)]})

        up, down = ascent_descent(all_eles) if all_eles else (None, None)
        flat = [p for seg in detail_segs for p in seg]
        lats = [p[0] for p in flat]
        lons = [p[1] for p in flat]
        info = {k: tags[k] for k in KEEP_TAGS if k in tags}
        inside = share_inside(umbria, flat)
        entry = {
            "id": rid,
            "ref": tags.get("ref", ""),
            "name": tags.get("name") or tags.get("name:it") or "",
            "from": tags.get("from", ""),
            "to": tags.get("to", ""),
            "sector": bike_sector(tags, inside) if bike else sector_of(tags, inside),
            "scale": bike_scale(tags) if bike else tags.get("cai_scale", ""),
            "cai": is_cai(tags),
            "len": round(length),
            "up": up,
            "down": down,
            "bbox": [min(lats), min(lons), max(lats), max(lons)],
            "start": flat[0][:2],
            "end": flat[-1][:2],
            "gaps": len(detail_segs) - 1,
            "main": main_road_share(members, way_tags),
            "geom": ov_segs,
        }
        if bike:
            entry["kind"] = "road" if tags.get("route") == "bicycle" else "mtb"
        index.append(entry)
        details[rid] = {"tags": info, "segments": detail_segs, "extras": extras}

    if bike:
        # solo in bici: a piedi itinerari diversi (CAI, cammini) condividono tratti in senso opposto
        drop_return_legs(index, details)
        bike_codes(index)
    fix_from_to(index, details, Path(osm_path).with_name("luoghi.json"))
    # file di dettaglio scritti alla fine, quando i codici delle etichette sono definitivi
    for entry in index:
        detail = {k: v for k, v in entry.items() if k != "geom"} | details[entry["id"]]
        (out / "trails" / f"{entry['id']}.json").write_text(json.dumps(detail, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # percorsi spariti da OSM (o scartati): via anche i loro file
    # (restano quelli dei percorsi aggiuntivi da GPX, di tools/build_extra.py: id da 9000000000)
    keep = {f"{e['id']}.json" for e in index}
    for f in (out / "trails").glob("*.json"):
        if f.name not in keep and int(f.stem) < 9_000_000_000:
            f.unlink()

    index.sort(key=lambda e: (e["sector"], e["ref"].zfill(6), e["name"]))
    (out / "index.json").write_text(json.dumps({"generated": osm.get("osm3s", {}).get("timestamp_osm_base"),
                                                "trails": index}, ensure_ascii=False, separators=(",", ":")),
                                    encoding="utf-8")
    size = (out / "index.json").stat().st_size / 1e6
    print(f"{len(index)} percorsi, {total_pts} punti di dettaglio, index.json {size:.2f} MB")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--bici"]
    main(*args[:3], bike="--bici" in sys.argv)
