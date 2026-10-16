"""Read OpenStreetMap objects from Geofabrik's daily extracts.

The public Overpass servers turn away large or repeated queries, so bulk data comes from Geofabrik instead: download
a region file once, cut it down to the tags we need with osmium-tool, and read what is left with pyosmium. Buildings
mapped as outlines are reduced to the average of their corner points.
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

GEOFABRIK = "https://download.geofabrik.de/north-america/{}-latest.osm.pbf"
UA = {"User-Agent": "pitstop/1.0 (github.com/subbarajubuddaraju/pitstop)"}


def download(region: str, folder: Path) -> Path:
    import requests
    path = folder / (region.replace("/", "_") + ".osm.pbf")
    with requests.get(GEOFABRIK.format(region), stream=True, timeout=120, headers=UA) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_content(1 << 22):
                f.write(chunk)
    print(f"  downloaded {region}: {path.stat().st_size / 1e6:,.0f} MB", file=sys.stderr)
    return path


def tags_filter(src: Path, expressions: list[str]) -> Path:
    """Keep only objects matching the expressions (plus the nodes their outlines need)."""
    out = src.with_suffix(".filtered.pbf")
    subprocess.run(["osmium", "tags-filter", "--overwrite", "-o", str(out), str(src), *expressions], check=True)
    return out


def objects(path: Path, key: str):
    """Yield (osm_id, lat, lon, tags) for every node and way with the key."""
    import osmium
    fp = osmium.FileProcessor(str(path)).with_locations().with_filter(osmium.filter.KeyFilter(key))
    for o in fp:
        tags = dict(o.tags)
        if o.is_node():
            if not o.location.valid():
                continue
            yield f"node/{o.id}", o.location.lat, o.location.lon, tags
        elif o.is_way():
            pts = [(n.lat, n.lon) for n in o.nodes if n.location.valid()]
            if len(pts) > 1 and pts[0] == pts[-1]:
                pts = pts[:-1]
            if not pts:
                continue
            yield f"way/{o.id}", sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), tags


def region_objects(regions: list[str], expressions: list[str], key: str):
    """Download each region in turn (deleting it afterwards to save disk) and yield matching objects."""
    folder = Path(tempfile.mkdtemp(prefix="osm-"))
    try:
        for region in regions:
            src = download(region, folder)
            small = tags_filter(src, expressions)
            src.unlink()
            yield from objects(small, key)
            small.unlink()
    finally:
        shutil.rmtree(folder, ignore_errors=True)
