"""Percorsi aggiuntivi da tracce GPX: un database separato da quello di OpenStreetMap.

Le tracce stanno in data/extra/<slug>.json (solo coordinate, senza orari) e i dati di ogni percorso
(nome, fonte, autore, testo) in data/extra/extra.json. L'app li legge da data/extra.json accanto a index.json.

Uso: python -X utf8 -P -E tools/build_extra.py add file.gpx slug      # traccia GPX → data/extra/slug.json
     python -X utf8 -P -E tools/build_extra.py build data/raw/dem     # extra.json → app/*/data
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_data as bd  # noqa: E402

EXTRA_DIR = Path("data/extra")
APPS = {"piedi": Path("app/piedi/data"), "bici": Path("app/bici/data")}
ID_MIN = 9_000_000_000  # gli id dei percorsi aggiuntivi non si confondono con quelli delle relazioni OSM


def read_gpx(path):
    """Segmenti [(lat, lon), …] di tutte le tracce del file, senza quota né orari."""
    segments = []
    for seg in ET.parse(path).getroot().iter():
        if seg.tag.endswith("}trkseg") or seg.tag == "trkseg":
            pts = [(float(p.get("lat")), float(p.get("lon"))) for p in seg if p.tag.endswith("trkpt")]
            if len(pts) > 1:
                segments.append(pts)
    return segments


def add(gpx, slug):
    segments = read_gpx(gpx)
    if not segments:
        raise SystemExit("Nessuna traccia (trkseg) nel file GPX")
    lat0 = segments[0][0][0]
    out = [[[bd.r5(lat), bd.r5(lon)] for lat, lon in bd.simplify(s, bd.SIMPLIFY_DETAIL_M, lat0)] for s in segments]
    EXTRA_DIR.mkdir(parents=True, exist_ok=True)
    (EXTRA_DIR / f"{slug}.json").write_text(json.dumps({"segments": out}, separators=(",", ":")), encoding="utf-8")
    print(f"{slug}: {sum(len(s) for s in out)} punti")


def build_one(meta, dem):
    segments = [[tuple(p) for p in s] for s in json.loads((EXTRA_DIR / f"{meta['slug']}.json").read_text(encoding="utf-8"))["segments"]]
    lat0 = segments[0][0][0]
    detail_segs, ov_segs, eles = [], [], []
    length = 0.0
    for seg in segments:
        pts = []
        for lat, lon in bd.densify(bd.simplify(seg, bd.SIMPLIFY_DETAIL_M, lat0), bd.DENSIFY_M):
            e = dem.ele(lat, lon)
            pts.append([bd.r5(lat), bd.r5(lon), None if e is None else round(e)])
        length += sum(bd.haversine(*a, *b) for a, b in zip(seg, seg[1:]))
        eles += [p[2] for p in pts if p[2] is not None]
        detail_segs.append(pts)
        ov_segs.append([[round(lat, 4), round(lon, 4)] for lat, lon in bd.simplify(seg, bd.SIMPLIFY_OVERVIEW_M, lat0)])
    up, down = bd.ascent_descent(eles) if eles else (None, None)
    flat = [p for s in detail_segs for p in s]
    lats, lons = [p[0] for p in flat], [p[1] for p in flat]
    entry = {
        "id": meta["id"], "ref": meta.get("ref", ""), "name": meta["nome"], "from": meta.get("partenza", ""), "to": meta.get("arrivo", ""),
        "sector": meta["settore"], "scale": meta.get("grado", ""), "cai": False,
        "len": round(length), "up": up, "down": down,
        "bbox": [min(lats), min(lons), max(lats), max(lons)], "start": flat[0][:2], "end": flat[-1][:2],
        "gaps": len(detail_segs) - 1, "main": None, "geom": ov_segs,
        "extra": {k: meta[k] for k in ("fonte", "autore", "url") if meta.get(k)},
    }
    if meta["modo"] == "bici":
        entry["kind"] = meta.get("tipo", "mtb")
    detail = {k: v for k, v in entry.items() if k != "geom"} | {
        "tags": {"from": entry["from"], "to": entry["to"]}, "segments": detail_segs, "extras": [], "desc": meta["testo"],
    }
    return entry, detail


def build(dem_dir):
    metas = json.loads((EXTRA_DIR / "extra.json").read_text(encoding="utf-8"))
    dem = bd.Dem(Path(dem_dir))
    for mode, out in APPS.items():
        entries = []
        keep = set()
        for meta in (m for m in metas if m["modo"] == mode):
            assert meta["id"] >= ID_MIN, f"{meta['slug']}: id sotto {ID_MIN}"
            entry, detail = build_one(meta, dem)
            (out / "trails").mkdir(parents=True, exist_ok=True)
            (out / "trails" / f"{entry['id']}.json").write_text(json.dumps(detail, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            keep.add(f"{entry['id']}.json")
            entries.append(entry)
        for f in (out / "trails").glob("*.json"):  # percorsi aggiuntivi tolti dall'elenco
            if int(f.stem) >= ID_MIN and f.name not in keep:
                f.unlink()
        (out / "extra.json").write_text(json.dumps({"trails": entries}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{mode}: {len(entries)} percorsi aggiuntivi")


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    {"add": add, "build": build}[cmd](*args)
