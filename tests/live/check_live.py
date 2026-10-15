"""Open the published page in a phone-sized browser at a few real places and check it works end to end
against the live map, price and dish data. Run by the "Live check" workflow; not part of the unit tests.

    python tests/live/check_live.py https://madhubuddaraju.github.io/pitstop/
"""

import sys

from playwright.sync_api import sync_playwright

MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter",
           "https://overpass.osm.jp/api/interpreter"]
PROBE = """async (url) => {
  const q = '[out:json][timeout:25];(nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](around:700,40.75800,-73.98550););out center tags;';
  const t0 = performance.now();
  try {
    const r = await fetch(url, {method: "POST", body: "data=" + encodeURIComponent(q), headers: {"Content-Type": "application/x-www-form-urlencoded"}});
    const txt = await r.text();
    let n = null; try { n = JSON.parse(txt).elements.length; } catch {}
    return `${r.status} in ${Math.round(performance.now() - t0)} ms, elements=${n}, body=${txt.slice(0, 120).replace(/\\s+/g, " ")}`;
  } catch (e) { return `failed after ${Math.round(performance.now() - t0)} ms: ${e}`; }
}"""


def probe(page):
    for m in MIRRORS:
        print("probe", m, "->", page.evaluate(PROBE, m))


PLACES = {"Times Square, New York": "40.758,-73.9855", "Downtown Chicago": "41.8818,-87.6278"}


def check(url: str) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 390, "height": 844}, timezone_id="America/New_York")
        errors = []
        page.on("console", lambda m: print("  console:", m.type, m.text) if m.type in ("error", "warning") else None)
        import os
        os.makedirs("screenshots", exist_ok=True)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(url)
        probe(page)
        for name, at in PLACES.items():
            page.goto(f"{url}?at={at}#food")
            try:
                page.wait_for_selector(".item", timeout=60000)
            finally:
                page.screenshot(path=f"screenshots/{name.split(',')[0].replace(' ', '-')}-food.png")
            summary = page.text_content(".summary")
            items = page.locator(".item").count()
            print(f"{name} food: {summary.strip()} ({items} shown)")
            assert items > 0
            # open the first place that has dish suggestions and explain a dish
            for i in range(min(items, 15)):
                page.locator(".item").nth(i).click()
                page.wait_for_selector(".place-head h2")
                if page.locator("[data-dish]").count():
                    place = page.text_content(".place-head h2")
                    page.locator("[data-dish]").first.click()
                    page.wait_for_selector(".steps li")
                    print(f"  {place}: explained {page.text_content('.dish-title')}, "
                          f"{page.locator('.steps li').count()} steps, photo={page.locator('.dish-hero').count() > 0}")
                    page.go_back()
                    break
                page.go_back()
            page.goto(f"{url}?at={at}#gas")
            try:
                page.wait_for_selector(".price-card", timeout=60000)
            finally:
                page.screenshot(path=f"screenshots/{name.split(',')[0].replace(' ', '-')}-gas.png")
            print(f"{name} gas: {page.text_content('.price-card .lbl')} {page.text_content('.price-big')}; "
                  f"{page.text_content('.summary')}")
        browser.close()
        assert not errors, errors


if __name__ == "__main__":
    check(sys.argv[1] if len(sys.argv) > 1 else "https://madhubuddaraju.github.io/pitstop/")
