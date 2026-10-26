"""Scheda dati di ogni percorso, da cui si scrive a mano (o con un assistente) il testo del percorso
in data/descrizioni.json, sezione "percorsi". Solo fatti dai dati: luoghi attraversati in ordine con
progressiva e quota, tratti con nome e fondo, salite e discese, incroci con altri percorsi.

Uso: python -P -E tools/schede_percorsi.py [--bici] data/raw/osm_umbria.json data/raw/luoghi.json app/piedi/data out.txt [id …]
"""
import json
import math
import sys
from pathlib import Path

PATHS = {"path", "footway", "bridleway", "steps"}
PAVED = {"asphalt", "paved", "concrete", "concrete:plates", "paving_stones", "sett", "cobblestone", "chipseal"}
MAIN = {"primary", "primary_link", "secondary", "secondary_link", "trunk", "trunk_link"}
NEAR = {"place": 250, "peak": 150, "default": 80}


def hv(a, b, c, d):
    p1, p2 = math.radians(a), math.radians(c)
    x = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(d - b) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(x))


def kind(t):
    """Etichetta del luogo per la scheda, o None se non interessa."""
    if t.get("place") in ("city", "town"):
        return "città/paese"
    if t.get("place") == "village":
        return "paese"
    if t.get("place") == "hamlet":
        return "frazione/borgo"
    nat, am, hi, to = t.get("natural"), t.get("amenity"), t.get("historic"), t.get("tourism")
    if nat == "peak":
        return "cima"
    if nat == "saddle" or t.get("mountain_pass") == "yes":
        return "sella/valico"
    if nat == "spring":
        return "sorgente" + (" (acqua potabile)" if t.get("drinking_water") == "yes" else "")
    if am == "drinking_water":
        return "fontanella/acqua potabile"
    if am == "shelter":
        return "riparo/capanno"
    if nat == "cave_entrance":
        return "grotta"
    if nat == "gorge":
        return "gola"
    if nat == "water":
        return "lago/specchio d'acqua"
    if t.get("waterway") == "waterfall":
        return "cascata"
    if to in ("alpine_hut", "wilderness_hut"):
        return "rifugio"
    if to == "viewpoint":
        return "punto panoramico"
    if hi in ("monastery",) or am == "monastery":
        return "convento/abbazia/eremo"
    if hi in ("castle", "fort", "tower"):
        return "castello/torre"
    if hi in ("ruins",):
        return "rovine"
    if hi in ("archaeological_site",):
        return "sito archeologico"
    if hi in ("aqueduct", "bridge"):
        return "acquedotto/ponte storico"
    if am == "place_of_worship" or hi in ("church", "chapel", "wayside_shrine"):
        return "chiesa/cappella/edicola"
    if hi in ("memorial", "monument"):
        return "monumento/lapide"
    if t.get("leisure") == "nature_reserve":
        return "area protetta"
    if to == "attraction" or hi:
        return "luogo d'interesse"
    return None


def surface(t):
    hw, sf = t.get("highway"), t.get("surface", "")
    if hw in PATHS:
        return "strada lastricata/asfaltata" if sf in PAVED else ("scalinata" if hw == "steps" else "sentiero")
    if hw == "track":
        return "strada asfaltata" if sf in PAVED else "carrareccia/sterrata"
    if hw == "cycleway":
        return "pista ciclabile"
    if hw in MAIN:
        return "strada principale (traffico)"
    if hw:
        return "strada sterrata" if sf and sf not in PAVED else "strada asfaltata o di paese"
    return "?"


def km(m):
    return f"{m / 1000:.1f}".replace(".", ",")


