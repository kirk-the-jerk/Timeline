import assert from "node:assert/strict";
import {
  GEOCODE_CACHE_KEY,
  GeocodeError,
  LOOKUP_PERMISSION_KEY,
  createGeocoder,
  createLookupGuard,
  createLookupPermission,
  normalizeLookupQuery,
  parseNominatimResponse,
  parsePhotonResponse
} from "../src/geocode.js";

const NOMINATIM_HOST = "nominatim.openstreetmap.org";
const PHOTON_HOST = "photon.komoot.io";

const NOMINATIM_HUNTSVILLE = [
  { display_name: "Huntsville, Walker County, Texas, United States", lat: "30.7235263", lon: "-95.5507790" },
  { display_name: "Huntsville, Madison County, Alabama, United States", lat: "34.7304", lon: "-86.5861" }
];

const PHOTON_HUNTSVILLE = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [-95.55078, 30.72353] }, properties: { name: "Huntsville", county: "Walker County", state: "Texas", country: "United States" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-86.5861, 34.7304] }, properties: { name: "Huntsville", city: "Huntsville", state: "Alabama", country: "United States" } }
  ]
};

async function main() {
  checkParsers();
  await checkQueueSpacing();
  await checkCache();
  await checkFallback();
  await checkFailureNotCached();
  await checkTimeout();
  checkGuard();
  checkPermission();
  console.log("OK geocode");
}

function checkParsers() {
  assert.deepEqual(parseNominatimResponse(NOMINATIM_HUNTSVILLE), [
    { label: "Huntsville, Walker County, Texas, United States", lat: 30.72353, lng: -95.55078 },
    { label: "Huntsville, Madison County, Alabama, United States", lat: 34.7304, lng: -86.5861 }
  ]);
  assert.deepEqual(parseNominatimResponse([]), []);
  assert.deepEqual(parseNominatimResponse([{ display_name: "Bad", lat: "x", lon: "1" }, { display_name: "Range", lat: "95", lon: "1" }, null]), []);
  assert.equal(parseNominatimResponse([{ lat: "1", lon: "2" }])[0].label, "1, 2", "a missing name falls back to the point");
  assert.throws(() => parseNominatimResponse({ error: "rate limited" }), GeocodeError);

  const photon = parsePhotonResponse(PHOTON_HUNTSVILLE);
  assert.deepEqual(photon[0], { label: "Huntsville, Walker County, Texas, United States", lat: 30.72353, lng: -95.55078 }, "GeoJSON is lng, lat");
  assert.equal(photon[1].label, "Huntsville, Alabama, United States", "repeated name parts are collapsed");
  assert.deepEqual(parsePhotonResponse({ features: [] }), []);
  assert.deepEqual(parsePhotonResponse({ features: [{ geometry: { coordinates: [200, 0] }, properties: {} }, {}] }), []);
  assert.throws(() => parsePhotonResponse(null), GeocodeError);

  assert.equal(normalizeLookupQuery("  Huntsville,   TX "), "huntsville, tx");
}

// A fake world: a clock that only `wait` advances, a fetch that logs when and
// what was asked, and a canned answer per host.
function makeWorld(answers = {}) {
  const world = {
    time: 1000,
    calls: [],
    waits: [],
    now: () => world.time,
    wait: async (ms) => { world.waits.push(ms); world.time += ms; },
    setTimer: () => 0,
    clearTimer: () => {},
    fetch: async (url, options) => {
      const host = new URL(url).host;
      world.calls.push({ url, host, at: world.time, options });
      const answer = answers[host];
      if (answer instanceof Error) throw answer;
      if (typeof answer === "function") return answer(url);
      return answer ?? { ok: false, status: 500, json: async () => ({}) };
    }
  };
  return world;
}

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); }
  };
}

function makeBrokenStorage() {
  return {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("full"); },
    removeItem() { throw new Error("blocked"); }
  };
}

