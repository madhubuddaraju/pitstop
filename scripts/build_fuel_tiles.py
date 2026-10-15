"""Every gas station in the US from OpenStreetMap, split into 1-degree tiles the page loads directly.

Stations change slowly, so a weekly extract is fresher than needed and far faster and more reliable than asking a
public map server live from every phone. Each tile is docs/fuel/<lat>_<lon>.json (floor of the coordinates) and holds
rows of [lat, lon, name, opening_hours, diesel, address, osm_id].

    python scripts/build_fuel_tiles.py                 # fetch from Overpass and write tiles
    python scripts/build_fuel_tiles.py --from file.csv # rebuild tiles from a saved extract
"""

import argparse
import csv
import io
import json
import math
import shutil
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "fuel"
SERVERS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
FIELDS = ["::type", "::id", "::lat", "::lon", "name", "brand", "opening_hours", "fuel:diesel",
          "addr:housenumber", "addr:street", "addr:city"]
HEADER = "\t".join("@" + f[2:] if f.startswith("::") else f for f in FIELDS)
CSV = "[out:csv(" + ",".join(f'"{f}"' if ":" in f and not f.startswith("::") else f for f in FIELDS) + ';true;"\\t")]'
# 5-degree boxes over the lower 48, plus Alaska, Hawaii and Puerto Rico. One nationwide query is too heavy for the
# public servers, while a box takes a few seconds. Boxes include a little of Canada and Mexico, which is harmless.
BOXES = ([(lat, lon, lat + 5, lon + 5) for lat in range(24, 50, 5) for lon in range(-125, -65, 5)]
         + [(51, -180, 72, -129), (18, -161, 23, -154), (17.5, -68, 18.6, -65)])


def query(box) -> str:
    s, w, n, e = box
    return f"{CSV}[timeout:180];nwr[\"amenity\"=\"fuel\"]({s},{w},{n},{e});out center;"


def fetch() -> str:
    import requests
    session = requests.Session()
    session.headers["User-Agent"] = "pitstop-fuel-tiles/1.0 (github.com/madhubuddaraju/pitstop)"
    lines = [HEADER]
    for i, box in enumerate(BOXES):
        for attempt in range(4):
            url = SERVERS[attempt % len(SERVERS)]
            try:
                r = session.post(url, data={"data": query(box)}, timeout=240)
                if r.status_code == 200 and r.text.startswith("@type"):
                    rows = r.text.splitlines()[1:]
                    lines += rows
                    print(f"box {i + 1}/{len(BOXES)} {box}: {len(rows):,} stations ({url.split('/')[2]})")
                    break
                print(f"box {box}: {url} HTTP {r.status_code}", file=sys.stderr)
            except Exception as exc:
                print(f"box {box}: {url} {exc}", file=sys.stderr)
            time.sleep(10 * (attempt + 1))
        else:
            sys.exit(f"Could not fetch gas stations for box {box}")
        time.sleep(2)   # be gentle with the shared servers
    return "\n".join(lines) + "\n"


def tiles_from_csv(text: str) -> dict:
    tiles = defaultdict(list)
    seen = set()
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    for row in reader:
        try:
            lat, lon = float(row["@lat"]), float(row["@lon"])
        except (TypeError, ValueError, KeyError):
            continue
        name = (row.get("name") or row.get("brand") or "").strip() or "Gas station"
        key = (name.lower(), round(lat, 4), round(lon, 4))
        if key in seen:      # the same station mapped as a point and as an outline
            continue
        seen.add(key)
        street = " ".join(x for x in (row.get("addr:housenumber"), row.get("addr:street")) if x)
        address = ", ".join(x for x in (street, row.get("addr:city")) if x)
        tiles[f"{math.floor(lat)}_{math.floor(lon)}"].append([
            round(lat, 5), round(lon, 5), name, row.get("opening_hours") or "",
            1 if row.get("fuel:diesel") == "yes" else 0, address, f'{row["@type"]}/{row["@id"]}',
        ])
    return tiles


def write(tiles: dict) -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for key, rows in tiles.items():
        rows.sort(key=lambda r: r[6])
        (OUT / f"{key}.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
    (OUT / "index.json").write_text(json.dumps({"built": time.strftime("%Y-%m-%d"), "tiles": sorted(tiles),
                                                "stations": sum(map(len, tiles.values()))}, separators=(",", ":")))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--from", dest="src")
    args = p.parse_args()
    text = Path(args.src).read_text() if args.src else fetch()
    tiles = tiles_from_csv(text)
    n = sum(map(len, tiles.values()))
    if n < 50000 and not args.src:
        sys.exit(f"Only {n} stations; refusing to replace the tiles with a partial extract")
    write(tiles)
    biggest = max(tiles.items(), key=lambda kv: len(kv[1]))
    print(f"{n:,} stations in {len(tiles)} tiles; largest {biggest[0]} with {len(biggest[1]):,}")


if __name__ == "__main__":
    main()
