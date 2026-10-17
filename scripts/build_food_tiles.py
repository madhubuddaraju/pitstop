"""Restaurants, cafés and takeout in the largest US metro areas, split into small tiles the page loads directly.

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
    "la": {"bounds": (33.65, -118.70, 34.35, -117.65), "regions": ["us/california"]},
    "sf": {"bounds": (37.20, -122.55, 38.05, -121.75), "regions": ["us/california"]},
    "sandiego": {"bounds": (32.55, -117.30, 33.10, -116.90), "regions": ["us/california"]},
    "chicago": {"bounds": (41.60, -88.00, 42.15, -87.50), "regions": ["us/illinois", "us/indiana"]},
    "houston": {"bounds": (29.50, -95.75, 30.10, -95.05), "regions": ["us/texas"]},
    "dallas": {"bounds": (32.55, -97.50, 33.20, -96.55), "regions": ["us/texas"]},
    "austin": {"bounds": (30.10, -97.95, 30.55, -97.55), "regions": ["us/texas"]},
    "dc": {"bounds": (38.75, -77.25, 39.10, -76.85), "regions": ["us/district-of-columbia", "us/maryland", "us/virginia"]},
    "boston": {"bounds": (42.20, -71.25, 42.50, -70.95), "regions": ["us/massachusetts"]},
    "philadelphia": {"bounds": (39.85, -75.35, 40.15, -74.95), "regions": ["us/pennsylvania", "us/new-jersey"]},
    "miami": {"bounds": (25.60, -80.45, 26.20, -80.05), "regions": ["us/florida"]},
    "orlando": {"bounds": (28.30, -81.55, 28.70, -81.20), "regions": ["us/florida"]},
    "atlanta": {"bounds": (33.55, -84.60, 34.05, -84.20), "regions": ["us/georgia"]},
    "seattle": {"bounds": (47.45, -122.45, 47.80, -122.10), "regions": ["us/washington"]},
    "phoenix": {"bounds": (33.25, -112.35, 33.75, -111.75), "regions": ["us/arizona"]},
    "vegas": {"bounds": (35.95, -115.35, 36.35, -114.95), "regions": ["us/nevada"]},
    "denver": {"bounds": (39.55, -105.15, 39.90, -104.75), "regions": ["us/colorado"]},
}
KEEP = {"amenity", "cuisine", "opening_hours", "takeaway", "delivery", "outdoor_seating", "wheelchair", "phone",
        "contact:phone", "website", "contact:website", "website:menu", "menu:url", "addr:housenumber", "addr:street",
        "addr:city", "payment:cash", "payment:cards", "payment:credit_cards", "brand", "happy_hours"}


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


def objects_by_metro(metros, expr):
    """Download each Geofabrik region once and hand its objects to every metro inside it (California serves three)."""
    regions = sorted({r for m in metros for r in METROS[m]["regions"]})
    found = {m: [] for m in metros}
    for region in regions:
        users = [m for m in metros if region in METROS[m]["regions"]]
        for obj in osm_extract.region_objects([region], expr, "amenity"):
            _, lat, lon, _ = obj
            for m in users:
                s, w, n, e = METROS[m]["bounds"]
                if s <= lat < n and w <= lon < e:
                    found[m].append(obj)
        print(f"{region}: done for {', '.join(users)}", file=sys.stderr)
    return found


def main(metros):
    try:
        index = json.loads((OUT / "index.json").read_text())
    except (OSError, ValueError):
        index = {"metros": {}}
    expr = ["nwr/amenity=" + ",".join(AMENITIES)]
    found = objects_by_metro(metros, expr)
    failed = []
    for metro in metros:
        rows = rows_from_objects(found[metro], METROS[metro]["bounds"])
        if len(rows) < 1000:
            # something went wrong with this region today: keep yesterday's tiles for this metro
            failed.append(metro)
            print(f"{metro}: only {len(rows)} places; keeping the previous tiles", file=sys.stderr)
            continue
        index["metros"][metro] = write_metro(metro, rows, METROS[metro]["bounds"])
        print(f"{metro}: {len(rows):,} places in {len(index['metros'][metro]['tiles'])} tiles")
    index.update(grid=GRID, box=BOX)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    if failed and len(failed) == len(metros):
        sys.exit("no metro could be built")


if __name__ == "__main__":
    main(sys.argv[1:] or list(METROS))