async function checkQueueSpacing() {
  const world = makeWorld({ [NOMINATIM_HOST]: okJson(NOMINATIM_HUNTSVILLE) });
  const geocoder = createGeocoder(world);

  const [first, second, third] = await Promise.all([
    geocoder.geocode("Huntsville TX"),
    geocoder.geocode("Springfield"),
    geocoder.geocode("Paris")
  ]);
  assert.equal(first[0].label, "Huntsville, Walker County, Texas, United States");
  assert.equal(second.length, 2);
  assert.equal(third.length, 2);

  assert.equal(world.calls.length, 3);
  const starts = world.calls.map((call) => call.at);
  assert.ok(starts[1] - starts[0] >= 1100, "second request waits out the interval");
  assert.ok(starts[2] - starts[1] >= 1100, "third request waits out the interval");
  assert.deepEqual(world.calls.map((call) => new URL(call.url).searchParams.get("q")), ["Huntsville TX", "Springfield", "Paris"], "requests run in order");
  assert.equal(new URL(world.calls[0].url).searchParams.get("format"), "jsonv2");

  // A lookup after a long pause starts at once.
  world.time += 60000;
  const waitsBefore = world.waits.length;
  await geocoder.geocode("Oslo");
  assert.equal(world.waits.length, waitsBefore, "no wait after a long idle");
  assert.equal(world.calls[3].options.credentials, "omit", "no cookies go to the service");

  // Blank text asks nothing.
  assert.deepEqual(await geocoder.geocode("   "), []);
  assert.equal(world.calls.length, 4);
}

async function checkCache() {
  const storage = makeStorage();
  const world = makeWorld({ [NOMINATIM_HOST]: okJson(NOMINATIM_HUNTSVILLE) });
  const geocoder = createGeocoder({ ...world, storage });

  await geocoder.geocode("Huntsville TX");
  const again = await geocoder.geocode("  huntsville   tx ");
  assert.equal(world.calls.length, 1, "a repeated query, however spaced or cased, is not sent again");
  assert.equal(again[0].lat, 30.72353);
  again[0].lat = 0;
  assert.equal((await geocoder.geocode("Huntsville TX"))[0].lat, 30.72353, "callers can't corrupt the cache");

  // Queries queued together for the same text are sent once.
  const twin = makeWorld({ [NOMINATIM_HOST]: okJson(NOMINATIM_HUNTSVILLE) });
  const twinGeocoder = createGeocoder(twin);
  await Promise.all([twinGeocoder.geocode("Rome"), twinGeocoder.geocode("Rome")]);
  assert.equal(twin.calls.length, 1);

  // It survives a reload through storage.
  const reloaded = makeWorld({});
  const fresh = createGeocoder({ ...reloaded, storage });
  assert.equal((await fresh.geocode("Huntsville TX"))[0].label, NOMINATIM_HUNTSVILLE[0].display_name);
  assert.equal(reloaded.calls.length, 0);

  // A found-nothing answer is a real answer and is cached too.
  const empty = makeWorld({ [NOMINATIM_HOST]: okJson([]) });
  const emptyGeocoder = createGeocoder(empty);
  assert.deepEqual(await emptyGeocoder.geocode("Nowhereville"), []);
  assert.deepEqual(await emptyGeocoder.geocode("Nowhereville"), []);
  assert.equal(empty.calls.length, 1);
  assert.equal(empty.calls.some((call) => call.host === PHOTON_HOST), false, "no match is not a failure, so no fallback");

  // The cache is capped, dropping the oldest.
  const capped = makeWorld({ [NOMINATIM_HOST]: okJson(NOMINATIM_HUNTSVILLE) });
  const cappedStorage = makeStorage();
  const cappedGeocoder = createGeocoder({ ...capped, storage: cappedStorage, cacheLimit: 3 });
  for (const name of ["a", "b", "c", "d"]) await cappedGeocoder.geocode(name);
  assert.deepEqual(JSON.parse(cappedStorage.getItem(GEOCODE_CACHE_KEY)).map((entry) => entry[0]), ["b", "c", "d"]);
  await cappedGeocoder.geocode("a");
  assert.equal(capped.calls.length, 5, "the evicted query is looked up again");

  // Broken storage never breaks a lookup.
  const brokenWorld = makeWorld({ [NOMINATIM_HOST]: okJson(NOMINATIM_HUNTSVILLE) });
  const brokenGeocoder = createGeocoder({ ...brokenWorld, storage: makeBrokenStorage() });
  assert.equal((await brokenGeocoder.geocode("Lima")).length, 2);
  await brokenGeocoder.geocode("Lima");
  assert.equal(brokenWorld.calls.length, 1, "the in-memory cache still works");

  // Garbage in storage is ignored.
  const garbage = createGeocoder({
    ...makeWorld({ [NOMINATIM_HOST]: okJson([]) }),
    storage: makeStorage({ [GEOCODE_CACHE_KEY]: "{not json" })
  });
  assert.deepEqual(await garbage.geocode("x"), []);
}

