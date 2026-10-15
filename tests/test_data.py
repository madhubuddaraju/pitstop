import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_dishes  # noqa: E402
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
         "New York City Regular All Formulations Retail Gasoline Prices (Dollars per Gallon)",
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
