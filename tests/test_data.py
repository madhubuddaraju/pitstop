import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_dishes  # noqa: E402
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


def test_fuel_tiles_from_overpass_csv():
    text = ("@type\t@id\t@lat\t@lon\tname\tbrand\topening_hours\tfuel:diesel\taddr:housenumber\taddr:street\taddr:city\n"
            "node\t1\t40.762\t-73.993\tShell\tShell\t24/7\tyes\t600\t11th Avenue\tNew York\n"
            "way\t2\t40.76201\t-73.99301\tShell\tShell\t\t\t\t\t\n"          # same station as an outline
            "node\t3\t34.05\t-118.24\t\tArco\t\tno\t\t\t\n"
            "node\t4\t\t\tBroken\t\t\t\t\t\t\n")
    tiles = build_fuel_tiles.tiles_from_csv(text)
    assert sorted(tiles) == ["34_-119", "40_-74"]
    assert tiles["40_-74"] == [[40.762, -73.993, "Shell", "24/7", 1, "600 11th Avenue, New York", "node/1"]]
    assert tiles["34_-119"][0][2] == "Arco"


def test_fuel_queries_cover_the_us_in_boxes():
    q = build_fuel_tiles.query((40, -75, 45, -70))
    assert '"fuel:diesel"' in q and "::lat" in q and 'nwr["amenity"="fuel"](40,-75,45,-70)' in q and "out center" in q
    assert build_fuel_tiles.HEADER.startswith("@type\t@id\t@lat\t@lon\tname")
    covered = lambda lat, lon: any(s <= lat < n and w <= lon < e for s, w, n, e in build_fuel_tiles.BOXES)
    for lat, lon in [(40.76, -73.99), (25.76, -80.19), (47.61, -122.33), (61.2, -149.9), (21.3, -157.86), (18.4, -66.1)]:
        assert covered(lat, lon), (lat, lon)


def test_fuel_tiles_update_only_fetched_boxes(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr(build_fuel_tiles, "OUT", tmp_path)
    (tmp_path / "40_-74.json").write_text('[[40.5, -73.5, "Old", "", 0, "", "node/9"]]')     # inside the fetched box
    (tmp_path / "34_-119.json").write_text('[[34.0, -118.5, "Kept", "", 0, "", "node/8"]]')  # box failed: keep
    new = {"40_-74": [[40.6, -73.6, "New", "", 0, "", "node/1"]]}
    build_fuel_tiles.write(new, [(39, -75, 44, -70)])
    assert json.loads((tmp_path / "40_-74.json").read_text())[0][2] == "New"
    assert json.loads((tmp_path / "34_-119.json").read_text())[0][2] == "Kept"
    index = json.loads((tmp_path / "index.json").read_text())
    assert index["tiles"] == ["34_-119", "40_-74"] and index["stations"] == 2
    assert list(index["boxes"]) == ["39,-75,44,-70"]
