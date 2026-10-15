"""Weekly retail gas prices from the U.S. Energy Information Administration, by area, into docs/gas.json.

EIA publishes every Monday (regular gasoline and diesel, for the US, regions, 9 states and 10 metro areas).
Each spreadsheet column has a series id such as EMM_EPMR_PTE_Y35NY_DPG: product EPMR (regular) or EPD2D (diesel),
area Y35NY (New York City). We keep the last 12 weeks for each area.

    python scripts/fetch_gas.py
"""

import io
import json
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "gas.json"
SOURCES = {
    "regular": "https://www.eia.gov/petroleum/gasdiesel/xls/pswrgvwall.xls",
    "diesel": "https://www.eia.gov/petroleum/gasdiesel/xls/psw18vwall.xls",
}
SERIES = {
    "regular": re.compile(r"^EMM_EPMR_PTE_([A-Z0-9]+)_DPG$"),
    "diesel": re.compile(r"^EMD_EPD2DXL0_PTE_([A-Z0-9]+)_DPG$|^EMD_EPD2D_PTE_([A-Z0-9]+)_DPG$"),
}
WEEKS = 12
NAME_CUT = re.compile(r"\s+(\(PADD|Regular|No 2|Ultra Low|Diesel|Retail|All Grades|Midgrade|Premium|Gasoline)\b.*$", re.I)


def area_name(description: str) -> str:
    """'New York City Regular All Formulations Retail Gasoline Prices (Dollars per Gallon)' -> 'New York City'."""
    name = NAME_CUT.sub("", description.strip()).strip(" ,")
    return "United States" if name in ("U.S.", "US") else name


def parse_sheet(raw: pd.DataFrame, product: str) -> dict:
    """raw is a sheet read with header=None: row 1 has series ids, row 2 descriptions, rows 3+ date + values."""
    ids = raw.iloc[1].tolist()
    names = raw.iloc[2].tolist()
    body = raw.iloc[3:]
    dates = pd.to_datetime(body.iloc[:, 0], errors="coerce")
    out = {}
    for col, sid in enumerate(ids):
        m = SERIES[product].match(str(sid).strip())
        if not m:
            continue
        code = next(g for g in m.groups() if g)
        values = pd.to_numeric(body.iloc[:, col], errors="coerce")
        s = pd.DataFrame({"date": dates, "price": values}).dropna().sort_values("date").tail(WEEKS)
        if s.empty:
            continue
        out[code] = {
            "name": area_name(str(names[col])),
            "series": [[d.strftime("%Y-%m-%d"), round(float(p), 3)] for d, p in zip(s.date, s.price, strict=True)],
        }
    return out


def parse_workbook(content: bytes, product: str) -> dict:
    sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, header=None)
    found = {}
    for name, raw in sheets.items():
        if not str(name).lower().startswith("data") or len(raw) < 4:
            continue
        for code, s in parse_sheet(raw, product).items():
            found.setdefault(code, s)   # earlier sheets hold the "all formulations" series
    return found


def merge(products: dict) -> dict:
    areas: dict = {}
    for product, found in products.items():
        for code, s in found.items():
            a = areas.setdefault(code, {"name": s["name"]})
            a[product] = s["series"]
    latest = max(s[-1][0] for a in areas.values() for k, s in a.items() if k != "name")
    return {"updated": latest, "source": "U.S. Energy Information Administration, weekly retail prices", "areas": areas}


def main():
    import requests
    products = {}
    for product, url in SOURCES.items():
        r = requests.get(url, timeout=60, headers={"User-Agent": "pitstop-gas/1.0"})
        r.raise_for_status()
        products[product] = parse_workbook(r.content, product)
        print(f"{product}: {len(products[product])} areas")
    data = merge(products)
    if "NUS" not in data["areas"] or "Y35NY" not in data["areas"]:
        sys.exit(f"Unexpected EIA layout, areas found: {sorted(data['areas'])}")
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    us = data["areas"]["NUS"]
    print(f"Week of {data['updated']}: US regular ${us['regular'][-1][1]:.2f}, diesel ${us.get('diesel', [[0, 0]])[-1][1]:.2f}"
          f" -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