def main(osm_path, places_path, data_dir, out_path, ids=(), bike=False):
    osm = json.load(open(osm_path, encoding="utf-8"))
    rels = {e["id"]: e for e in osm["elements"] if e["type"] == "relation"}
    way_tags = {e["id"]: e.get("tags", {}) for e in osm["elements"] if e["type"] == "way"}
    places = []
    for e in json.load(open(places_path, encoding="utf-8"))["elements"]:
        t = e.get("tags", {})
        c = e if "lat" in e else e.get("center")
        k = kind(t)
        if c and k:
            places.append((c["lat"], c["lon"], t.get("name", ""), k, t.get("ele", ""), t))
    data = Path(data_dir)
    index = json.load(open(data / "index.json", encoding="utf-8"))["trails"]
    texts = json.load(open(Path(__file__).resolve().parent.parent / "data" / "descrizioni.json", encoding="utf-8"))
    others = [(t, [p for seg in t["geom"] for p in seg]) for t in index]
    out = []
    for entry in index:
        if ids and str(entry["id"]) not in ids:
            continue
        d = json.loads((data / "trails" / f"{entry['id']}.json").read_text(encoding="utf-8"))
        tags = d.get("tags", {})
        pts = [p for seg in d["segments"] for p in seg]
        cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            cum.append(cum[-1] + hv(a[0], a[1], b[0], b[1]))
        total = cum[-1] or 1
        loop = hv(*d["start"], *d["end"]) < 300 and d["len"] > 1000
        lines = [f"## {d['id']} · {d.get('ref') or '-'} · {d.get('name') or '(senza nome)'}",
                 f"Settore: {d['sector']} · {'anello' if loop else 'lineare'} · {km(d['len'])} km · "
                 f"salita {d.get('up')} m, discesa {d.get('down')} m · difficoltà {d.get('scale') or 'non indicata'}"
                 + (f" · tipo {d['kind']}" if bike else "") + (f" · {d['gaps']} interruzioni nei dati" if d.get("gaps") else ""),
                 f"Da: {d.get('from') or '-'} · A: {d.get('to') or '-'}" + (f" · Via: {tags['via']}" if tags.get("via") else "")]
        for k in ("description:it", "description", "note:it", "note", "mtb:description", "operator", "network", "roundtrip",
                  "symbol:it", "osmc:symbol", "website"):
            if tags.get(k):
                lines.append(f"OSM {k}: {tags[k]}")
        b = d["bbox"]
        # profilo: estremi e salite/discese principali (isteresi 40 m)
        eles = [(c, p[2]) for c, p in zip(cum, pts) if p[2] is not None]
        if eles:
            top = max(eles, key=lambda e: e[1])
            low = min(eles, key=lambda e: e[1])
            lines.append(f"Quote: partenza {eles[0][1]} m, arrivo {eles[-1][1]} m, massima {top[1]} m al km {km(top[0])}, "
                         f"minima {low[1]} m al km {km(low[0])}")
            ext, trend = [eles[0]], 0
            for c, e in eles[1:]:
                if trend == 0:
                    if abs(e - ext[0][1]) >= 40:
                        trend = 1 if e > ext[0][1] else -1
                        ext.append((c, e))
                elif (e - ext[-1][1]) * trend > 0:
                    ext[-1] = (c, e)  # continua nella stessa direzione: sposta l'estremo
                elif abs(e - ext[-1][1]) >= 40:
                    trend = -trend
                    ext.append((c, e))
            moves = []
            for (c1, e1), (c2, e2) in zip(ext, ext[1:]):
                if abs(e2 - e1) >= 80 and c2 > c1:
                    moves.append(f"{'salita' if e2 > e1 else 'discesa'} km {km(c1)}–{km(c2)}: {e1}→{e2} m "
                                 f"({round(abs(e2 - e1) / (c2 - c1) * 100)}%)")
            if moves:
                lines.append("Tratti: " + "; ".join(moves))
        # luoghi lungo il tracciato
        seen = {}
        step = max(1, len(pts) // 600)
        for lat, lon, name, k, ele, t in places:
            if not (b[0] - 0.004 <= lat <= b[2] + 0.004 and b[1] - 0.005 <= lon <= b[3] + 0.005):
                continue
            lim = NEAR["place"] if k.endswith("paese") or k.startswith("frazione") else NEAR["peak"] if k == "cima" else NEAR["default"]
            i = min(range(0, len(pts), step), key=lambda i: hv(pts[i][0], pts[i][1], lat, lon))
            dist = hv(pts[i][0], pts[i][1], lat, lon)
            if dist > lim:
                continue
            key = (name or k, round(cum[i] / 300))
            if key in seen:
                continue
            seen[key] = (cum[i], f"km {km(cum[i])}: {name or '(senza nome)'} [{k}" + (f", {ele} m" if ele else "")
                         + (f", quota traccia {pts[i][2]} m" if pts[i][2] is not None else "") + f", a {round(dist)} m]")
        if d["len"] > 40000:  # percorsi lunghi: solo paesi, cime e monumenti principali
            seen = {k: v for k, v in seen.items() if any(w in v[1] for w in ("paese", "città", "cima", "convento", "castello"))}
        if seen:
            lines.append("Luoghi lungo il percorso:")
            lines += ["  " + s for _, s in sorted(seen.values())][:40]
        # tratti per nome e fondo, nell'ordine dei membri della relazione
        rel = rels.get(d["id"])
        if rel:
            mem = [m for m in rel["members"] if m["type"] == "way" and m.get("role", "") in ("", "main", "forward", "backward")]
            geo = [[(p["lat"], p["lon"]) for p in m.get("geometry", []) if p] for m in mem]
            if mem and geo[0] and geo[-1]:
                start = pts[0][:2]
                d_first = min(hv(*geo[0][0], *start), hv(*geo[0][-1], *start))
                d_last = min(hv(*geo[-1][0], *start), hv(*geo[-1][-1], *start))
                if d_last < d_first:
                    mem, geo = mem[::-1], geo[::-1]  # relazione mappata nel verso opposto alla traccia
            secs, pos = [], 0.0
            for m, g in zip(mem, geo):
                ln = sum(hv(*a, *c) for a, c in zip(g, g[1:]))
                t = way_tags.get(m["ref"], {})
                label = surface(t) + (f" «{t['name']}»" if t.get("name") else "")
                if secs and secs[-1][2] == label:
                    secs[-1][1] = pos + ln
                else:
                    secs.append([pos, pos + ln, label])
                pos += ln
            merged = []
            for s in (s for s in secs if s[1] - s[0] >= 150):  # via i pezzetti, poi riunisci i tratti uguali
                if merged and merged[-1][2] == s[2]:
                    merged[-1][1] = s[1]
                else:
                    merged.append(s)
            secs = merged
            if secs:
                lines.append("Fondo (ordine dei tratti, progressive approssimative):")
                lines += [f"  km {km(a)}–{km(c)}: {lab}" for a, c, lab in secs[:40]]
        # incroci e tratti in comune con altri percorsi
        contacts = []
        for o, opts in others:
            if o["id"] == d["id"] or o["bbox"][0] > b[2] or o["bbox"][2] < b[0] or o["bbox"][1] > b[3] or o["bbox"][3] < b[1]:
                continue
            hits = [c for c, p in zip(cum[::step * 3], pts[::step * 3])
                    if any(abs(p[0] - q[0]) < 0.0006 and abs(p[1] - q[1]) < 0.0008 for q in opts)]
            if hits:
                contacts.append((hits[0], hits[-1], o))
        if contacts:
            lines.append("Incroci/tratti in comune con altri percorsi:")
            for a, c, o in sorted(contacts, key=lambda x: x[0])[:20]:
                lines.append(f"  km {km(a)}" + (f"–{km(c)}" if c - a > 300 else "") +
                             f": {o.get('ref') or '-'} {o.get('name') or ''}".rstrip())
        notes = [k for k in texts["luoghi"] if k.lstrip("=") and any(
            k.lstrip("=").lower() in s.lower() for s in [d.get("from", ""), d.get("to", ""), tags.get("via", "")] + [x[1] for x in seen.values()])]
        if notes:
            lines.append("Luoghi che hanno già una nota storica a parte (non ripeterne la storia): " + ", ".join(k.lstrip("=") for k in notes))
        out.append("\n".join(lines))
    Path(out_path).write_text("\n\n".join(out) + "\n", encoding="utf-8")
    print(f"{len(out)} schede in {out_path}")


if __name__ == "__main__":
    bike = "--bici" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--bici"]
    main(*args[:4], ids=set(args[4:]), bike=bike)
