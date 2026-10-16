// node --test tests/   (needs `npm install` for the opening_hours library)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import OH from "opening_hours";
import {
  distanceMeters, formatDistance, overpassQuery, parsePlaces, cuisineIndex, cuisinesFor, cuisineLabel, dishesFor,
  dietBadges, hoursStatus, lateNight, weekHours, formatTime, gasAreas, gasForLocation, matchInspection, inNYC,
} from "../docs/core.js";

const dishes = JSON.parse(readFileSync(new URL("../docs/dishes.json", import.meta.url)));
const index = cuisineIndex(dishes.cuisines);
const NY = { lat: 40.758, lon: -73.9855, address: { country_code: "us", state: "New York" } };
// Thursday 15 Oct 2026, 9:30 pm in New York (tests run with TZ=America/New_York)
const thu930pm = new Date(2026, 9, 15, 21, 30);

test("distance between Times Square and Grand Central is about 900 m", () => {
  const d = distanceMeters(40.758, -73.9855, 40.7527, -73.9772);
  assert.ok(d > 850 && d < 950, d);
});

test("distances are shown in miles with a walking time", () => {
  assert.equal(formatDistance(400), "0.2 mi · 7 min walk");
  assert.equal(formatDistance(20, {}), "70 ft · 1 min walk");
  assert.equal(formatDistance(5000, { mode: "drive" }), "3.1 mi · 16 min drive");
  assert.equal(formatDistance(1500, { miles: false }), "1.5 km · 24 min walk");
});

