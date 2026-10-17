import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stateAt, sampleRoute, alongRoute, encodePolyline, priceStretches, worthTheDrive, dishFlags, tipAndTax } from "../docs/core.js";

const states = JSON.parse(readFileSync(new URL("../docs/states.json", import.meta.url)));

test("finds the state a point is in", () => {
  assert.equal(stateAt(states, 40.758, -73.9855), "NY");
  assert.equal(stateAt(states, 40.735, -74.172), "NJ");      // Newark
  assert.equal(stateAt(states, 41.878, -87.63), "IL");
  assert.equal(stateAt(states, 34.05, -118.25), "CA");
  assert.equal(stateAt(states, 51.5, -0.12), null);
});

test("stations near the route, in route order", () => {
  const route = [[-74.0, 40.70], [-74.0, 40.80], [-74.0, 40.90]];          // due north, about 22 km
  const samples = sampleRoute(route, 400);
  assert.ok(samples.length > 50);
  assert.ok(Math.abs(samples[samples.length - 1].along - 22239) < 50);
  const got = alongRoute([
    { id: "a", lat: 40.85, lon: -74.005 },                                   // ~420 m off, mile ~9
    { id: "b", lat: 40.75, lon: -74.001 },                                   // on the road, mile ~3
    { id: "c", lat: 40.80, lon: -73.90 },                                    // 8 km away
  ], samples, 1600);
  assert.deepEqual(got.map(p => p.id), ["b", "a"]);
  assert.ok(got[1].off > 300 && got[1].off < 600);
});

test("encoded polyline matches Google's documented example", () => {
  assert.equal(encodePolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]), "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
});

test("cheapest stretch of the route", () => {
  const st = priceStretches([
    { along: 1000, area: { code: "NYC", name: "New York City", price: 3.39 } },
    { along: 9000, area: { code: "NYC", name: "New York City", price: 3.39 } },
    { along: 20000, area: { code: "R1Y", name: "Central Atlantic", price: 3.05 } },
  ]);
  assert.equal(st.length, 2);
  assert.equal(st[0].to, 9000);
  assert.equal(st[1].name, "Central Atlantic");
});

test("a cheaper station is only worth it if the drive doesn't eat the saving", () => {
  assert.ok(worthTheDrive({ price: 3.0, comparePrice: 3.4, extraMeters: 1609 }) > 4);        // 1 mile away: worth it
  assert.ok(worthTheDrive({ price: 3.35, comparePrice: 3.4, extraMeters: 16093 }) < 0);      // 10 miles for 5¢: not
});

test("what a dish usually contains", () => {
  assert.deepEqual(dishFlags({ name: "Pad thai", ingredients: ["rice noodles", "shrimp", "peanuts", "fish sauce"] }), ["nuts", "shellfish"]);
  assert.deepEqual(dishFlags({ name: "Tacos al pastor", ingredients: ["corn tortillas", "marinated pork", "pineapple"] }), ["pork"]);
  assert.deepEqual(dishFlags({ name: "Coq au vin", ingredients: ["chicken", "red wine", "bacon"] }), ["pork", "alcohol"]);
  assert.deepEqual(dishFlags({ name: "Dal", ingredients: ["lentils", "turmeric"] }), []);
});

test("tip on the amount before tax", () => {
  assert.deepEqual(tipAndTax(100, 8.875, 20, 2), { tax: 8.88, tip: 20, total: 128.88, each: 64.44 });
});
