"""Scarica i tile Copernicus DEM GLO-30 che coprono l'Umbria.

Uso: python -I tools/fetch_dem.py data/raw/dem
"""
import sys
import urllib.request
from pathlib import Path

BASE = "https://copernicus-dem-30m.s3.amazonaws.com"
LATS = [42, 43]
LONS = [11, 12, 13]


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for lat in LATS:
        for lon in LONS:
            name = f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
            dest = out / f"{name}.tif"
            if dest.exists():
                print(f"Già presente {dest.name}")
                continue
            print(f"Scarico {name} ...")
            urllib.request.urlretrieve(f"{BASE}/{name}/{name}.tif", dest)
            print(f"  {dest.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main(sys.argv[1])
