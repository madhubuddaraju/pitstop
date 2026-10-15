"""Every gas station in the US from OpenStreetMap, split into 1-degree tiles the page loads directly.

Stations change slowly, so a weekly extract is fresher than needed and far faster and more reliable than asking a
public map server live from every phone. Each tile is docs/fuel/<lat>_<lon>.json (floor of the coordinates) and holds
rows of [lat, lon, name, opening_hours, diesel, address, osm_id].

    python scripts/build_fuel_tiles.py                 # fetch from Overpass box by box and update the tiles
    python scripts/build_fuel_tiles.py --from file.csv # rebuild tiles from a saved extract

The public servers sometimes turn a box away; that box keeps last week's tiles and is retried next run.
"""

import argparse
import csv
import io
import json
import math
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "fuel"
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
FIELDS = ["::type", "::id", "::lat", "::lon", "name", "brand", "opening_hours", "fuel:diesel",
          "addr:housenumber", "addr:street", "addr:city"]
HEADER = "\t".join("@" + f[2:] if f.startswith("::") else f for f in FIELDS)
CSV = "[out:csv(" + ",".join(f'"{f}"' if ":" in f and not f.startswith("::") else f for f in FIELDS) + ';true;"\\t")]'
# 5-degree boxes over the lower 48, plus Alaska, Hawaii and Puerto Rico. One nationwide query is too heavy for the
# public servers, while a box takes a few seconds. Boxes include a little of Canada and Mexico, which is harmless.
BOXES = ([(lat, lon, lat + 5, lon + 5) for lat in range(24, 50, 5) for lon in range(-125, -65, 5)]
         + [(51, -180, 72, -129), (18, -161, 23, -154), (17, -68, 19, -65)])


def query(box) -> str:
    s, w, n, e = box
    return f"{CSV}[timeout:180];nwr[\"amenity\"=\"fuel\"]({s},{w},{n},{e});out center;"


BUDGET_MIN = 25   # keep the weekly job short; boxes not reached keep their tiles until next week


def fetch_box(session, box) -> str | None:
    """CSV text for one box, trying each server in turn; None if all of them fail."""
    for attempt in range(3):
        url = SERVERS[attempt % len(SERVERS)]
        try:
            r = session.post(url, data={"data": query(box)}, timeout=120)
            if r.status_code == 200 and r.text.startswith("@type"):
                return r.text
            print(f"  {box}: {url.split('/')[2]} HTTP {r.status_code}", file=sys.stderr)
        except Exception as exc:
            print(f"  {box}: {url.split('/')[2]} {type(exc).__name__}", file=sys.stderr)
        time.sleep(5 * (attempt + 1))
    return None


def in_box(key: str, box) -> bool:
    lat, lon = map(int, key.split("_"))
    s, w, n, e = box
    return s <= lat < n and w <= lon < e


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


def box_id(box) -> str:
    return ",".join(str(v) for v in box)


def previous_boxes() -> dict:
    try:
        return json.loads((OUT / "index.json").read_text()).get("boxes", {})
    except (OSError, ValueError):
        return {}


def write(tiles: dict, boxes) -> None:
    """Replace the tiles inside the boxes that were fetched; tiles of boxes that failed this time are kept."""
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*_*.json"):
        if any(in_box(f.stem, b) for b in boxes):
            f.unlink()
    for key, rows in tiles.items():
        rows.sort(key=lambda r: r[6])
        (OUT / f"{key}.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
    keys = sorted(f.stem for f in OUT.glob("*_*.json"))
    total = sum(len(json.loads((OUT / f"{k}.json").read_text())) for k in keys)
    fetched = previous_boxes() | {box_id(b): time.strftime("%Y-%m-%d") for b in boxes}
    (OUT / "index.json").write_text(json.dumps({"built": time.strftime("%Y-%m-%d"), "tiles": keys, "stations": total,
                                                "boxes": fetched}, separators=(",", ":")))
    print(f"{total:,} stations in {len(keys)} tiles; {len(fetched)} of {len(BOXES)} boxes fetched at least once")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--from", dest="src", help="rebuild every tile from a saved CSV extract")
    args = p.parse_args()
    if args.src:
        write(tiles_from_csv(Path(args.src).read_text()), BOXES)
        return
    import requests
    session = requests.Session()
    session.headers["User-Agent"] = "pitstop-fuel-tiles/1.0 (github.com/madhubuddaraju/pitstop)"
    done, failed, tiles = [], [], {}
    started = time.time()
    # boxes never fetched or fetched longest ago go first, so boxes skipped in earlier runs get their turn
    fetched = previous_boxes()
    order = sorted(BOXES, key=lambda b: fetched.get(box_id(b), ""))
    for i, box in enumerate(order):
        if time.time() - started > BUDGET_MIN * 60:
            failed.append(box)
            continue
        text = fetch_box(session, box)
        if text is None:
            failed.append(box)
            continue
        got = tiles_from_csv(text)
        tiles.update(got)
        done.append(box)
        print(f"box {i + 1}/{len(BOXES)} {box}: {sum(map(len, got.values())):,} stations")
        time.sleep(2)   # be gentle with the shared servers
    write(tiles, done)
    print(f"Fetched {len(done)} of {len(BOXES)} boxes this run; {len(failed)} kept their previous tiles")
    if not done:
        sys.exit("No boxes could be fetched")


if __name__ == "__main__":
    main()
