"""Every gas station in the US from OpenStreetMap, split into 1-degree tiles the page loads directly.

Stations change slowly, so a weekly extract is far faster and more reliable than asking a public map server live
from every phone. The data comes from Geofabrik's US regional extracts (see osm_extract.py), downloaded one at a
time. Each tile is docs/fuel/<lat>_<lon>.json (floor of the coordinates) holding rows of
[lat, lon, name, opening_hours, diesel, address, osm_id].

    python scripts/build_fuel_tiles.py
"""

import json
import math
import shutil
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import osm_extract  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "fuel"
REGIONS = ["us-northeast", "us-south", "us-midwest", "us-west", "us-pacific", "us/puerto-rico"]


def rows_by_tile(objs) -> dict:
    tiles = defaultdict(list)
    seen = set()
    for osm_id, lat, lon, tags in objs:
        if tags.get("amenity") != "fuel":
            continue
        name = (tags.get("name") or tags.get("brand") or "").strip() or "Gas station"
        key = (name.lower(), round(lat, 4), round(lon, 4))
        if key in seen:      # the same station mapped as a point and as an outline
            continue
        seen.add(key)
        street = " ".join(x for x in (tags.get("addr:housenumber"), tags.get("addr:street")) if x)
        address = ", ".join(x for x in (street, tags.get("addr:city")) if x)
        tiles[f"{math.floor(lat)}_{math.floor(lon)}"].append([
            round(lat, 5), round(lon, 5), name, tags.get("opening_hours") or "",
            1 if tags.get("fuel:diesel") == "yes" else 0, address, osm_id,
        ])
    return tiles


def write(tiles: dict) -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for key, rows in tiles.items():
        rows.sort(key=lambda r: r[6])
        (OUT / f"{key}.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
    total = sum(map(len, tiles.values()))
    (OUT / "index.json").write_text(json.dumps({"built": time.strftime("%Y-%m-%d"), "tiles": sorted(tiles),
                                                "stations": total}, separators=(",", ":")))
    print(f"{total:,} stations in {len(tiles)} tiles")


def main():
    tiles = rows_by_tile(osm_extract.region_objects(REGIONS, ["nwr/amenity=fuel"], "amenity"))
    n = sum(map(len, tiles.values()))
    if n < 50000:
        sys.exit(f"Only {n} stations; keeping the previous tiles")
    write(tiles)


if __name__ == "__main__":
    main()
