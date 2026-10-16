"""Open the published page in a phone-sized browser at a few real places and check it works end to end
against the live map, price and dish data. Run by the "Live check" workflow; not part of the unit tests.

    python tests/live/check_live.py https://madhubuddaraju.github.io/pitstop/
"""

import sys
import time

from playwright.sync_api import sync_playwright

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
        for name, at in PLACES.items():
            t0 = time.time()
            page.goto(f"{url}?at={at}#food")
            try:
                page.wait_for_selector(".item", timeout=60000)
            finally:
                page.screenshot(path=f"screenshots/{name.split(',')[0].replace(' ', '-')}-food.png")
            summary = page.locator(".summary").last.text_content()
            items = page.locator(".item").count()
            print(f"{name} food: {summary.strip()} ({items} shown in {time.time() - t0:.1f} s, map server {page.evaluate('window.__server && window.__server()')})")
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
            page.wait_for_timeout(5000)   # be gentle with the public map servers
            t0 = time.time()
            page.goto(f"{url}?at={at}#gas")
            try:
                page.wait_for_selector(".price-card", timeout=60000)
            finally:
                page.screenshot(path=f"screenshots/{name.split(',')[0].replace(' ', '-')}-gas.png")
            page.wait_for_timeout(1200)   # the price counts up when it first appears
            print(f"{name} gas: {page.text_content('.price-card .lbl')} {page.text_content('.price-big')}; "
                  f"{page.text_content('.summary')} in {time.time() - t0:.1f} s")
        browser.close()
        assert not errors, errors


if __name__ == "__main__":
    check(sys.argv[1] if len(sys.argv) > 1 else "https://madhubuddaraju.github.io/pitstop/")
