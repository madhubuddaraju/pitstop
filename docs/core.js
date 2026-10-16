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

// ---------- prebuilt gas station tiles (US) ----------

/** Keys of the 1-degree tiles that a circle of radius m around a point touches. */
export function fuelTileKeys(lat, lon, m) {
  const dLat = m / 111320, dLon = m / (111320 * Math.cos(lat * Math.PI / 180));
  const keys = [];
  for (let a = Math.floor(lat - dLat); a <= Math.floor(lat + dLat); a++)
    for (let o = Math.floor(lon - dLon); o <= Math.floor(lon + dLon); o++) keys.push(`${a}_${o}`);
  return keys;
}

/** Tile rows [lat, lon, name, hours, diesel, address, id] -> places within m, nearest first. */
export function placesFromTiles(rowLists, origin, m) {
  const out = [];
  for (const rows of rowLists) for (const [lat, lon, name, hours, diesel, address, id] of rows) {
    const dist = distanceMeters(origin.lat, origin.lon, lat, lon);
    if (dist > m) continue;
    const tags = { amenity: "fuel", name };
    if (hours) tags.opening_hours = hours;
    if (diesel) tags["fuel:diesel"] = "yes";
    out.push({ id, name, lat, lon, tags, dist, address });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

// ---------- Google Places (optional, with the user's own key) ----------

export const GOOGLE_NEARBY = "https://places.googleapis.com/v1/places:searchNearby";
export const GOOGLE_TEXT = "https://places.googleapis.com/v1/places:searchText";

const money = p => p ? Number(p.units || 0) + (p.nanos || 0) / 1e9 : null;

/** Google fuelOptions -> {regular, midgrade, premium, diesel, updated}. */
export function googleFuel(fuelOptions) {
  const out = {};
  for (const f of fuelOptions?.fuelPrices || []) {
    const key = { REGULAR_UNLEADED: "regular", MIDGRADE: "midgrade", PREMIUM: "premium", DIESEL: "diesel" }[f.type];
    if (!key || !f.price) continue;
    out[key] = money(f.price);
    if (f.updateTime && (!out.updated || f.updateTime > out.updated)) out.updated = f.updateTime;
  }
  return out;
}

/** Google currentOpeningHours -> the same status shape as hoursStatus(). */
export function googleStatus(coh, now = new Date()) {
  if (!coh || coh.openNow == null) return { state: "unknown", label: "Hours not listed" };
  const close = coh.nextCloseTime ? new Date(coh.nextCloseTime) : null;
  const open = coh.nextOpenTime ? new Date(coh.nextOpenTime) : null;
  if (coh.openNow) {
    if (!close) return { state: "open", label: "Open 24 hours", open24: true };
    const mins = Math.round((close - now) / 60000);
    if (mins <= 45) return { state: "open", soon: true, closesAt: close, label: `Closes in ${mins} min` };
    return { state: "open", closesAt: close, label: `Open · closes ${formatTime(close)}${close - now < 12 * 3600000 ? "" : dayWord(close, now)}` };
  }
  if (!open) return { state: "closed", label: "Closed" };
  const mins = Math.round((open - now) / 60000);
  if (mins <= 45) return { state: "closed", soon: true, opensAt: open, label: `Opens in ${mins} min` };
  return { state: "closed", opensAt: open, label: `Closed · opens ${formatTime(open)}${dayWord(open, now)}` };
}

/** A Google place (Places API New) -> a Pitstop place. */
export function fromGoogle(g, origin) {
  const lat = g.location?.latitude, lon = g.location?.longitude;
  return {
    id: "g/" + g.id, google: true, name: g.displayName?.text || "Gas station", lat, lon,
    dist: distanceMeters(origin.lat, origin.lon, lat, lon),
    address: (g.shortFormattedAddress || g.formattedAddress || "").replace(/, USA$/, ""),
    tags: { amenity: "fuel", phone: g.nationalPhoneNumber, website: g.websiteUri },
    googleStatus: g.currentOpeningHours, fuel: googleFuel(g.fuelOptions), mapsUri: g.googleMapsUri,
    rating: g.rating, ratings: g.userRatingCount,
  };
}

/** Pick the Google result that is the same restaurant: close by and with a similar name. */
export function sameGooglePlace(place, results) {
  const n = s => (s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  const target = n(place.name);
  return results.find(g => {
    const d = distanceMeters(place.lat, place.lon, g.location?.latitude, g.location?.longitude);
    const name = n(g.displayName?.text);
    return d < 150 && name && (name.includes(target) || target.includes(name));
  }) || null;
}

// ---------- prebuilt food tiles (selected metro areas) ----------

/** The metro whose prebuilt tiles cover this point (with the search radius inside its bounds), or null. */
export function foodMetro(index, lat, lon) {
  for (const [name, m] of Object.entries(index?.metros || {})) {
    const [s, w, n, e] = m.bounds;
    if (lat > s + 0.01 && lat < n - 0.01 && lon > w + 0.01 && lon < e - 0.01) return name;
  }
  return null;
}

export function foodTileKeys(lat, lon, m, grid = 40) {
  const dLat = m / 111320, dLon = m / (111320 * Math.cos(lat * Math.PI / 180));
  const keys = [];
  for (let i = Math.floor((lat - dLat) * grid); i <= Math.floor((lat + dLat) * grid); i++)
    for (let j = Math.floor((lon - dLon) * grid); j <= Math.floor((lon + dLon) * grid); j++) keys.push(`${i}_${j}`);
  return keys;
}

/** Tile rows [lat, lon, name, tags, id] -> places within m, nearest first (same shape as parsePlaces). */
export function placesFromFoodTiles(rowLists, origin, m) {
  const out = [];
  for (const rows of rowLists) for (const [lat, lon, name, tags, id] of rows) {
    const dist = distanceMeters(origin.lat, origin.lon, lat, lon);
    if (dist > m) continue;
    const t = { ...tags, name };
    out.push({ id, name, lat, lon, tags: t, dist, address: formatAddress(t) });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/** Ids ("s,w,n,e") of the build boxes a search circle touches, matching how build_food_tiles.py names them. */
export function foodBoxesFor(metro, lat, lon, m, box = 0.1) {
  const [S0, W0, N0, E0] = metro.bounds;
  const r3 = x => Math.round(x * 1000) / 1000;
  const dLat = m / 111320, dLon = m / (111320 * Math.cos(lat * Math.PI / 180));
  const ids = [];
  const i0 = Math.max(0, Math.floor((lat - dLat - S0) / box + 1e-9)), i1 = Math.floor((Math.min(lat + dLat, N0 - 1e-9) - S0) / box + 1e-9);
  const j0 = Math.max(0, Math.floor((lon - dLon - W0) / box + 1e-9)), j1 = Math.floor((Math.min(lon + dLon, E0 - 1e-9) - W0) / box + 1e-9);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const s = r3(S0 + i * box), w = r3(W0 + j * box);
    ids.push([s, w, r3(Math.min(s + box, N0)), r3(Math.min(w + box, E0))].join(","));
  }
  return ids;
}

/** Google primaryType ("thai_restaurant", "coffee_shop") -> an OSM-style cuisine value the dish guide understands. */
export function googleCuisine(type) {
  if (!type) return "";
  const special = { hamburger_restaurant: "burger", steak_house: "steak_house", coffee_shop: "coffee_shop", cafe: "coffee_shop",
    ice_cream_shop: "ice_cream", sandwich_shop: "sandwich", bagel_shop: "bagel", donut_shop: "donut", bakery: "bakery",
    barbecue_restaurant: "barbecue", breakfast_restaurant: "breakfast", brunch_restaurant: "brunch", tea_house: "tea",
    dessert_shop: "dessert", juice_shop: "juice", chicken_restaurant: "chicken", fast_food_restaurant: "" };
  if (type in special) return special[type];
  return type.endsWith("_restaurant") ? type.slice(0, -"_restaurant".length) : "";
}

const PRICE = { PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$", PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$" };

function liveFrom(g) {
  return { id: g.id, coh: g.currentOpeningHours, rating: g.rating, ratings: g.userRatingCount, price: PRICE[g.priceLevel],
    mapsUri: g.googleMapsUri, summary: g.editorialSummary?.text };
}

/**
 * Add Google's live results to the map's list of food places: a place on both gets Google's live hours and rating;
 * a place only Google knows (new, or not yet mapped) is added. Returns a new list, nearest first.
 */
export function mergeGoogleFood(places, results, origin) {
  const out = places.map(p => ({ ...p }));
  for (const g of results) {
    const match = sameGooglePlace(g.displayName ? { name: g.displayName.text, lat: g.location?.latitude, lon: g.location?.longitude } : {},
      out.map(p => ({ displayName: { text: p.name }, location: { latitude: p.lat, longitude: p.lon }, p })))?.p;
    if (match) { match.live = liveFrom(g); continue; }
    const lat = g.location?.latitude, lon = g.location?.longitude;
    if (lat == null) continue;
    out.push({
      id: "g/" + g.id, google: true, name: g.displayName?.text || "Restaurant", lat, lon,
      dist: distanceMeters(origin.lat, origin.lon, lat, lon),
      address: (g.shortFormattedAddress || g.formattedAddress || "").replace(/, USA$/, ""),
      tags: { amenity: "restaurant", cuisine: googleCuisine(g.primaryType), phone: g.nationalPhoneNumber, website: g.websiteUri,
        ...(g.servesVegetarianFood ? { "diet:vegetarian": "yes" } : {}) },
      live: liveFrom(g),
    });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

// ---------- dishes reviewers recommend ----------

const fold = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// other ways reviews name dishes from the guide
const ALIASES = {
  "tikka-masala": ["tikka masala", "chicken tikka"], "butter-chicken": ["murgh makhani"], "dumplings": ["dumpling", "soup dumplings", "xiao long bao", "xlb", "potstickers"],
  "ny-slice": ["cheese slice", "pepperoni slice", "pizza slice", "slice of pizza"], "margherita-pizza": ["margherita"], "bacon-egg-cheese": ["bacon egg and cheese", "bacon, egg and cheese"],
  "tacos-al-pastor": ["al pastor", "pastor tacos"], "banh-mi": ["banh mi"], "creme-brulee": ["creme brulee"], "pho": ["pho"],
  "chicken-over-rice": ["chicken and rice", "chicken over rice", "combo over rice"], "general-tso": ["general tso", "general tsos", "general tso's"],
  "chicken-parm": ["chicken parm", "chicken parmigiana", "chicken parmesan"], "carbonara": ["carbonara"], "pastrami-on-rye": ["pastrami"],
  "bagel-lox": ["lox", "lox bagel"], "korean-fried-chicken": ["korean fried chicken"], "fried-chicken": ["fried chicken"], "buffalo-wings": ["wings", "buffalo wings"],
  "french-fries": ["fries"], "cheeseburger": ["burger", "burgers", "cheeseburger", "smashburger", "smash burger"], "massaman-curry": ["massaman"], "green-curry": ["green curry"],
  "tom-yum": ["tom yum", "tom yam"], "pad-see-ew": ["pad see ew", "pad see eew"], "mango-sticky-rice": ["mango sticky rice"], "kimchi-jjigae": ["kimchi stew", "kimchi jjigae"],
  "tteokbokki": ["tteokbokki", "topokki", "ddeokbokki"], "spring-rolls": ["summer rolls", "fresh rolls"], "jamaican-patty": ["beef patty", "jamaican patty"], "oxtail": ["oxtail", "oxtails"],
  "jerk-chicken": ["jerk chicken", "jerk pork"], "pollo-a-la-brasa": ["rotisserie chicken", "pollo a la brasa"], "cuban-sandwich": ["cuban sandwich", "cubano"],
  "doner-kebab": ["doner", "döner"], "gyro": ["gyro", "gyros"], "falafel": ["falafel"], "hummus": ["hummus"], "pancakes": ["pancakes", "pancake"],
  "lobster-roll": ["lobster roll"], "clam-chowder": ["clam chowder", "chowder"], "fish-and-chips": ["fish and chips", "fish & chips"], "cheesecake": ["cheesecake"],
  "cold-brew": ["cold brew"], "latte": ["latte"], "matcha-latte": ["matcha"], "bubble-tea": ["boba", "bubble tea"], "croissant": ["croissant"],
};
// phrases that point at a recommendation
const RECOMMEND = /\b(must[- ]?(try|have|order|get)|highly recommend|recommend(ed)?|you have to (try|get|order)|don'?t miss|the best|favorite|favourite|star of|standout|order the|get the|try the|loved the|amazing|incredible|delicious|to die for)\b/i;
const NOT_DISHES = new Set(["place", "service", "staff", "food", "atmosphere", "vibe", "vibes", "ambiance", "ambience", "experience", "spot", "restaurant",
  "price", "prices", "portion", "portions", "menu", "waiter", "waitress", "server", "owner", "location", "music", "decor", "view", "drinks", "meal",
  "dinner", "lunch", "breakfast", "brunch", "everything", "anything", "something", "time", "people", "line", "wait", "way", "one", "ones", "dish", "dishes"]);

// An item the dish guide doesn't know counts only if it contains one of these food or drink words,
// so "get a refund" or "try the patio" are never listed as dishes.
const FOOD_WORDS = new Set(("chicken beef pork lamb goat duck turkey veal shrimp prawn prawns crab lobster fish salmon tuna cod octopus calamari squid "
  + "scallops scallop clams mussels oysters oyster tofu egg eggs bacon ham sausage chorizo brisket ribs rib steak wagyu meatball meatballs "
  + "noodle noodles ramen udon soba pho rice risotto paella biryani pasta spaghetti rigatoni penne linguine fettuccine gnocchi lasagna ravioli "
  + "tortellini mac pizza pie calzone sandwich sub hero wrap burrito taco tacos quesadilla nachos enchilada enchiladas tamale tamales empanada "
  + "empanadas arepa arepas burger burgers sliders hotdog dog wings fries tots salad soup stew chili curry masala korma vindaloo dal daal "
  + "naan roti paratha dosa samosa kebab kabob shawarma gyro falafel hummus pita dumpling dumplings bao buns bun gyoza wontons wonton "
  + "spring roll rolls sushi sashimi nigiri maki poke bowl bibimbap bulgogi kimchi tteokbokki bread toast bagel croissant pastry "
  + "pancakes pancake waffle waffles crepe crepes omelette omelet benedict hash grits biscuit biscuits cornbread brownie cookie cookies cake "
  + "cheesecake tiramisu cannoli tart pudding flan churros donut donuts doughnut gelato ice cream sorbet milkshake shake smoothie coffee latte "
  + "cappuccino espresso cortado macchiato mocha matcha tea chai boba cocktail cocktails margarita mojito sangria wine beer ale lager "
  + "sauce cheese mozzarella burrata parmesan feta queso guacamole salsa fondue chop chops cutlet schnitzel katsu tempura teriyaki satay "
  + "laksa larb khao soi congee jook porridge oatmeal granola yogurt fruit mango avocado mushroom mushrooms eggplant cauliflower brussels "
  + "sprouts potatoes potato plantains plantain tostones mofongo pernil oxtail jerk patty patties roti curry goat").split(" "));

const NOT_FOOD = /\b(refund|money|cash|card|tip|tips|bill|check|reservation|table|seat|seats|booth|bathroom|restroom|parking|delivery|order number|manager|staff|waiter|waitress|server|host|hostess|owner|chef|cook|service|music|patio|bar area|vibe|atmosphere|wifi|line|wait|price|deal|discount|coupon|app|website|phone|call|ride|uber|cab|train|subway|bus)\b/;

function looksLikeFood(phrase) {
  if (NOT_FOOD.test(phrase)) return false;
  return phrase.split(/[\s-]+/).some(w => FOOD_WORDS.has(w) || FOOD_WORDS.has(w.replace(/e?s$/, "")));
}

/** Searchable names for the dish guide: [{id, name, re}] longest first, so "chicken tikka masala" wins over "chicken". */
export function dishLexicon(dishes) {
  const out = [];
  for (const [id, d] of Object.entries(dishes)) {
    const names = new Set([fold(d.name).replace(/\s*\(.*?\)/g, ""), ...(ALIASES[id] || []).map(fold)]);
    for (const n of names) if (n.length >= 3) out.push({ id, name: d.name, phrase: n,
      re: new RegExp(`(^|[^a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?(?=$|[^a-z])`, "i") });
  }
  return out.sort((a, b) => b.phrase.length - a.phrase.length);
}

function sentences(text) {
  return (text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

function clip(s, max = 140) {
  return s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

/**
 * Dishes reviewers recommend, from review texts: dishes from the guide that reviews mention (by name or alias), plus
 * items named after "must try", "get the", "recommend the"… Sorted with must-try first, then how many reviews mention them.
 * reviews: [{text, author, rating}]. Returns [{name, id, count, mustTry, quote, author}].
 */
export function reviewPicks(reviews, lexicon) {
  const picks = new Map();
  const add = (key, name, id, sentence, author, strong) => {
    const p = picks.get(key) || { name, id, count: 0, mustTry: false, quote: "", author: "", seen: new Set() };
    if (!p.seen.has(author + "|" + sentence)) {
      if (!p.seen.size || (strong && !p.mustTry)) { p.quote = clip(sentence); p.author = author; }
      p.seen.add(author + "|" + sentence);
    }
    p.mustTry ||= strong;
    picks.set(key, p);
  };
  for (const r of reviews || []) {
    const counted = new Set();
    for (const s of sentences(r.text)) {
      const f = fold(s);
      const strong = RECOMMEND.test(f);
      const taken = [];
      for (const d of lexicon) {
        if (!d.re.test(f) || taken.some(t => t.includes(d.phrase))) continue;
        taken.push(d.phrase);
        add(d.id, d.name, d.id, s, r.author, strong);
        if (!counted.has(d.id)) { counted.add(d.id); picks.get(d.id).count++; }
      }
      // menu items the guide doesn't know: "must try the spicy vodka rigatoni", "get the lamb shank"
      const m = f.match(/\b(?:must[- ]?(?:try|have|order|get)|you have to (?:try|get|order)|(?:highly )?recommend(?:ed)?|order(?:ed)?|get|got|try|tried|loved|love) (?:the |their |a |an )?([a-z][a-z'&\- ]{2,40}?)(?=[.,!;:)]| (?:and|is|was|were|are|here|it|but|with|for|too|as|which|that|so)\b|$)/);
      if (m) {
        const phrase = m[1].trim().replace(/\s+/g, " ");
        const words = phrase.split(" ");
        if (words.length <= 5 && !NOT_DISHES.has(words[words.length - 1]) && looksLikeFood(phrase) && !taken.some(t => phrase.includes(t) || t.includes(phrase))
            && !/^(it|this|that|them|here|there|again|back|everything|some|more|one|my|our|your)\b/.test(phrase)) {
          const name = phrase.replace(/\b[a-z]/g, c => c.toUpperCase());
          const key = "x:" + phrase;
          add(key, name, null, s, r.author, true);
          if (!counted.has(key)) { counted.add(key); picks.get(key).count++; }
        }
      }
    }
  }
  return [...picks.values()].map(({ seen, ...p }) => p)
    .sort((a, b) => (b.mustTry - a.mustTry) || (b.count - a.count) || (a.id ? -1 : 1));
}
