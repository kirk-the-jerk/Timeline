// Place lookup for the editor: turns location text into coordinates, once, at
// authoring time. The result is stored in the file (`geo`), so a timeline keeps
// working when these services are gone. The player never imports this.
//
// Everything with a side effect (fetch, clock, waiting, storage) is passed in,
// so the Node test can run the queue, cache and fallback without a network.

import { isValidCoordinatePair, roundCoordinate } from "./coords.js";

export const NOMINATIM_ATTRIBUTION = "Location search © OpenStreetMap contributors";

// Nominatim allows one request per second. Every lookup goes through one queue
// with this much space between request starts.
export const MIN_LOOKUP_INTERVAL_MS = 1100;
export const LOOKUP_TIMEOUT_MS = 10000;
export const LOOKUP_RESULT_LIMIT = 5;
export const GEOCODE_CACHE_KEY = "timeline.geocode.cache.v1";
export const GEOCODE_CACHE_LIMIT = 300;
export const LOOKUP_PERMISSION_KEY = "timeline.geocode.allowed.v1";

export const NOMINATIM = {
  id: "nominatim",
  host: "nominatim.openstreetmap.org",
  buildUrl: (query) => `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${LOOKUP_RESULT_LIMIT}&q=${encodeURIComponent(query)}`,
  parse: parseNominatimResponse
};

export const PHOTON = {
  id: "photon",
  host: "photon.komoot.io",
  buildUrl: (query) => `https://photon.komoot.io/api/?limit=${LOOKUP_RESULT_LIMIT}&q=${encodeURIComponent(query)}`,
  parse: parsePhotonResponse
};

export const DEFAULT_GEOCODE_PROVIDERS = [NOMINATIM, PHOTON];

// Shown by everything in the editor that can start a lookup (the Location row,
// the pin dialog, the batch action), so they all ask the same question.
export const LOOKUP_CONSENT_TEXT = `Look up places online? The location text you enter, and your IP address, are sent to ${NOMINATIM.host} (OpenStreetMap) to find coordinates. If that service is unavailable they are sent to ${PHOTON.host} (Komoot) instead. Coordinates are saved in your timeline; nothing else leaves this browser.`;

export class GeocodeError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "GeocodeError";
    if (cause) this.cause = cause;
  }
}

