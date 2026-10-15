"""Build docs/dishes.json from the hand-written dish and cuisine files, adding a description and photo from Wikipedia.

    python scripts/build_dishes.py            # fetch Wikipedia summaries (keeps the previous ones if a fetch fails)
    python scripts/build_dishes.py --offline  # validate and rebuild without network
"""

import argparse
import json
import sys
import time
from pathlib import Path
from urllib.parse import quote

import yaml

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "dishes.json"
SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/{}"
HEADERS = {"User-Agent": "pitstop-dishes/1.0 (https://github.com/madhubuddaraju/pitstop)"}
DIETS = {"meat", "fish", "veg", "vegan"}


def load():
    dishes = yaml.safe_load((ROOT / "data" / "dishes.yaml").read_text())
    cuisines = yaml.safe_load((ROOT / "data" / "cuisines.yaml").read_text())
    return dishes, cuisines


def validate(dishes: dict, cuisines: dict) -> list[str]:
    problems = []
    for key, d in dishes.items():
        for field in ("name", "wiki", "about", "diet", "spicy", "ingredients", "steps"):
            if field not in d:
                problems.append(f"dish {key}: missing {field}")
        if d.get("diet") not in DIETS:
            problems.append(f"dish {key}: diet must be one of {sorted(DIETS)}")
        if d.get("spicy") not in (0, 1, 2):
            problems.append(f"dish {key}: spicy must be 0, 1 or 2")
        if len(d.get("steps", [])) < 2:
            problems.append(f"dish {key}: needs at least two steps")
    used = set()
    seen_osm: dict[str, str] = {}
    for key, c in cuisines.items():
        for dish in c.get("dishes", []):
            used.add(dish)
            if dish not in dishes:
                problems.append(f"cuisine {key}: unknown dish {dish}")
        for v in c.get("osm", []):
            if v in seen_osm:
                problems.append(f"osm value {v} is in both {seen_osm[v]} and {key}")
            seen_osm[v] = key
    for key in dishes:
        if key not in used:
            problems.append(f"dish {key} is not listed under any cuisine")
    return problems


def fetch_summary(session, title: str) -> dict | None:
    r = session.get(SUMMARY.format(quote(title.replace(" ", "_"), safe="")), timeout=20)
    if r.status_code != 200:
        return None
    j = r.json()
    if j.get("type") == "disambiguation":
        return None
    thumb = (j.get("thumbnail") or {}).get("source")
    return {
        "extract": j.get("extract", ""),
        "image": thumb,
        "url": (j.get("content_urls") or {}).get("mobile", {}).get("page") or j.get("content_urls", {}).get("desktop", {}).get("page"),
    }


def build(offline: bool = False) -> dict:
    dishes, cuisines = load()
    problems = validate(dishes, cuisines)
    if problems:
        sys.exit("Problems in the dish files:\n  " + "\n  ".join(problems))

    previous = {}
    if OUT.exists():
        previous = {k: v.get("wiki_summary") for k, v in json.loads(OUT.read_text())["dishes"].items()}

    session = None
    if not offline:
        import requests
        session = requests.Session()
        session.headers.update(HEADERS)

    fetched = failed = 0
    for key, d in dishes.items():
        summary = previous.get(key)
        if session is not None:
            try:
                got = fetch_summary(session, d["wiki"])
                if got:
                    summary, fetched = got, fetched + 1
                else:
                    failed += 1
            except Exception as exc:  # keep the previous summary on network errors
                print(f"  {key}: {exc}", file=sys.stderr)
                failed += 1
            time.sleep(0.1)
        d["wiki_summary"] = summary

    data = {
        "cuisines": cuisines,
        "dishes": dishes,
        "built": time.strftime("%Y-%m-%d"),
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    with_photo = sum(1 for d in dishes.values() if (d.get("wiki_summary") or {}).get("image"))
    print(f"{len(dishes)} dishes, {len(cuisines)} cuisines; Wikipedia fetched {fetched}, failed {failed}; "
          f"{with_photo} with a photo -> {OUT.relative_to(ROOT)}")
    return data


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--offline", action="store_true")
    build(p.parse_args().offline)
