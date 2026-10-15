// Pure logic for Pitstop: distances, OpenStreetMap queries, opening hours, cuisines, gas price areas.
// No DOM access here, so it can be tested in Node.

// Public Overpass servers that allow requests from web pages. They are asked at the same time; first answer wins.
export const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export const FOOD_AMENITIES = ["restaurant", "fast_food", "cafe", "food_court", "ice_cream", "pub", "bar"];

// ---------- distance ----------

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Straight-line distance understates the real route; city streets add roughly 30%.
const ROUTE_FACTOR = 1.3;

export function formatDistance(m, { miles = true, mode = "walk" } = {}) {
  const route = m * ROUTE_FACTOR;
  let dist;
  if (miles) {
    const mi = m / 1609.344;
    dist = mi < 0.1 ? `${Math.round(m * 3.28084 / 10) * 10} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  } else {
    dist = m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
  }
  if (mode === "walk") {
    const min = Math.max(1, Math.round(route / 80));          // ~4.8 km/h
    return min <= 30 ? `${dist} · ${min} min walk` : dist;
  }
  const min = Math.max(1, Math.round(route / 400));            // ~24 km/h average in town
  return `${dist} · ${min} min drive`;
}

// ---------- OpenStreetMap (Overpass) ----------

export function overpassQuery(kind, lat, lon, radius) {
  const around = `(around:${Math.round(radius)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const body = kind === "gas"
    ? `nwr["amenity"="fuel"]${around};`
    : `nwr["amenity"~"^(${FOOD_AMENITIES.join("|")})$"]["name"]${around};`;
  return `[out:json][timeout:25];(${body});out center tags;`;
}

export function parsePlaces(json, kind, origin) {
  const seen = new Set();
  const out = [];
  for (const el of json.elements || []) {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    const t = el.tags || {};
    if (lat == null || lon == null) continue;
    const name = t.name || t.brand || (kind === "gas" ? "Gas station" : null);
    if (!name) continue;
    // the same place is sometimes mapped as both a point and a building outline
    const key = `${name.toLowerCase()}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `${el.type}/${el.id}`, name, lat, lon, tags: t,
      dist: distanceMeters(origin.lat, origin.lon, lat, lon),
      address: formatAddress(t),
    });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

export function formatAddress(t) {
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return [street, t["addr:city"] || t["addr:suburb"]].filter(Boolean).join(", ");
}

// ---------- cuisines ----------

export function cuisineIndex(cuisines) {
  const index = {};
  for (const [key, c] of Object.entries(cuisines)) for (const v of c.osm) index[v] ??= key;
  return index;
}

/** Cuisine keys for a place, most specific first (OSM values are ";"-separated). */
export function cuisinesFor(tags, index) {
  const raw = (tags.cuisine || "").toLowerCase().split(/[;,]/).map(s => s.trim().replace(/\s+/g, "_")).filter(Boolean);
  const keys = [];
  for (const v of raw) { const k = index[v]; if (k && !keys.includes(k)) keys.push(k); }
  if (!keys.length && (tags.amenity === "cafe")) keys.push("coffee");
  if (!keys.length && tags.amenity === "ice_cream") keys.push("donut");
  if (tags["diet:halal"] === "only" && !keys.includes("halal")) keys.push("halal");
  return keys;
}

export function cuisineLabel(tags, keys, cuisines) {
  if (keys.length) return keys.slice(0, 2).map(k => cuisines[k].label).join(" · ");
  const raw = (tags.cuisine || "").split(";")[0].replace(/_/g, " ").trim();
  if (raw) return raw[0].toUpperCase() + raw.slice(1);
  return { fast_food: "Fast food", cafe: "Café", pub: "Pub", bar: "Bar", food_court: "Food court", ice_cream: "Ice cream" }[tags.amenity] || "Restaurant";
}

export function dishesFor(keys, cuisines, limit = 8) {
  const ids = [];
  for (const k of keys) for (const d of cuisines[k]?.dishes || []) if (!ids.includes(d)) ids.push(d);
  return ids.slice(0, limit);
}

export function dietBadges(tags) {
  const yes = v => v === "yes" || v === "only";
  const b = [];
  if (yes(tags["diet:halal"])) b.push(tags["diet:halal"] === "only" ? "Halal" : "Halal options");
  if (yes(tags["diet:kosher"])) b.push("Kosher");
  if (tags["diet:vegan"] === "only") b.push("Vegan");
  else if (yes(tags["diet:vegan"])) b.push("Vegan options");
  if (tags["diet:vegetarian"] === "only") b.push("Vegetarian");
  else if (yes(tags["diet:vegetarian"]) && !yes(tags["diet:vegan"])) b.push("Vegetarian options");
  if (yes(tags["diet:gluten_free"])) b.push("Gluten-free options");
  return b;
}

export function serviceBadges(tags) {
  const b = [];
  if (tags.takeaway === "yes" || tags.takeaway === "only") b.push("Takeout");
  if (tags.delivery === "yes") b.push("Delivery");
  if (tags.outdoor_seating === "yes") b.push("Outdoor seating");
  if (tags.wheelchair === "yes") b.push("Wheelchair accessible");
  if (tags["payment:cash"] === "only" || tags["payment:cards"] === "no" || tags["payment:credit_cards"] === "no") b.push("Cash only");
  return b;
}

// ---------- opening hours ----------

export function formatTime(d) {
  let h = d.getHours(), m = d.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  if (h === 12 && m === 0) return ap === "am" ? "midnight" : "noon";
  return m ? `${h}:${String(m).padStart(2, "0")} ${ap}` : `${h} ${ap}`;
}

function dayWord(d, now) {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const days = Math.round((b - a) / 86400000);
  if (days <= 0) return "";
  if (days === 1) return " tomorrow";
  return " " + d.toLocaleDateString("en-US", { weekday: "short" });
}

/**
 * Status of a place from its OSM opening_hours value.
 * OH is the opening_hours.js class (passed in so this module has no dependency); ctx gives location for holidays.
 * Returns {state: open|closed|unknown, label, soon, closesAt, opensAt}.
 */
export function hoursStatus(OH, value, now = new Date(), ctx = null) {
  if (!value) return { state: "unknown", label: "Hours not listed" };
  let oh;
  try { oh = new OH(value, ctx, 0); } catch { return { state: "unknown", label: "Hours not listed" }; }
  let open, next;
  try {
    open = oh.getState(now);
    next = oh.getNextChange(now);
    if (oh.getUnknown(now)) return { state: "unknown", label: "Hours uncertain", comment: oh.getComment(now) };
  } catch { return { state: "unknown", label: "Hours not listed" }; }
  if (open) {
    if (!next || next - now > 6 * 86400000) return { state: "open", label: "Open 24 hours", open24: true };
    const mins = Math.round((next - now) / 60000);
    if (mins <= 45) return { state: "open", soon: true, closesAt: next, label: `Closes in ${mins} min` };
    // a late close (2 am) reads naturally without "tomorrow"
    const when = next - now < 12 * 3600000 ? "" : dayWord(next, now);
    return { state: "open", closesAt: next, label: `Open · closes ${formatTime(next)}${when}` };
  }
  if (!next) return { state: "closed", label: "Closed" };
  const mins = Math.round((next - now) / 60000);
  if (mins <= 45) return { state: "closed", soon: true, opensAt: next, label: `Opens in ${mins} min` };
  return { state: "closed", opensAt: next, label: `Closed · opens ${formatTime(next)}${dayWord(next, now)}` };
}

/** Open past midnight tonight (or 24 hours). */
export function lateNight(status, now = new Date()) {
  if (status.state !== "open") return false;
  if (status.open24) return true;
  if (!status.closesAt) return false;
  const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  return status.closesAt > midnight;
}

/** A week of hours as [{day, text}] starting today, using opening_hours.js intervals. */
export function weekHours(OH, value, now = new Date(), ctx = null) {
  let oh;
  try { oh = new OH(value, ctx, 0); } catch { return []; }
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const from = new Date(now); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() + i);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    // look half a day either side so a shift that runs past midnight shows its real closing time
    let ivs = [];
    try { ivs = oh.getOpenIntervals(new Date(from - 43200000), new Date(+to + 43200000)); } catch { return []; }
    const allDay = ivs.some(([a, b]) => a <= from && b >= to);
    const today = ivs.filter(([a]) => a >= from && a < to);
    const text = allDay ? "Open 24 hours" : !today.length ? "Closed"
      : today.map(([a, b]) => `${formatTime(a)} – ${formatTime(b)}`).join(", ");
    rows.push({ day: i === 0 ? "Today" : from.toLocaleDateString("en-US", { weekday: "long" }), text });
  }
  return rows;
}

// ---------- gas price areas (EIA) ----------

const PADD = {
  R1X: ["CT", "ME", "MA", "NH", "RI", "VT"],
  R1Y: ["DE", "DC", "MD", "NJ", "NY", "PA"],
  R1Z: ["FL", "GA", "NC", "SC", "VA", "WV"],
  R20: ["IL", "IN", "IA", "KS", "KY", "MI", "MN", "MO", "NE", "ND", "SD", "OH", "OK", "TN", "WI"],
  R30: ["AL", "AR", "LA", "MS", "NM", "TX"],
  R40: ["CO", "ID", "MT", "UT", "WY"],
  R50: ["AK", "AZ", "CA", "HI", "NV", "OR", "WA"],
};

// EIA city series and where those cities are (prices are reported for the metro area)
export const EIA_CITIES = {
  Y35NY: [40.71, -74.01], YBOS: [42.36, -71.06], YORD: [41.88, -87.63], YCLE: [41.50, -81.69],
  YDEN: [39.74, -104.99], Y44HO: [29.76, -95.37], Y05LA: [34.05, -118.24], YMIA: [25.76, -80.19],
  Y05SF: [37.77, -122.42], Y48SE: [47.61, -122.33],
};

/** Area codes to try for a location, most local first. */
export function gasAreas(stateCode, lat, lon) {
  const areas = [];
  for (const [code, [clat, clon]] of Object.entries(EIA_CITIES)) {
    if (distanceMeters(lat, lon, clat, clon) < 60000) areas.push(code);
  }
  if (stateCode) {
    areas.push("S" + stateCode);
    const padd = Object.entries(PADD).find(([, s]) => s.includes(stateCode));
    if (padd) {
      areas.push(padd[0]);
      if (padd[0].startsWith("R1")) areas.push("R10");
    }
  }
  areas.push("NUS");
  return areas;
}

/** Pick the most local series available for regular gas and diesel. */
export function gasForLocation(gas, stateCode, lat, lon) {
  if (!gas?.areas) return null;
  const pick = product => {
    for (const code of gasAreas(stateCode, lat, lon)) {
      const s = gas.areas[code]?.[product];
      if (s?.length) return { code, name: gas.areas[code].name, series: s };
    }
    return null;
  };
  return { regular: pick("regular"), diesel: pick("diesel"), updated: gas.updated };
}

// ---------- NYC restaurant inspections ----------

export function inNYC(lat, lon) {
  return lat > 40.49 && lat < 40.92 && lon > -74.27 && lon < -73.68;
}

const norm = s => (s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "")
  .replace(/^the/, "").replace(/(restaurant|nyc|newyork|inc|llc)$/g, "");

/** Find the inspection record for a place: similar name, within ~120 m. Records come from NYC Open Data. */
export function matchInspection(place, records) {
  const target = norm(place.name);
  if (!target) return null;
  let best = null;
  for (const r of records) {
    const lat = +r.latitude, lon = +r.longitude;
    if (!lat || !lon) continue;
    if (distanceMeters(place.lat, place.lon, lat, lon) > 120) continue;
    const name = norm(r.dba);
    const ok = name === target || (target.length >= 4 && (name.startsWith(target) || target.startsWith(name)) && Math.min(name.length, target.length) >= 4);
    if (!ok) continue;
    if (!best || (r.inspection_date || "") > (best.inspection_date || "")) best = r;
  }
  return best;
}