async function checkFallback() {
  const failures = {
    "a network error": new TypeError("Failed to fetch"),
    "a 429": { ok: false, status: 429, json: async () => ({}) },
    "a 503": { ok: false, status: 503, json: async () => ({}) },
    "an unexpected body": okJson({ error: "nope" }),
    "bad JSON": { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }
  };
  for (const [name, failure] of Object.entries(failures)) {
    const world = makeWorld({ [NOMINATIM_HOST]: failure, [PHOTON_HOST]: okJson(PHOTON_HUNTSVILLE) });
    const results = await createGeocoder(world).geocode("Huntsville TX");
    assert.deepEqual(world.calls.map((call) => call.host), [NOMINATIM_HOST, PHOTON_HOST], name);
    assert.equal(results[0].label, "Huntsville, Walker County, Texas, United States", name);
    assert.ok(world.calls[1].at - world.calls[0].at >= 1100, `${name}: the fallback also waits its turn`);
  }

  const both = makeWorld({ [NOMINATIM_HOST]: new TypeError("offline"), [PHOTON_HOST]: new TypeError("offline") });
  await assert.rejects(createGeocoder(both).geocode("Huntsville TX"), (error) => {
    assert.ok(error instanceof GeocodeError);
    assert.ok(error.cause instanceof TypeError);
    return true;
  });
}

async function checkFailureNotCached() {
  let healthy = false;
  const world = makeWorld({
    [NOMINATIM_HOST]: () => healthy ? okJson(NOMINATIM_HUNTSVILLE) : { ok: false, status: 503, json: async () => ({}) },
    [PHOTON_HOST]: new TypeError("offline")
  });
  const geocoder = createGeocoder(world);
  await assert.rejects(geocoder.geocode("Huntsville TX"), GeocodeError);
  // The failed lookup must neither wedge the queue nor be remembered.
  healthy = true;
  assert.equal((await geocoder.geocode("Huntsville TX")).length, 2);
  assert.equal(world.calls.length, 3);
}

async function checkTimeout() {
  const world = makeWorld({ [PHOTON_HOST]: okJson(PHOTON_HUNTSVILLE) });
  const answerFromPhoton = world.fetch;
  let aborted = 0;
  world.fetch = (url, options) => {
    if (new URL(url).host !== NOMINATIM_HOST) return answerFromPhoton(url, options);
    // Nominatim never answers; only the abort ends the request.
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => { aborted += 1; reject(new Error("aborted")); });
    });
  };
  const timers = [];
  world.setTimer = (callback) => { timers.push(callback); return timers.length; };

  const pending = createGeocoder(world).geocode("Huntsville TX");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.length, 1, "a timeout was armed for the hung request");
  timers[0]();
  assert.equal((await pending)[0].label, "Huntsville, Walker County, Texas, United States");
  assert.equal(aborted, 1, "the hung request was aborted, then the fallback answered");
}

function checkGuard() {
  const guard = createLookupGuard();
  const first = guard.begin();
  assert.equal(guard.isCurrent(first), true);
  const second = guard.begin();
  assert.equal(guard.isCurrent(first), false, "a newer lookup makes the older answer stale");
  assert.equal(guard.isCurrent(second), true);
  guard.cancel();
  assert.equal(guard.isCurrent(second), false, "moving to another event invalidates the lookup in flight");
}

function checkPermission() {
  const storage = makeStorage();
  const permission = createLookupPermission(storage);
  assert.equal(permission.isAllowed(), false);
  permission.allow();
  assert.equal(permission.isAllowed(), true);
  assert.equal(storage.getItem(LOOKUP_PERMISSION_KEY), "1");
  assert.equal(createLookupPermission(storage).isAllowed(), true, "Allow is remembered across sessions");

  permission.forget();
  assert.equal(permission.isAllowed(), false);
  assert.equal(storage.getItem(LOOKUP_PERMISSION_KEY), null);

  // "Not now" lasts for this session only and stores nothing.
  const session = createLookupPermission(storage);
  session.defer();
  assert.equal(session.isDeferred(), true);
  assert.equal(session.isAllowed(), false);
  assert.equal(storage.getItem(LOOKUP_PERMISSION_KEY), null);
  assert.equal(createLookupPermission(storage).isDeferred(), false, "the next session asks again");
  session.allow();
  assert.equal(session.isDeferred(), false, "allowing clears the deferral");

  // Without storage, Allow holds for the session and the next session asks again.
  const noStorage = createLookupPermission(null);
  noStorage.allow();
  assert.equal(noStorage.isAllowed(), true);
  assert.equal(createLookupPermission(null).isAllowed(), false);
  noStorage.forget();
  assert.equal(noStorage.isAllowed(), false);

  const blocked = createLookupPermission(makeBrokenStorage());
  assert.equal(blocked.isAllowed(), false);
  blocked.allow();
  assert.equal(blocked.isAllowed(), true, "blocked storage falls back to this session");
  blocked.forget();
  assert.equal(blocked.isAllowed(), false);
}

main();
