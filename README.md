# Pitstop: gas and food near you

![CI](https://github.com/subbarajubuddaraju/pitstop/actions/workflows/ci.yml/badge.svg)
![Data](https://github.com/subbarajubuddaraju/pitstop/actions/workflows/refresh-data.yml/badge.svg)

**Open it on your phone: [subbarajubuddaraju.github.io/pitstop](https://subbarajubuddaraju.github.io/pitstop/)**

> **Early version, for the United States.** Pitstop works today for gas and food anywhere in the US, and it will keep improving. The list
> below is what's planned next.

## The problem

When you're new to a city, two everyday questions take too many steps: *where's the nearest gas station and what
should gas cost here*, and *what's still open near me right now, and what do I even order there?* Map apps answer
the first half of each, but you still have to open every listing to see closing times, and a menu full of dishes
you've never heard of doesn't help much.

## What it does

You open the page and it asks one thing: **Gas or Food?**

**Food**
- Restaurants, cafés and takeout near you, with **open now / closes at** worked out from each place's opening hours
  ("Open · closes 10:30 pm", "Closes in 25 min", "Closed · opens 7 am tomorrow").
- Filters for open now, late night (open past midnight), halal, vegetarian, and the cuisines actually around you.
- Each restaurant page has directions, call, website and menu links, the week's hours, diet and service badges,
  and in New York City its **health inspection grade** (A/B/C).
- **What to order:** the popular dishes for that cuisine, each with an **Explain** button: what's in it, how it's
  made step by step, spice level, whether it's vegetarian, a photo, and ordering tips ("Thai medium can be hot").

**Gas**
- Stations near you by distance, with hours and fuel types.
- **This week's average price for your area** (metro, state or region, whichever is most local), the change from last
  week and a 12-week trend.
- Each station's own price with a Google key (below); without one, you can note the price on a sign and Pitstop
  remembers it on your phone and marks the cheapest station you've seen.

**Optional: live prices with your own Google key.** Station-level prices aren't open data anywhere in the US, but
Google's Places API has them. Paste your own key under "Google data" on the start screen (it stays in that phone's
browser) and the gas list shows each station's regular, premium and diesel price, sorted cheapest first; restaurant
lists and pages add live Google hours, ratings and price level, and places Google knows that the map doesn't yet. For one person, the monthly free allowance covers normal use, and Pitstop never sends more than 30 Google requests a day.

**Must-try dishes from reviews** (with a Google key). On a restaurant page Pitstop reads the reviews Google shares
and lists the dishes reviewers recommend first, with a short quote: dishes from the guide that reviews name, plus items
named after phrases like "must try the…", "get the…", "recommend the…". Each has an Explain button: the dish guide
for known dishes, Wikipedia for others, or a note that it's the restaurant's own creation.

**Must-try first.** A restaurant page opens with the must-try dishes from its reviews, then its menu: a link to the real one (the restaurant's own menu when it has
listed one, otherwise Google Maps or a web search), then what places
of that cuisine usually serve, each with an Explain button.

**Offers.** Restaurants don't publish promotions as open data, so each restaurant page links to its Uber Eats and
DoorDash listings, where current promotions show, and lets you save a deal you saw (kept on your phone). Happy hours
are shown where OpenStreetMap lists them.

Your location is used in the browser only; nothing is stored on a server.

## Design

The logo is the name followed by three points, red, yellow and white: the soft, medium and hard tyre compounds, and
also a signal: stop, get ready, go. The same three points mark status in the lists: red is closed, yellow is closing or
opening within 45 minutes, and open is shown in green with the logo's ring.

The app itself is meant to feel like something on your phone rather than a web page: the system typeface, grouped
lists with inset dividers and a segmented Gas/Food switch, all on frosted glass over a dark wallpaper. The start screen shows a station-style price sign with this week's regular and diesel averages, the third
decimal set small as on a real pylon. The one piece of theatre is the intro, where a car comes in, stops on its mark and
the title flies up into the logo. The frame where the car parked becomes the start screen's wallpaper, seen through
frosted-glass panels (CSS `backdrop-filter`, no library); everything after that stays quiet. Motion is off for people who set "reduce motion".

## How it works

```mermaid
flowchart LR
    GPS[phone location] --> APP[Pitstop page]
    OSM[(OpenStreetMap<br/>Overpass API)] -->|places, hours, cuisine| APP
    NOM[(Nominatim)] -->|area name, state| APP
    NYC[(NYC Open Data<br/>restaurant inspections)] -->|grade| APP
    subgraph weekly GitHub Action
      EIA[EIA weekly retail prices] --> G[fetch_gas.py] --> GJ[gas.json]
      Y[dishes.yaml + cuisines.yaml] --> B[build_dishes.py]
      WP[Wikipedia summaries] --> B
      B --> DJ[dishes.json]
      OV[Geofabrik OSM extracts] --> F[build_fuel_tiles.py<br/>build_food_tiles.py] --> FT[station and restaurant tiles]
    end
    GJ & DJ & FT --> APP
```

- **Places** come from prebuilt tiles where they exist (below) and otherwise live from OpenStreetMap: three public
  Overpass servers are asked at once and the first answer is used. Either way the search starts within ~700 m and
  widens until there are enough places to choose from (gas starts at 3 km).
- **Gas stations** in the US are rebuilt every week from Geofabrik's daily OpenStreetMap extracts (the six US
  regional files, cut down to fuel stations with osmium) and split into 1-degree tiles, so the page loads the one or
  two tiles around you from GitHub's CDN instead of querying a map server from every phone.
- **Restaurants** in 18 large metro areas are rebuilt nightly the same way into 2.5 km tiles (each state file is
  downloaded once and shared by the metros in it), so the food list appears in about a second. Elsewhere the page queries
  OpenStreetMap live, and the other list (gas or food) is loaded in the background while you look at the first.
- **Opening hours** are OSM `opening_hours` strings (`Mo-Th 11:00-22:00; Fr-Sa 11:00-02:00; PH off`), evaluated with
  the opening_hours.js library against your local time and public holidays. Places with missing or unparseable hours are
  shown separately as "hours not listed", not as closed.
- **Dishes** are a hand-written guide of 171 dishes across 43 cuisines (`data/`), each with ingredients, preparation
  steps, diet, spice level and tips. 160 OSM cuisine values map onto the 43 cuisines. A build step validates the files
  and adds a description and photo from Wikipedia.
- **Gas prices** come from the U.S. Energy Information Administration's weekly survey (regular and diesel, for the US,
  7 regions, 9 states and 10 metro areas). `fetch_gas.py` reads the spreadsheets by series id
  (`EMM_EPMR_PTE_Y35NY_DPG` = regular, New York City) and keeps 12 weeks. The page picks the most local series:
  metro if you're within 60 km of one, then state, then region, then the US.
