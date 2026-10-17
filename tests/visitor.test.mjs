import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { convertFuel, fuelInYourUnits, formatMoney, useMiles, dishSearch } from "../docs/core.js";

test("gas in litres and rupees", () => {
  const c = convertFuel(3.785411784, { volume: "l", currency: "INR" }, { INR: 84 });
  assert.equal(c.unit, "L");
  assert.ok(Math.abs(c.value - 84) < 1e-9);
  assert.equal(fuelInYourUnits(3.785411784, { volume: "l", currency: "INR" }, { INR: 84 }), "₹84.00/L");
});

test("nothing extra for dollars per gallon, and no guess without a rate", () => {
  assert.equal(fuelInYourUnits(4.33, {}, {}), null);
  assert.equal(fuelInYourUnits(4.33, { currency: "EUR" }, {}), null);
  assert.equal(fuelInYourUnits(4, { currency: "USD", volume: "l" }, {}), "$1.06/L");
});

test("currencies without decimals", () => {
  assert.equal(formatMoney(1234.6, "JPY"), "¥1,235");
  assert.equal(formatMoney(3.5, "EUR"), "€3.50");
});

test("distance units follow the visitor's choice", () => {
  assert.equal(useMiles({}, "us"), true);
  assert.equal(useMiles({ distance: "km" }, "us"), false);
  assert.equal(useMiles({}, "ca"), false);
});

test("search by dish finds the cuisines that serve it", () => {
  const guide = JSON.parse(readFileSync(new URL("../docs/dishes.json", import.meta.url)));
  const r = dishSearch("biryani", guide);
  assert.ok(r.cuisines.includes("indian"));
  assert.ok(r.dishes.some(d => /biryani/i.test(d.name)));
  assert.equal(dishSearch("zz", guide), null);
  assert.equal(dishSearch("qwertyuiop", guide), null);
});

import { inUS } from "../docs/core.js";
test("coverage is the United States", () => {
  assert.equal(inUS(40.758, -73.9855), true);      // New York
  assert.equal(inUS(21.3, -157.86), true);          // Honolulu
  assert.equal(inUS(17.385, 78.4867), false);       // Hyderabad
  assert.equal(inUS(51.5, -0.12), false);           // London
});

import { targetedFoodQuery } from "../docs/core.js";
test("a wider search targets the name, cuisine or diet asked for", () => {
  const q = targetedFoodQuery({ name: "ramen", cuisines: ["japanese", "ramen"] }, 40.758, -73.9855, 15000);
  assert.match(q, /\["name"~"ramen",i\]/);
  assert.match(q, /cuisine"~"\(\^\|;\)\(japanese\|ramen\)/);
  assert.match(q, /around:15000,40\.75800,-73\.98550/);
  assert.match(targetedFoodQuery({ halal: true }, 40, -74, 9000), /diet:halal/);
  assert.equal(targetedFoodQuery({}, 40, -74, 9000), null);
});