test("overpass query asks for named food places or fuel stations nearby", () => {
  assert.match(overpassQuery("food", 40.7, -73.9, 700), /amenity"~"\^\(restaurant\|fast_food.*\["name"\]\(around:700,40\.70000,-73\.90000\)/);
  assert.match(overpassQuery("gas", 40.7, -73.9, 3000), /"amenity"="fuel"\]\(around:3000/);
});

test("places are parsed, de-duplicated and sorted by distance", () => {
  const json = { elements: [
    { type: "way", id: 2, center: { lat: 40.7600, lon: -73.9855 }, tags: { amenity: "restaurant", name: "Far" } },
    { type: "node", id: 1, lat: 40.7585, lon: -73.9855, tags: { amenity: "restaurant", name: "Near", "addr:housenumber": "1", "addr:street": "Broadway" } },
    { type: "way", id: 3, center: { lat: 40.75851, lon: -73.98551 }, tags: { amenity: "restaurant", name: "Near" } },
    { type: "node", id: 4, lat: 40.759, lon: -73.98, tags: { amenity: "restaurant" } },
  ] };
  const places = parsePlaces(json, "food", NY);
  assert.deepEqual(places.map(p => p.name), ["Near", "Far"]);
  assert.equal(places[0].address, "1 Broadway");
  const gas = parsePlaces({ elements: [{ type: "node", id: 9, lat: 40.76, lon: -73.98, tags: { amenity: "fuel" } }] }, "gas", NY);
  assert.equal(gas[0].name, "Gas station");
});

test("OSM cuisine values map to dish lists", () => {
  assert.deepEqual(cuisinesFor({ cuisine: "thai;vietnamese" }, index), ["thai", "vietnamese"]);
  assert.deepEqual(cuisinesFor({ cuisine: "Coffee Shop" }, index), ["coffee"]);
  assert.deepEqual(cuisinesFor({ amenity: "cafe" }, index), ["coffee"]);
  assert.deepEqual(cuisinesFor({ cuisine: "kebab", "diet:halal": "only" }, index), ["middle_eastern", "halal"]);
  assert.equal(cuisineLabel({ cuisine: "basque_fusion" }, [], dishes.cuisines), "Basque fusion");
  assert.equal(cuisineLabel({ amenity: "fast_food" }, [], dishes.cuisines), "Fast food");
  const ids = dishesFor(["thai"], dishes.cuisines);
  assert.equal(ids[0], "pad-thai");
  for (const id of ids) assert.ok(dishes.dishes[id], id);
});

test("every dish has ingredients and at least two steps", () => {
  for (const [id, d] of Object.entries(dishes.dishes)) {
    assert.ok(d.ingredients.length >= 2, id);
    assert.ok(d.steps.length >= 2, id);
  }
});

test("diet badges", () => {
  assert.deepEqual(dietBadges({ "diet:halal": "yes", "diet:vegetarian": "yes" }), ["Halal options", "Vegetarian options"]);
  assert.deepEqual(dietBadges({ "diet:vegan": "only" }), ["Vegan"]);
});

test("times read naturally", () => {
  assert.equal(formatTime(new Date(2026, 9, 15, 22, 0)), "10 pm");
  assert.equal(formatTime(new Date(2026, 9, 15, 22, 30)), "10:30 pm");
  assert.equal(formatTime(new Date(2026, 9, 16, 0, 0)), "midnight");
  assert.equal(formatTime(new Date(2026, 9, 15, 12, 0)), "noon");
});

test("open place shows its closing time", () => {
  const s = hoursStatus(OH, "Mo-Su 11:00-23:00", thu930pm, NY);
  assert.equal(s.state, "open");
  assert.equal(s.label, "Open · closes 11 pm");
});

test("closing within 45 minutes is flagged", () => {
  const s = hoursStatus(OH, "Mo-Su 11:00-22:00", thu930pm, NY);
  assert.equal(s.label, "Closes in 30 min");
  assert.ok(s.soon);
});

test("closed place shows when it opens, including the day", () => {
  assert.equal(hoursStatus(OH, "Mo-Su 07:00-15:00", thu930pm, NY).label, "Closed · opens 7 am tomorrow");
  assert.equal(hoursStatus(OH, "Mo-Th 07:00-15:00", thu930pm, NY).label, "Closed · opens 7 am Mon");
});

test("past-midnight hours count as late night", () => {
  const s = hoursStatus(OH, "Mo-Su 17:00-02:00", thu930pm, NY);
  assert.equal(s.label, "Open · closes 2 am");
  assert.ok(lateNight(s, thu930pm));
  const all = hoursStatus(OH, "24/7", thu930pm, NY);
  assert.equal(all.label, "Open 24 hours");
  assert.ok(lateNight(all, thu930pm));
  assert.ok(!lateNight(hoursStatus(OH, "Mo-Su 11:00-23:00", thu930pm, NY), thu930pm));
});

test("missing or broken hours are reported as unknown, not closed", () => {
  assert.equal(hoursStatus(OH, undefined, thu930pm, NY).state, "unknown");
  assert.equal(hoursStatus(OH, "call us!!", thu930pm, NY).state, "unknown");
});

test("week of hours starts today and shows the real closing time after midnight", () => {
  const w = weekHours(OH, "Mo-Th 11:00-22:00; Fr-Sa 11:00-02:00", thu930pm, NY);
  assert.deepEqual(w.slice(0, 4), [
    { day: "Today", text: "11 am – 10 pm" },
    { day: "Friday", text: "11 am – 2 am" },
    { day: "Saturday", text: "11 am – 2 am" },
    { day: "Sunday", text: "Closed" },
  ]);
  assert.equal(weekHours(OH, "24/7", thu930pm, NY)[0].text, "Open 24 hours");
});

test("gas price area: city first, then state, region and US", () => {
  assert.deepEqual(gasAreas("NY", 40.758, -73.9855), ["Y35NY", "SNY", "R1Y", "R10", "NUS"]);
  assert.deepEqual(gasAreas("NJ", 40.06, -74.4), ["SNJ", "R1Y", "R10", "NUS"]);
  assert.deepEqual(gasAreas(null, 35, -100), ["NUS"]);
  const gas = { updated: "2026-10-12", areas: {
    NUS: { name: "United States", regular: [["2026-10-12", 3.1]], diesel: [["2026-10-12", 3.7]] },
    R1Y: { name: "Central Atlantic", regular: [["2026-10-12", 3.3]] },
  } };
  const g = gasForLocation(gas, "NJ", 40.06, -74.4);
  assert.equal(g.regular.name, "Central Atlantic");
  assert.equal(g.diesel.name, "United States");
});

test("NYC inspection records match by name and distance", () => {
  const place = { name: "Joe's Pizza", lat: 40.7547, lon: -73.9877 };
  const rows = [
    { dba: "JOE'S PIZZA", latitude: "40.75475", longitude: "-73.98765", grade: "A", inspection_date: "2025-01-02" },
    { dba: "JOE'S PIZZA", latitude: "40.75475", longitude: "-73.98765", grade: "B", inspection_date: "2026-03-02" },
    { dba: "JOE'S PIZZA", latitude: "40.7300", longitude: "-73.9900", grade: "C", inspection_date: "2026-05-01" },
    { dba: "PIZZA PLACE", latitude: "40.75475", longitude: "-73.98765", grade: "C", inspection_date: "2026-06-01" },
  ];
  assert.equal(matchInspection(place, rows).grade, "B");
  assert.equal(matchInspection({ ...place, name: "Sushi Bar" }, rows), null);
  assert.ok(inNYC(40.758, -73.9855));
  assert.ok(!inNYC(40.06, -74.4));
});

test("fuel tiles cover the search circle and rows become places", async () => {
  const { fuelTileKeys, placesFromTiles } = await import("../docs/core.js");
  assert.deepEqual(fuelTileKeys(40.5, -73.5, 3000), ["40_-74"]);
  assert.deepEqual(fuelTileKeys(40.99, -73.01, 3000).sort(), ["40_-73", "40_-74", "41_-73", "41_-74"]);
  const rows = [[40.762, -73.993, "Shell", "24/7", 1, "600 11th Avenue", "node/1"], [40.9, -73.9, "Far", "", 0, "", "node/2"]];
  const p = placesFromTiles([rows], { lat: 40.758, lon: -73.9855 }, 3000);
  assert.equal(p.length, 1);
  assert.equal(p[0].tags["fuel:diesel"], "yes");
  assert.equal(p[0].tags.opening_hours, "24/7");
  assert.equal(p[0].address, "600 11th Avenue");
});

test("Google fuel prices, opening status and place matching", async () => {
  const { googleFuel, googleStatus, fromGoogle, sameGooglePlace } = await import("../docs/core.js");
  const fuel = googleFuel({ fuelPrices: [
    { type: "REGULAR_UNLEADED", price: { currencyCode: "USD", units: "3", nanos: 890000000 }, updateTime: "2026-10-15T14:00:00Z" },
    { type: "DIESEL", price: { currencyCode: "USD", units: "4", nanos: 590000000 }, updateTime: "2026-10-15T15:00:00Z" },
  ] });
  assert.deepEqual(fuel, { regular: 3.89, diesel: 4.59, updated: "2026-10-15T15:00:00Z" });
  assert.equal(googleStatus({ openNow: true, nextCloseTime: "2026-10-16T03:30:00Z" }, thu930pm).label, "Open · closes 11:30 pm");
  assert.equal(googleStatus({ openNow: true }, thu930pm).label, "Open 24 hours");
  assert.equal(googleStatus({ openNow: false, nextOpenTime: "2026-10-16T11:00:00Z" }, thu930pm).label, "Closed · opens 7 am tomorrow");
  const p = fromGoogle({ id: "abc", displayName: { text: "Shell" }, location: { latitude: 40.762, longitude: -73.993 },
    formattedAddress: "600 11th Ave, New York, NY 10036, USA", fuelOptions: {} }, { lat: 40.758, lon: -73.9855 });
  assert.equal(p.id, "g/abc");
  assert.equal(p.address, "600 11th Ave, New York, NY 10036");
  const results = [{ displayName: { text: "Joe's Pizza Broadway" }, location: { latitude: 40.7547, longitude: -73.9877 } }];
  assert.ok(sameGooglePlace({ name: "Joe's Pizza", lat: 40.7548, lon: -73.9876 }, results));
  assert.equal(sameGooglePlace({ name: "Sushi Bar", lat: 40.7548, lon: -73.9876 }, results), null);
});

test("food tiles: metro lookup, tile keys and rows to places", async () => {
  const { foodMetro, foodTileKeys, placesFromFoodTiles } = await import("../docs/core.js");
  const index = { metros: { nyc: { bounds: [40.45, -74.30, 41.05, -73.65] } } };
  assert.equal(foodMetro(index, 40.758, -73.9855), "nyc");
  assert.equal(foodMetro(index, 41.88, -87.63), null);
  assert.deepEqual(foodTileKeys(40.7625, -73.9875, 500), ["1630_-2960"]);
  assert.equal(foodTileKeys(40.758, -73.9855, 1600).length, 6);   // 2 rows x 3 columns of 2.5 km tiles
  const rows = [[40.7585, -73.9862, "Sushi Place", { amenity: "restaurant", cuisine: "sushi", "addr:housenumber": "1", "addr:street": "Broadway" }, "node/1"],
                [40.80, -73.95, "Far", { amenity: "cafe" }, "node/2"]];
  const p = placesFromFoodTiles([rows], { lat: 40.758, lon: -73.9855 }, 700);
  assert.equal(p.length, 1);
  assert.equal(p[0].tags.name, "Sushi Place");
  assert.equal(p[0].address, "1 Broadway");
});

test("food build boxes a search needs", async () => {
  const { foodBoxesFor } = await import("../docs/core.js");
  const nyc = { bounds: [40.45, -74.30, 41.05, -73.65] };
  assert.deepEqual(foodBoxesFor(nyc, 40.758, -73.9855, 700), ["40.75,-74,40.85,-73.9"]);
  assert.equal(foodBoxesFor(nyc, 40.749, -73.701, 700).length, 4);   // near a box corner
  assert.equal(foodBoxesFor(nyc, 40.5, -74.25, 700)[0], "40.45,-74.3,40.55,-74.2");
});

test("Google live results merge into the food list", async () => {
  const { mergeGoogleFood, googleCuisine } = await import("../docs/core.js");
  assert.equal(googleCuisine("thai_restaurant"), "thai");
  assert.equal(googleCuisine("hamburger_restaurant"), "burger");
  assert.equal(googleCuisine("coffee_shop"), "coffee_shop");
  assert.equal(googleCuisine(undefined), "");
  const origin = { lat: 40.758, lon: -73.9855 };
  const places = [{ id: "node/1", name: "Bangkok Garden", lat: 40.7579, lon: -73.9841, dist: 120, tags: { cuisine: "thai" } }];
  const g = [
    { id: "a", displayName: { text: "Bangkok Garden" }, location: { latitude: 40.75792, longitude: -73.98412 }, rating: 4.4,
      userRatingCount: 1287, priceLevel: "PRICE_LEVEL_MODERATE", currentOpeningHours: { openNow: true } },
    { id: "b", displayName: { text: "New Ramen Bar" }, location: { latitude: 40.7582, longitude: -73.9858 }, primaryType: "ramen_restaurant",
      formattedAddress: "1 W 45th St, New York, NY 10036, USA", rating: 4.7, currentOpeningHours: { openNow: false } },
  ];
  const out = mergeGoogleFood(places, g, origin);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "New Ramen Bar");                  // nearest first
  assert.equal(out[0].tags.cuisine, "ramen");
  assert.equal(out[0].address, "1 W 45th St, New York, NY 10036");
  assert.equal(out[1].live.rating, 4.4);
  assert.equal(out[1].live.price, "$$");
  assert.equal(places[0].live, undefined);                      // input list untouched
});

