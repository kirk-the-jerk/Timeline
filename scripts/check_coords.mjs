import assert from "node:assert/strict";
import {
  canAutoReplaceGeo,
  formatCoordinates,
  geoSource,
  normalizeGeo,
  parseCoordinates,
  roundCoordinate,
  sameGeo
} from "../src/coords.js";

function main() {
  checkRounding();
  checkNormalizeGeo();
  checkParsing();
  checkFormatting();
  checkSourceRules();
  console.log("OK coordinates");
}

function checkRounding() {
  assert.equal(roundCoordinate(30.123456789), 30.12346);
  assert.equal(roundCoordinate(-95.000004), -95);
  assert.equal(roundCoordinate(0), 0);
}

function checkNormalizeGeo() {
  assert.deepEqual(normalizeGeo({ lat: 1.5, lng: -2.5, source: "map" }), { lat: 1.5, lng: -2.5, source: "map" });
  assert.deepEqual(normalizeGeo({ lat: 1.5, lng: -2.5, source: "elsewhere" }), { lat: 1.5, lng: -2.5 });
  assert.deepEqual(normalizeGeo({ lat: 90, lng: 180 }), { lat: 90, lng: 180 });
  assert.deepEqual(normalizeGeo({ lat: -90, lng: -180 }), { lat: -90, lng: -180 });
  assert.deepEqual(normalizeGeo({ lat: 1, lng: 2, extra: true }), { lat: 1, lng: 2 }, "unknown keys are not kept");
  for (const bad of [null, undefined, "1,2", [], 5, {}, { lat: 1 }, { lat: 90.00001, lng: 0 }, { lat: 0, lng: -180.5 },
    { lat: "1", lng: "2" }, { lat: NaN, lng: 0 }, { lat: Infinity, lng: 0 }, { lat: null, lng: 0 }]) {
    assert.equal(normalizeGeo(bad), null, JSON.stringify(bad));
  }
}

function checkParsing() {
  const accepted = {
    "30.7235, -95.5508": [30.7235, -95.5508],
    "30.7235,-95.5508": [30.7235, -95.5508],
    "30.7235 -95.5508": [30.7235, -95.5508],
    "  30.7235 ,   -95.5508  ": [30.7235, -95.5508],
    "(30.7235, -95.5508)": [30.7235, -95.5508],
    "[30.7235, -95.5508]": [30.7235, -95.5508],
    "30.7235; -95.5508": [30.7235, -95.5508],
    "30.7235°, -95.5508°": [30.7235, -95.5508],
    "30.7235° N, 95.5508° W": [30.7235, -95.5508],
    "30.7235 N 95.5508 W": [30.7235, -95.5508],
    "N 30.7235, W 95.5508": [30.7235, -95.5508],
    "95.5508 W, 30.7235 N": [30.7235, -95.5508],
    "33.8688 S, 151.2093 E": [-33.8688, 151.2093],
    "0, 0": [0, 0],
    "+30.5, +95.5": [30.5, 95.5],
    "30, -95": [30, -95],
    ".5, -.5": [0.5, -0.5],
    "30.123456789, -95.987654321": [30.12346, -95.98765],
    "https://www.google.com/maps/@30.7235,-95.5508,12z": [30.7235, -95.5508],
    "https://maps.example.com/place/Huntsville/@30.7235,-95.5508,10z/data=x": [30.7235, -95.5508]
  };
  for (const [text, [lat, lng]] of Object.entries(accepted)) {
    assert.deepEqual(parseCoordinates(text), { lat, lng }, text);
  }

  for (const bad of ["", "   ", null, undefined, "Huntsville TX", "30.7235", "30.7235,", ",-95.5508", "91, 0", "0, 181", "-91, 0",
    "1, 2, 3", "abc, def", "30.7235 N, 95.5508 N", "30.7235 W, 95.5508 W", "1e2, 3", "30..5, 2", "--1, 2"]) {
    assert.equal(parseCoordinates(bad), null, JSON.stringify(bad));
  }
}

function checkFormatting() {
  assert.equal(formatCoordinates({ lat: 30.7235, lng: -95.5508, source: "map" }), "30.7235, -95.5508");
  assert.equal(formatCoordinates({ lat: 30, lng: -95 }), "30, -95");
  assert.equal(formatCoordinates(null), "");
  const point = { lat: 12.34567, lng: -76.54321 };
  assert.deepEqual(parseCoordinates(formatCoordinates(point)), point, "format and parse round-trip");
}

function checkSourceRules() {
  assert.equal(geoSource({ lat: 1, lng: 2, source: "search" }), "search");
  assert.equal(geoSource({ lat: 1, lng: 2 }), "manual", "missing counts as manual");
  assert.equal(geoSource({ lat: 1, lng: 2, source: "guess" }), "manual", "unknown counts as manual");
  assert.equal(geoSource(null), "manual");

  // A lookup may replace coordinates only when there are none or they came from a lookup.
  assert.equal(canAutoReplaceGeo(null), true);
  assert.equal(canAutoReplaceGeo(undefined), true);
  assert.equal(canAutoReplaceGeo({ lat: 1, lng: 2, source: "search" }), true);
  assert.equal(canAutoReplaceGeo({ lat: 1, lng: 2, source: "map" }), false);
  assert.equal(canAutoReplaceGeo({ lat: 1, lng: 2, source: "manual" }), false);
  assert.equal(canAutoReplaceGeo({ lat: 1, lng: 2 }), false, "missing source is protected");
  assert.equal(canAutoReplaceGeo({ lat: 1, lng: 2, source: "guess" }), false, "unknown source is protected");

  assert.equal(sameGeo({ lat: 1, lng: 2, source: "map" }, { lat: 1, lng: 2 }), true, "source is not part of the point");
  assert.equal(sameGeo({ lat: 1, lng: 2 }, { lat: 1, lng: 3 }), false);
  assert.equal(sameGeo(null, undefined), true);
  assert.equal(sameGeo({ lat: 1, lng: 2 }, null), false);
}

main();
