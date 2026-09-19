// Coordinates for an event's optional `geo` field. No DOM and no network, so
// the schema code, the editor and the Node tests can all use it.

export const COORDINATE_DECIMALS = 5;
export const GEO_SOURCES = ["search", "map", "manual"];

const COORDINATE_FACTOR = 10 ** COORDINATE_DECIMALS;

export function roundCoordinate(value) {
  return Math.round(value * COORDINATE_FACTOR) / COORDINATE_FACTOR;
}

export function isValidCoordinatePair(lat, lng) {
  return typeof lat === "number" && typeof lng === "number"
    && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90
    && lng >= -180 && lng <= 180;
}

// Returns a clean `{ lat, lng, source? }`, or null when the input can't be a
// point. `source` is kept only when it is a known value; a missing or unknown
// one is left off, and readers treat that as "manual" (geoSource).
export function normalizeGeo(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (!isValidCoordinatePair(input.lat, input.lng)) return null;
  return {
    lat: roundCoordinate(input.lat),
    lng: roundCoordinate(input.lng),
    ...(GEO_SOURCES.includes(input.source) ? { source: input.source } : {})
  };
}

export function geoSource(geo) {
  return GEO_SOURCES.includes(geo?.source) ? geo.source : "manual";
}

// Only coordinates that came from a lookup may be replaced by another lookup
// without asking. Anything a person pinned or typed is theirs.
export function canAutoReplaceGeo(geo) {
  return !geo || geoSource(geo) === "search";
}

export function sameGeo(a, b) {
  if (!a || !b) return !a && !b;
  return a.lat === b.lat && a.lng === b.lng;
}

export function formatCoordinates(geo) {
  if (!geo) return "";
  return `${roundCoordinate(geo.lat)}, ${roundCoordinate(geo.lng)}`;
}

const NUMBER = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
const HEMISPHERE = "[NSEWnsew]";
// A coordinate with an optional hemisphere letter on either side and an
// optional degree sign, e.g. `30.7235`, `-95.5508`, `30.7235° N`, `W 95.5508`.
const PART = `(?:(${HEMISPHERE})\\s*)?(${NUMBER})\\s*°?\\s*(${HEMISPHERE})?`;
const PAIR_PATTERN = new RegExp(`^${PART}\\s*[,;\\s]\\s*${PART}$`);
const MAPS_URL_PATTERN = new RegExp(`@(${NUMBER}),(${NUMBER})`);

// Accepts "30.7235, -95.5508" (comma, space or both), a pair in brackets, a
// pair with degree signs or N/S/E/W letters, and the `@lat,lng` part of a maps
// link. The first number is the latitude. Returns `{ lat, lng }` (rounded) or
// null when the text is not a valid point.
export function parseCoordinates(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;

  const fromUrl = MAPS_URL_PATTERN.exec(value);
  if (fromUrl) return toPoint(Number(fromUrl[1]), Number(fromUrl[2]));

  const stripped = value.replace(/^[([{<]+|[)\]}>]+$/g, "").trim();
  const match = PAIR_PATTERN.exec(stripped);
  if (!match) return null;

  const first = signedNumber(match[1] || match[3], match[2]);
  const second = signedNumber(match[4] || match[6], match[5]);
  if (first === null || second === null) return null;
  const firstHemisphere = hemisphereOf(match[1] || match[3]);
  const secondHemisphere = hemisphereOf(match[4] || match[6]);

  // "95.5508 W, 30.7235 N": letters can put longitude first.
  if (firstHemisphere === "lng" || secondHemisphere === "lat") {
    if (firstHemisphere === "lat" || secondHemisphere === "lng") return null;
    return toPoint(second, first);
  }
  return toPoint(first, second);
}

function signedNumber(hemisphere, digits) {
  const number = Number(digits);
  if (!Number.isFinite(number)) return null;
  const letter = String(hemisphere || "").toUpperCase();
  if (letter === "S" || letter === "W") return -Math.abs(number);
  if (letter === "N" || letter === "E") return Math.abs(number);
  return number;
}

function hemisphereOf(letter) {
  const upper = String(letter || "").toUpperCase();
  if (upper === "N" || upper === "S") return "lat";
  if (upper === "E" || upper === "W") return "lng";
  return null;
}

function toPoint(lat, lng) {
  if (!isValidCoordinatePair(lat, lng)) return null;
  return { lat: roundCoordinate(lat), lng: roundCoordinate(lng) };
}
