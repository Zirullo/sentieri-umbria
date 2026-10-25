"""Converte i dati OSM + DEM nei file usati dalla PWA.

Uso: python -P -E tools/build_data.py data/raw/osm_umbria.json data/raw/dem app/piedi/data
     python -P -E tools/build_data.py --bici data/raw/osm_umbria_bici.json data/raw/dem app/bici/data

Produce:
  app/piedi/data/index.json      elenco sentieri + geometria semplificata per la mappa generale
  app/piedi/data/trails/<id>.json traccia dettagliata ordinata con quote, per la navigazione
"""
import json
import math
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

# Strade principali, dove il traffico è veloce e può essere pericoloso: statali e regionali/provinciali
# di primo livello (primary, secondary). Non contano le provinciali minori di collegamento tra paesi
# (tertiary, in Umbria spesso tranquille), le strade comunali, di campagna o residenziali,
# né i tratti chiusi alle auto o con una pista ciclabile separata dalla carreggiata (cycleway=track).
MAIN_HIGHWAYS = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
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
        bike_codes(index)
    # file di dettaglio scritti alla fine, quando i codici delle etichette sono definitivi
    for entry in index:
        detail = {k: v for k, v in entry.items() if k != "geom"} | details[entry["id"]]
        (out / "trails" / f"{entry['id']}.json").write_text(json.dumps(detail, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # percorsi spariti da OSM (o scartati): via anche i loro file
    keep = {f"{e['id']}.json" for e in index}
    for f in (out / "trails").glob("*.json"):
        if f.name not in keep:
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
