import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_dishes  # noqa: E402
import build_food_tiles  # noqa: E402
import build_fuel_tiles  # noqa: E402
import fetch_gas  # noqa: E402


def eia_sheet(ids, names, rows):
    """Shape of an EIA weekly spreadsheet: a title row, series ids, descriptions, then dated values."""
    return pd.DataFrame([["Back to Contents"] + [None] * len(ids), ["Sourcekey"] + ids, ["Date"] + names] + rows)


def test_dish_files_are_consistent():
    dishes, cuisines = build_dishes.load()
    assert build_dishes.validate(dishes, cuisines) == []
    assert len(dishes) > 100


def test_validation_catches_unknown_dish():
    dishes, cuisines = build_dishes.load()
    cuisines["thai"]["dishes"].append("not-a-dish")
    assert any("unknown dish not-a-dish" in p for p in build_dishes.validate(dishes, cuisines))


def test_eia_regular_sheet_is_parsed_by_area():
    raw = eia_sheet(
        ["EMM_EPMR_PTE_NUS_DPG", "EMM_EPMR_PTE_Y35NY_DPG", "EMM_EPMRU_PTE_NUS_DPG"],
        ["U.S. Regular All Formulations Retail Gasoline Prices (Dollars per Gallon)",
         "Weekly New York City Regular All Formulations Retail Gasoline Prices  (Dollars per Gallon)",
         "U.S. Regular Conventional Retail Gasoline Prices (Dollars per Gallon)"],
        [[pd.Timestamp("2026-09-28"), 3.101, 3.402, 3.0],
         [pd.Timestamp("2026-10-05"), 3.085, None, 3.0],
         [pd.Timestamp("2026-10-12"), 3.06, 3.35, 3.0]],
    )
    out = fetch_gas.parse_sheet(raw, "regular")
    assert set(out) == {"NUS", "Y35NY"}          # the conventional-only series is ignored
    assert out["NUS"]["name"] == "United States"
    assert out["Y35NY"]["name"] == "New York City"
    assert out["NUS"]["series"][-1] == ["2026-10-12", 3.06]
    assert len(out["Y35NY"]["series"]) == 2       # missing week dropped


def test_eia_diesel_and_merge():
    raw = eia_sheet(["EMD_EPD2D_PTE_NUS_DPG", "EMD_EPD2D_PTE_R1Y_DPG"],
                    ["U.S. No 2 Diesel Retail Prices (Dollars per Gallon)",
                     "Central Atlantic (PADD 1B) No 2 Diesel Retail Prices (Dollars per Gallon)"],
                    [[pd.Timestamp("2026-10-12"), 3.7, 3.9]])
    diesel = fetch_gas.parse_sheet(raw, "diesel")
    assert diesel["R1Y"]["name"] == "Central Atlantic"
    data = fetch_gas.merge({"regular": {"NUS": {"name": "United States", "series": [["2026-10-12", 3.06]]}}, "diesel": diesel})
    assert data["updated"] == "2026-10-12"
    assert data["areas"]["NUS"]["diesel"] == [["2026-10-12", 3.7]]
    assert data["areas"]["R1Y"]["name"] == "Central Atlantic"


def test_area_names():
    assert fetch_gas.area_name("Weekly U.S. Regular All Formulations Retail Gasoline Prices  (Dollars per Gallon)") == "United States"
    assert fetch_gas.area_name("Weekly Boston, MA Regular All Formulations Retail Gasoline Prices  (Dollars per Gallon)") == "Boston, MA"
    assert fetch_gas.area_name("Weekly West Coast (PADD 5) Except California No 2 Diesel Retail Prices  (Dollars per Gallon)") == "West Coast except California"


def make_pbf(path):
    import osmium
    w = osmium.SimpleWriter(str(path))
    node = osmium.osm.mutable.Node
    w.add_node(node(id=1, location=(-73.9862, 40.7585), version=1,
                    tags={"amenity": "restaurant", "name": "Sushi Place", "cuisine": "sushi", "diet:vegan": "yes", "source": "x"}))
    corners = [(-73.9850, 40.7570), (-73.9848, 40.7570), (-73.9848, 40.7572), (-73.9850, 40.7572)]
    for i, loc in enumerate(corners, start=10):
        w.add_node(node(id=i, location=loc, version=1))
    w.add_way(osmium.osm.mutable.Way(id=5, nodes=[10, 11, 12, 13, 10], version=1,
                                     tags={"amenity": "cafe", "name": "Corner Cafe", "building": "yes"}))
    w.add_node(node(id=2, location=(-73.98, 40.76), version=1, tags={"amenity": "cafe"}))                    # no name
    w.add_node(node(id=3, location=(-75.5, 40.76), version=1, tags={"amenity": "bar", "name": "Outside"}))   # outside NYC
    w.add_node(node(id=4, location=(-73.993, 40.762), version=1,
                    tags={"amenity": "fuel", "brand": "Shell", "fuel:diesel": "yes", "opening_hours": "24/7",
                          "addr:housenumber": "600", "addr:street": "11th Avenue", "addr:city": "New York"}))
    w.add_node(node(id=6, location=(-118.24, 34.05), version=1, tags={"amenity": "fuel"}))
    w.close()


