"""Restaurants, cafés and takeout in chosen metro areas from OpenStreetMap, split into small tiles the page loads directly.

Asking a public map server live from the phone takes 15-35 seconds when the servers are busy; a tile from GitHub's
CDN loads in about a second. Tiles are 0.025 degrees (about 2.5 km) so a search loads only what is near.
Each tile is docs/food/<metro>/<i>_<j>.json, with i = floor(lat * 40), j = floor(lon * 40), and holds rows of
[lat, lon, name, tags, osm_id] where tags keeps only what the page uses.

    python scripts/build_food_tiles.py           # fetch every metro, box by box
    python scripts/build_food_tiles.py nyc       # one metro
"""

import json
import math
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "food"
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
AMENITIES = "restaurant|fast_food|cafe|food_court|ice_cream|pub|bar"
GRID = 40          # tiles per degree
BOX = 0.1          # degrees per Overpass request
METROS = {
    # south, west, north, east
    "nyc": (40.45, -74.30, 41.05, -73.65),
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


def query(box) -> str:
    s, w, n, e = box
    return f'[out:json][timeout:120];nwr["amenity"~"^({AMENITIES})$"]["name"]({s},{w},{n},{e});out center tags;'


def rows_from_overpass(data: dict) -> list:
    rows, seen = [], set()
    for el in data.get("elements", []):
        lat = el.get("lat", (el.get("center") or {}).get("lat"))
        lon = el.get("lon", (el.get("center") or {}).get("lon"))
        tags = el.get("tags") or {}
        name = tags.get("name")
        if lat is None or lon is None or not name:
            continue
        key = (name.lower(), round(lat, 4), round(lon, 4))
        if key in seen:                       # mapped as both a point and a building outline
            continue
        seen.add(key)
        rows.append([round(lat, 6), round(lon, 6), name, keep(tags), f'{el["type"]}/{el["id"]}'])
    return rows


def fetch_box(session, box):
    for attempt in range(3):
        url = SERVERS[attempt % len(SERVERS)]
        try:
            r = session.post(url, data={"data": query(box)}, timeout=150)
            if r.status_code == 200:
                data = r.json()
                if "remark" in data and "runtime error" in data["remark"]:
                    raise ValueError(data["remark"][:80])
                return data
            print(f"  {box}: {url.split('/')[2]} HTTP {r.status_code}", file=sys.stderr)
        except Exception as exc:
            print(f"  {box}: {url.split('/')[2]} {type(exc).__name__} {exc}"[:200], file=sys.stderr)
        time.sleep(5 * (attempt + 1))
    return None


def tile_in_box(key: str, box) -> bool:
    """A tile belongs to a box when its south-west corner is inside it (boxes are multiples of the tile size)."""
    i, j = map(int, key.split("_"))
    s, w, n, e = box
    return s - 1e-9 <= i / GRID < n - 1e-9 and w - 1e-9 <= j / GRID < e - 1e-9


def write_metro(metro: str, rows_by_box: dict, bounds) -> dict:
    folder = OUT / metro
    folder.mkdir(parents=True, exist_ok=True)
    tiles = defaultdict(list)
    for rows in rows_by_box.values():
        for r in rows:
            tiles[tile_key(r[0], r[1])].append(r)
    for f in folder.glob("*_*.json"):
        if any(tile_in_box(f.stem, b) for b in rows_by_box):
            f.unlink()
    for key, rows in tiles.items():
        rows.sort(key=lambda r: r[4])
        (folder / f"{key}.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
    keys = sorted(f.stem for f in folder.glob("*_*.json"))
    places = sum(len(json.loads((folder / f"{k}.json").read_text())) for k in keys)
    return {"bounds": bounds, "tiles": keys, "places": places, "built": time.strftime("%Y-%m-%d")}


def main(metros):
    import requests
    session = requests.Session()
    session.headers["User-Agent"] = "pitstop-food-tiles/1.0 (github.com/madhubuddaraju/pitstop)"
    try:
        index = json.loads((OUT / "index.json").read_text())
    except (OSError, ValueError):
        index = {"grid": GRID, "metros": {}}
    for metro in metros:
        bounds = METROS[metro]
        got, failed = {}, 0
        for box in boxes(bounds):
            data = fetch_box(session, box)
            if data is None:
                failed += 1
                continue
            got[box] = rows_from_overpass(data)
            time.sleep(1)
        if not got:
            print(f"{metro}: nothing fetched", file=sys.stderr)
            continue
        index["metros"][metro] = write_metro(metro, got, bounds)
        m = index["metros"][metro]
        print(f"{metro}: {m['places']:,} places in {len(m['tiles'])} tiles; {len(got)} boxes fetched, {failed} kept from before")
    index["grid"] = GRID
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))


if __name__ == "__main__":
    main(sys.argv[1:] or list(METROS))