test("dishes reviewers recommend are pulled out of reviews", async () => {
  const { dishLexicon, reviewPicks } = await import("../docs/core.js");
  const lex = dishLexicon(dishes.dishes);
  const reviews = [
    { author: "Ana", text: "The pad thai was fine. You MUST try the green curry, it was incredible! Service was slow." },
    { author: "Ben", text: "Get the khao soi, best in the city. Green curry is good too." },
    { author: "Cy", text: "Great vibe. I recommend the mango sticky rice for dessert." },
    { author: "Di", text: "Must try the service here. Loved the place." },
  ];
  const picks = reviewPicks(reviews, lex);
  const names = picks.map(p => p.name);
  assert.equal(picks[0].name, "Green curry");
  assert.equal(picks[0].count, 2);
  assert.ok(picks[0].mustTry);
  assert.match(picks[0].quote, /MUST try the green curry/);
  assert.ok(names.includes("Khao Soi"));                       // not in the guide, found from "get the khao soi"
  assert.equal(picks.find(p => p.name === "Khao Soi").id, null);
  assert.ok(names.includes("Mango sticky rice"));
  assert.ok(names.includes("Pad thai"));
  assert.ok(!names.some(n => /service|place|vibe/i.test(n)));
  const pt = picks.find(p => p.name === "Pad thai");
  assert.ok(!pt.mustTry);
  assert.ok(picks.indexOf(pt) > picks.indexOf(picks.find(p => p.name === "Mango sticky rice")));
});

test("only food is ever listed as a must-try", async () => {
  const { dishLexicon, reviewPicks } = await import("../docs/core.js");
  const lex = dishLexicon(dishes.dishes);
  const picks = reviewPicks([
    { author: "A", text: "Food was cold so I had to get a refund. Must try asking for a manager." },
    { author: "B", text: "The waiter was a jerk. Highly recommend the patio. I'd get the check quickly." },
    { author: "C", text: "Must try the spicy vodka rigatoni! Also order the lamb shank." },
    { author: "D", text: "Get the slice of pizza and a cold brew." },
  ], lex).map(p => p.name);
  assert.ok(!picks.some(n => /refund|manager|jerk|patio|check/i.test(n)), picks.join(", "));
  assert.ok(picks.includes("Spicy Vodka Rigatoni"));
  assert.ok(picks.includes("Lamb Shank"));
  assert.ok(picks.includes("New York slice") && picks.includes("Cold brew"));
});