def test_osm_objects_reduce_outlines_to_a_point(tmp_path):
    import osm_extract
    make_pbf(tmp_path / "t.osm.pbf")
    objs = {o[0]: o for o in osm_extract.objects(tmp_path / "t.osm.pbf", "amenity")}
    assert set(objs) == {"node/1", "way/5", "node/2", "node/3", "node/4", "node/6"}
    _, lat, lon, tags = objs["way/5"]
    assert abs(lat - 40.7571) < 1e-6 and abs(lon + 73.9849) < 1e-6 and tags["name"] == "Corner Cafe"


def test_fuel_tiles_from_osm(tmp_path):
    import osm_extract
    make_pbf(tmp_path / "t.osm.pbf")
    tiles = build_fuel_tiles.rows_by_tile(osm_extract.objects(tmp_path / "t.osm.pbf", "amenity"))
    assert sorted(tiles) == ["34_-119", "40_-74"]
    assert tiles["40_-74"] == [[40.762, -73.993, "Shell", "24/7", 1, "600 11th Avenue, New York", "node/4"]]
    assert tiles["34_-119"][0][2] == "Gas station"


def test_fuel_tiles_write(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr(build_fuel_tiles, "OUT", tmp_path / "fuel")
    build_fuel_tiles.write({"40_-74": [[40.6, -73.6, "New", "", 0, "", "node/1"]]})
    index = json.loads((tmp_path / "fuel" / "index.json").read_text())
    assert index["tiles"] == ["40_-74"] and index["stations"] == 1


def test_food_tiles_from_osm(tmp_path, monkeypatch):
    import json
    import osm_extract
    make_pbf(tmp_path / "t.osm.pbf")
    bounds = build_food_tiles.METROS["nyc"]["bounds"]
    rows = build_food_tiles.rows_from_objects(osm_extract.objects(tmp_path / "t.osm.pbf", "amenity"), bounds)
    assert [r[2] for r in rows] == ["Sushi Place", "Corner Cafe"]        # unnamed, outside and fuel left out
    assert rows[0][3] == {"amenity": "restaurant", "cuisine": "sushi", "diet:vegan": "yes"}
    bxs = build_food_tiles.boxes(bounds)
    assert len(bxs) == 42 and bxs[0] == (40.45, -74.3, 40.55, -74.2)
    assert build_food_tiles.box_id((40.75, -74.0, 40.85, -73.9)) == "40.75,-74,40.85,-73.9"   # same text as core.js
    assert build_food_tiles.tile_key(40.7585, -73.9862) == "1630_-2960"
    monkeypatch.setattr(build_food_tiles, "OUT", tmp_path / "food")
    m = build_food_tiles.write_metro("nyc", rows, bounds)
    assert m["tiles"] == ["1630_-2960"] and m["places"] == 2 and len(m["boxes"]) == 42
    assert "40.75,-74,40.85,-73.9" in m["boxes"]
    assert json.loads((tmp_path / "food" / "nyc" / "1630_-2960.json").read_text())[0][2] in ("Sushi Place", "Corner Cafe")


def test_regions_are_downloaded_once_and_shared(monkeypatch):
    calls = []
    def fake(regions, expr, key):
        calls.append(regions[0])
        if regions[0] == "us/california":
            yield ("node/1", 34.05, -118.25, {"amenity": "restaurant", "name": "LA"})      # Los Angeles
            yield ("node/2", 37.77, -122.42, {"amenity": "restaurant", "name": "SF"})      # San Francisco
    monkeypatch.setattr(build_food_tiles.osm_extract, "region_objects", fake)
    found = build_food_tiles.objects_by_metro(["la", "sf"], ["nwr/amenity=restaurant"])
    assert calls == ["us/california"]
    assert [o[3]["name"] for o in found["la"]] == ["LA"] and [o[3]["name"] for o in found["sf"]] == ["SF"]
