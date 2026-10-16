"""Restaurants, cafés and takeout in chosen metro areas, split into small tiles the page loads directly.

Asking a public map server live from the phone takes 15-35 seconds when the servers are busy; a tile from GitHub's
CDN loads in about a second. The data comes from Geofabrik's daily OpenStreetMap extracts (see osm_extract.py).
Tiles are 0.025 degrees (about 2.5 km), so a search loads only what is near: docs/food/<metro>/<i>_<j>.json with
i = floor(lat * 40), j = floor(lon * 40), holding rows of [lat, lon, name, tags, osm_id].

    python scripts/build_food_tiles.py           # every metro
    python scripts/build_food_tiles.py nyc       # one metro
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
OUT = ROOT / "docs" / "food"
AMENITIES = ["restaurant", "fast_food", "cafe", "food_court", "ice_cream", "pub", "bar"]
GRID = 40          # tiles per degree
BOX = 0.1          # the page checks coverage in boxes of this size
METROS = {
    # bounds (south, west, north, east) and the Geofabrik regions that cover them
    "nyc": {"bounds": (40.45, -74.30, 41.05, -73.65), "regions": ["us/new-york", "us/new-jersey", "us/connecticut"]},
}
KEEP = {"amenity", "cuisine", "opening_hours", "takeaway", "delivery", "outdoor_seating", "wheelchair", "phone",
        "contact:phone", "website", "contact:website", "website:menu", "menu:url", "addr:housenumber", "addr:street",
        "addr:city", "payment:cash", "payment:cards", "payment:credit_cards", "brand"}


def keep(tags: dict) -> dict:
    return {k: v for k, v in tags.items() if k in KEEP or k.startswith("diet:")}


def tile_key(lat: float, lon: float) -> str:
    return f"{math.floor(lat * GRID)}_{math.floor(lon * GRID)}"


def boxes(bounds):
    s, w, n, e = bounds
    out = []
    lat = s
    while lat < n - 1e-9:
        lon = w
        while lon < e - 1e-9:
            out.append((round(lat, 3), round(lon, 3), round(min(lat + BOX, n), 3), round(min(lon + BOX, e), 3)))
            lon += BOX
        lat += BOX
    return out


def box_id(box) -> str:
    """'40.75,-74,40.85,-73.9': the same text the page builds for a box."""
    return ",".join(f"{v:g}" for v in box)


def rows_from_objects(objs, bounds) -> list:
    """Named food places inside the bounds, one row per place (a place mapped as point and outline is kept once)."""
    s, w, n, e = bounds
    rows, seen = [], set()
    for osm_id, lat, lon, tags in objs:
        name = tags.get("name")
        if not name or tags.get("amenity") not in AMENITIES or not (s <= lat < n and w <= lon < e):
            continue
        key = (name.lower(), round(lat, 4), round(lon, 4))
        if key in seen:
            continue
        seen.add(key)
        rows.append([round(lat, 6), round(lon, 6), name, keep(tags), osm_id])
    return rows


def write_metro(metro: str, rows: list, bounds) -> dict:
    folder = OUT / metro
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    tiles = defaultdict(list)
    for r in rows:
        tiles[tile_key(r[0], r[1])].append(r)
    for key, tile_rows in tiles.items():
        tile_rows.sort(key=lambda r: r[4])
        (folder / f"{key}.json").write_text(json.dumps(tile_rows, ensure_ascii=False, separators=(",", ":")))
    today = time.strftime("%Y-%m-%d")
    return {"bounds": list(bounds), "tiles": sorted(tiles), "places": len(rows), "built": today,
            "boxes": {box_id(b): today for b in boxes(bounds)}}


def main(metros):
    try:
        index = json.loads((OUT / "index.json").read_text())
    except (OSError, ValueError):
        index = {"metros": {}}
    expr = ["nwr/amenity=" + ",".join(AMENITIES)]
    for metro in metros:
        m = METROS[metro]
        rows = rows_from_objects(osm_extract.region_objects(m["regions"], expr, "amenity"), m["bounds"])
        if len(rows) < 1000:
            sys.exit(f"{metro}: only {len(rows)} places; keeping the previous tiles")
        index["metros"][metro] = write_metro(metro, rows, m["bounds"])
        print(f"{metro}: {len(rows):,} places in {len(index['metros'][metro]['tiles'])} tiles")
    index.update(grid=GRID, box=BOX)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))


if __name__ == "__main__":
    main(sys.argv[1:] or list(METROS))