export function normalizeLookupQuery(text) {
  return String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// `[{ label, lat, lng }]` from a Nominatim `jsonv2` search response. Nominatim
// sends the numbers as strings.
export function parseNominatimResponse(data) {
  if (!Array.isArray(data)) throw new GeocodeError("Unexpected Nominatim response.");
  return data.flatMap((item) => {
    const result = toResult(item?.display_name, Number(item?.lat), Number(item?.lon));
    return result ? [result] : [];
  });
}

// `[{ label, lat, lng }]` from a Photon GeoJSON response. GeoJSON puts the
// longitude first.
export function parsePhotonResponse(data) {
  if (!Array.isArray(data?.features)) throw new GeocodeError("Unexpected Photon response.");
  return data.features.flatMap((feature) => {
    const [lng, lat] = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const result = toResult(photonLabel(feature?.properties), lat, lng);
    return result ? [result] : [];
  });
}

function photonLabel(properties) {
  if (!properties || typeof properties !== "object") return "";
  const street = [properties.housenumber, properties.street].filter(Boolean).join(" ");
  const parts = [properties.name, street, properties.city || properties.town || properties.village, properties.county, properties.state, properties.country]
    .filter((part) => typeof part === "string" && part.trim());
  return parts.filter((part, index) => parts.indexOf(part) === index).join(", ");
}

function toResult(label, lat, lng) {
  if (!isValidCoordinatePair(lat, lng)) return null;
  return {
    label: String(label || "").trim() || `${roundCoordinate(lat)}, ${roundCoordinate(lng)}`,
    lat: roundCoordinate(lat),
    lng: roundCoordinate(lng)
  };
}

// `fetch` is required. The rest default to the browser's own.
//
// - `geocode(query)` resolves to `[{ label, lat, lng }]`, best match first,
//   or `[]` when the service answered and found nothing.
// - It rejects with a GeocodeError when no service could be reached, and with
//   nothing cached. A failure is never cached.
// - Providers are tried in order. A service that answers, even with no match,
//   is believed; only a failure moves on to the next.
export function createGeocoder({
  fetch,
  providers = DEFAULT_GEOCODE_PROVIDERS,
  now = () => Date.now(),
  wait = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
  setTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
  storage = null,
  minIntervalMs = MIN_LOOKUP_INTERVAL_MS,
  timeoutMs = LOOKUP_TIMEOUT_MS,
  cacheLimit = GEOCODE_CACHE_LIMIT
} = {}) {
  if (typeof fetch !== "function") throw new TypeError("createGeocoder needs a fetch function.");

  let queue = Promise.resolve();
  let lastStart = null;
  let cache = null;

  return { geocode, providers };

  function geocode(query) {
    const key = normalizeLookupQuery(query);
    if (!key) return Promise.resolve([]);

    const cached = readCache().get(key);
    if (cached) return Promise.resolve(cached.map((result) => ({ ...result })));

    // Chain on the queue so lookups run one at a time, spaced apart. A failed
    // lookup must not break the chain for the next one.
    const run = queue.then(() => lookUp(key, String(query).trim().replace(/\s+/g, " ")));
    queue = run.catch(() => {});
    return run;
  }

  async function lookUp(key, query) {
    // Another queued lookup for the same text may have filled the cache while
    // this one waited its turn.
    const cached = readCache().get(key);
    if (cached) return cached.map((result) => ({ ...result }));

    let failure = null;
    for (const provider of providers) {
      await waitForSlot();
      try {
        const results = provider.parse(await requestJson(provider.buildUrl(query)));
        writeCache(key, results);
        return results.map((result) => ({ ...result }));
      } catch (error) {
        failure = error;
      }
    }
    throw new GeocodeError("The place lookup failed.", { cause: failure });
  }

  async function waitForSlot() {
    if (lastStart !== null) {
      const delay = lastStart + minIntervalMs - now();
      if (delay > 0) await wait(delay);
    }
    lastStart = now();
  }

  async function requestJson(url) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimer(() => controller?.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller?.signal,
        headers: { Accept: "application/json" },
        credentials: "omit"
      });
      if (!response.ok) throw new GeocodeError(`The lookup service answered ${response.status}.`);
      return await response.json();
    } finally {
      clearTimer(timer);
    }
  }

  // The cache is a Map in insertion order, oldest first, mirrored into
  // `storage` so it survives a reload. Storage that is missing or broken just
  // means no persistence.
  function readCache() {
    if (cache) return cache;
    cache = new Map();
    try {
      const saved = JSON.parse(storage?.getItem(GEOCODE_CACHE_KEY) ?? "null");
      if (Array.isArray(saved)) {
        for (const entry of saved) {
          if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Array.isArray(entry[1])) continue;
          const results = entry[1].flatMap((item) => {
            const result = toResult(item?.label, item?.lat, item?.lng);
            return result ? [result] : [];
          });
          cache.set(entry[0], results);
        }
      }
    } catch {
      cache = new Map();
    }
    return cache;
  }

  function writeCache(key, results) {
    const entries = readCache();
    entries.delete(key);
    entries.set(key, results);
    while (entries.size > cacheLimit) entries.delete(entries.keys().next().value);
    try {
      storage?.setItem(GEOCODE_CACHE_KEY, JSON.stringify([...entries]));
    } catch {
      // Storage full or blocked: the in-memory cache still works this session.
    }
  }
}

// Late answers must not overwrite newer ones. `begin()` hands out a token and
// invalidates every earlier one; a result is used only while its token is
// still `isCurrent`. `cancel()` invalidates without starting a new lookup, for
// when the form moves to another event.
export function createLookupGuard() {
  let latest = 0;
  return {
    begin: () => ++latest,
    cancel: () => { latest += 1; },
    isCurrent: (token) => token === latest
  };
}

// The person's answer to "Look up places online?". `allowed` is remembered in
// storage. "Not now" is remembered only until this object goes away (the
// editor session), and asks again after that.
export function createLookupPermission(storage = null) {
  let deferred = false;
  let sessionAllowed = false;
  return {
    isAllowed,
    isDeferred: () => deferred,
    allow() {
      deferred = false;
      // Held for this session whatever storage does; storage makes it last.
      sessionAllowed = true;
      try {
        storage?.setItem(LOOKUP_PERMISSION_KEY, "1");
      } catch {
        // Blocked or full: the permission lasts only until the page closes.
      }
    },
    defer() {
      deferred = true;
    },
    forget() {
      deferred = false;
      sessionAllowed = false;
      try {
        storage?.removeItem(LOOKUP_PERMISSION_KEY);
      } catch {
        // Nothing stored that we could not already forget.
      }
    }
  };

  function isAllowed() {
    if (sessionAllowed) return true;
    try {
      return storage?.getItem(LOOKUP_PERMISSION_KEY) === "1";
    } catch {
      return false;
    }
  }
}