- **Google data** (optional) uses Places API (New) Nearby Search for `gas_station` with `fuelOptions`, called from the
  browser with the user's key. Restaurant pages run a Text Search near the place and accept the result only if it is
  within 150 m with a matching name.
- **Inspection grades** are matched from NYC Open Data by name and distance (within 120 m), using the latest graded
  inspection.

## What's next

Pitstop is an early version. Recently added:

- **Faster food lists in 18 metro areas**: New York, Los Angeles, San Francisco, San Diego, Chicago, Houston, Dallas,
  Austin, Washington, Boston, Philadelphia, Miami, Orlando, Atlanta, Seattle, Phoenix, Las Vegas and Denver.
- **Search by dish**: type "biryani" or "ramen" and the list shows the places that usually serve it.
- **Works offline**: the app is kept on the phone, and your last list is shown when there's no connection.
- **EV charging stations** next to gas, **saved and recently viewed places**, and tips for paying at the pump and
  tipping at restaurants.
- **A lighter intro**: it plays once, and slower phones or data-saver mode skip it and the live blur.

- **Gas on my way**: enter where you're heading and Pitstop finds the stations within a mile of the route (OSRM routing),
  in the order you'll reach them, and names the stretch where the area average is lowest. With a Google key it adds
  each station's price along the route.
- **Explain any dish**: type a dish on the start screen or a restaurant page; dishes in the guide open their page,
  anything else is looked up on Wikipedia.
- **What a dish usually contains**: pork, beef, alcohol, nuts and shellfish are marked from each dish's usual recipe,
  and "I don't eat" settings turn the ones you avoid red.
- **Tip and tax calculator** on restaurant pages, **"worth the drive?"** savings on cheaper stations, a pickup-direct
  note, and a link to add missing hours on OpenStreetMap.

Still planned:

- Health inspection grades beyond New York City (Chicago, San Francisco, Los Angeles County and others publish them).

- Live hours from Google for every place in the list, not only the nearest ones.
- The dish guide in more languages, starting with Hindi and Telugu, reviewed by native speakers.
- Restaurant tiles for more cities, and live charger availability.

## Running it

```bash
npm install && npm test                          # app logic tests (hours, distances, cuisines, gas areas)
pip install -r requirements.txt
python -m pytest -q tests                        # data tests (EIA parsing, dish files)
python scripts/fetch_gas.py                      # refresh docs/gas.json
python scripts/build_dishes.py                   # rebuild docs/dishes.json with Wikipedia text and photos
python scripts/build_fuel_tiles.py               # every US gas station into docs/fuel/ tiles
python scripts/build_food_tiles.py               # restaurants in covered metros into docs/food/ tiles
python -m http.server -d docs 8000               # open http://localhost:8000
```

Add `?at=40.758,-73.9855&mode=food` to the URL to try any location.

## Project structure

```
docs/index.html     the app (one page, no build step)
docs/core.js        logic: distances, OSM queries, opening hours, cuisines, gas areas, inspection matching
docs/dishes.json    built dish guide
docs/gas.json       weekly prices by area
docs/fuel/          US gas stations in 1-degree tiles
docs/food/          restaurants in covered metros in 2.5 km tiles
data/               dishes.yaml and cuisines.yaml, written by hand
scripts/            fetch_gas.py, build_dishes.py, build_fuel_tiles.py
tests/              Node tests for core.js, pytest for the data scripts
```

## Data and credits

Places © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), via Geofabrik extracts, the Overpass API and
Nominatim. Gas prices: [U.S. Energy Information Administration](https://www.eia.gov/petroleum/gasdiesel/).
Inspection grades: [NYC Open Data](https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j).
Dish descriptions and photos: Wikipedia (CC BY-SA). Opening hours are only as current as the map, so call ahead late
at night.

## License

MIT
