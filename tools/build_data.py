"""Converte i dati OSM + DEM nei file usati dalla PWA.

Uso: python -P -E tools/build_data.py data/raw/osm_umbria.json data/raw/dem app/data

Produce:
  app/data/index.json      elenco sentieri + geometria semplificata per la mappa generale
  app/data/trails/<id>.json traccia dettagliata ordinata con quote, per la navigazione
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
]

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


def is_cai(tags):
    """Sentiero del catasto CAI: operatore CAI, codice REI o rilievo CAI dichiarato."""
    op = tags.get("operator", "").lower()
    return ("club alpino" in op or op.startswith("cai") or "ref:REI" in tags
            or "cai" in tags.get("source", "").lower())


def r5(v):
    return round(v, 5)


def main(osm_path, dem_dir, out_dir):
    osm = json.load(open(osm_path, encoding="utf-8"))
    dem = Dem(Path(dem_dir))
    umbria = load_boundary(Path(osm_path).with_name("umbria_confine.json"))
    out = Path(out_dir)
    (out / "trails").mkdir(parents=True, exist_ok=True)

    rels = {e["id"]: e for e in osm["elements"] if e["type"] == "relation"}
    index = []
    total_pts = 0

    for rid, rel in rels.items():
        tags = rel.get("tags", {})
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
        segments = chain_ways(main_ways)
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
            for a, b in zip(s, s[1:]):
                length += haversine(*a, *b)
            all_eles += [p[2] for p in pts if p[2] is not None]
            detail_segs.append(pts)
            ov_segs.append([[round(lat, 4), round(lon, 4)] for lat, lon in simplify(seg, SIMPLIFY_OVERVIEW_M, lat0)])
            total_pts += len(pts)

        extras = []
        for role, w in extra_ways:
            if len(w) >= 2:
                extras.append({"role": role, "pts": [[r5(a), r5(b)] for a, b in simplify(w, SIMPLIFY_DETAIL_M, lat0)]})

        up, down = ascent_descent(all_eles) if all_eles else (None, None)
        flat = [p for seg in detail_segs for p in seg]
        lats = [p[0] for p in flat]
        lons = [p[1] for p in flat]
        info = {k: tags[k] for k in KEEP_TAGS if k in tags}
        entry = {
            "id": rid,
            "ref": tags.get("ref", ""),
            "name": tags.get("name") or tags.get("name:it") or "",
            "from": tags.get("from", ""),
            "to": tags.get("to", ""),
            "sector": sector_of(tags, share_inside(umbria, flat)),
            "scale": tags.get("cai_scale", ""),
            "cai": is_cai(tags),
            "len": round(length),
            "up": up,
            "down": down,
            "bbox": [min(lats), min(lons), max(lats), max(lons)],
            "start": flat[0][:2],
            "end": flat[-1][:2],
            "gaps": len(detail_segs) - 1,
            "geom": ov_segs,
        }
        index.append(entry)
        detail = {k: v for k, v in entry.items() if k != "geom"}
        detail.update({"tags": info, "segments": detail_segs, "extras": extras})
        (out / "trails" / f"{rid}.json").write_text(json.dumps(detail, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    index.sort(key=lambda e: (e["sector"], e["ref"].zfill(6), e["name"]))
    (out / "index.json").write_text(json.dumps({"generated": osm.get("osm3s", {}).get("timestamp_osm_base"),
                                                "trails": index}, ensure_ascii=False, separators=(",", ":")),
                                    encoding="utf-8")
    size = (out / "index.json").stat().st_size / 1e6
    print(f"{len(index)} sentieri, {total_pts} punti di dettaglio, index.json {size:.2f} MB")


if __name__ == "__main__":
    main(*sys.argv[1:4])
