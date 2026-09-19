import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  DEFAULT_MAP_SETTINGS,
  MAP_COLORS,
  SINGLE_POINT_ZOOM,
  buildPaths,
  buildScopes,
  buildSegments,
  describeMapEvent,
  dotLabel,
  effectiveArrows,
  effectiveNumbers,
  findScope,
  fitTarget,
  getLocatedEvents,
  getMapColor,
  groupDots,
  normalizeMapSettings,
  numberEvents,
  screenAngle,
  showsArrow,
  stepIndex,
  summarizeMap
} from "../src/mapModel.js";
import { FILE_PAGE_FALLBACK_ID, TILE_SOURCES, fallbackTileSource, getTileSource, normalizeTileSourceId } from "../src/mapTiles.js";
import { normalizeTimeline, sortEvents } from "../src/timeline.js";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const timeline = makeTimeline();
const events = sortEvents(timeline.events);
const located = getLocatedEvents(events);
const ids = (list) => list.map((event) => event.id);

checkLocatedAndScopes();
checkSummary();
checkDots();
checkPathsAndSegments();
checkNumbering();
checkArrows();
checkFit();
checkStepping();
checkSettings();
checkDetails();
checkColors();
checkTiles();
console.log("OK map");

function makeTimeline() {
  const at = (date) => ({ date, time: "00:00", tz: "UTC" });
  const geo = (lat, lng) => ({ lat, lng, source: "manual" });
  return normalizeTimeline({
    format: "local-timeline-poc",
    version: 10,
    title: "Map fixture",
    collections: [
      { id: "c-trip", kind: "collection", title: "Trip" },
      { id: "c-family", kind: "collection", title: "Family" },
      { id: "c-empty", kind: "collection", title: "No places" }
    ],
    media: [{
      id: "media-1", kind: "image", mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD", width: 960, height: 640
    }],
    events: [
      { id: "e1", type: "travel", title: "Lisbon", location: "Lisbon", geo: geo(38.7223, -9.1393), timestamp: at("2020-01-01"), collectionIds: ["c-trip"], images: [{ id: "i1", kind: "embedded", mediaId: "media-1", caption: "Tram" }, { id: "i2", kind: "link", url: "javascript:alert(1)" }], fields: [{ key: "notes", label: "Notes", value: "Rainy <b>" }] },
      { id: "e2", type: "life", title: "No place", timestamp: at("2020-02-01"), collectionIds: ["c-family"], images: [], fields: [] },
      { id: "e3", type: "travel", title: "Porto", geo: geo(41.1579, -8.6291), timestamp: at("2020-03-01"), collectionIds: ["c-family", "c-trip"], images: [], fields: [] },
      { id: "e4", type: "travel", title: "Porto again", geo: geo(41.1579, -8.6291), timestamp: at("2020-04-01"), endTimestamp: at("2020-04-09"), collectionIds: ["c-trip"], images: [], fields: [] },
      { id: "e5", type: "life", title: "Home", geo: geo(30.7235, -95.5508), timestamp: at("2020-05-01"), images: [], fields: [] },
      { id: "e6", type: "life", title: "Lisbon return", geo: geo(38.7223, -9.1393), timestamp: at("2020-06-01"), collectionIds: ["c-family"], images: [], fields: [] }
    ]
  });
}

function checkLocatedAndScopes() {
  assert.deepEqual(ids(located), ["e1", "e3", "e4", "e5", "e6"], "only events with coordinates");
  assert.deepEqual(getLocatedEvents([{ geo: { lat: 200, lng: 0 } }, { geo: null }, {}]), [], "invalid or missing geo is not located");

  const scopes = buildScopes(timeline, located);
  assert.deepEqual(scopes.map((scope) => [scope.id, scope.events.length]), [[null, 5], ["c-trip", 3], ["c-family", 2]],
    "All, then collections with a located event, in collection order; empty ones left out");
  assert.deepEqual(ids(scopes[1].events), ["e1", "e3", "e4"]);
  assert.equal(findScope(scopes, "c-family").title, "Family");
  assert.equal(findScope(scopes, "gone"), scopes[0], "an unknown scope is All events");
  assert.deepEqual(buildScopes({ collections: [] }, located).length, 1, "no collections, only All");
}

function checkSummary() {
  const summary = summarizeMap(timeline, events);
  assert.equal(summary.totalCount, 6);
  assert.equal(summary.locatedCount, 5);
  assert.equal(summary.collectionCount, 2);
  assert.deepEqual(summary.span, { startDate: "2020-01-01", endDate: "2020-06-01" });

  const none = summarizeMap(timeline, events.filter((event) => !event.geo));
  assert.equal(none.locatedCount, 0);
  assert.equal(none.span, null);
}

function checkDots() {
  const dots = groupDots(located);
  assert.deepEqual(dots.map((dot) => ids(dot.events)), [["e1", "e6"], ["e3", "e4"], ["e5"]],
    "equal coordinates share a dot, ordered by first event");
  assert.equal(groupDots([]).length, 0);

  const nearlyEqual = groupDots([
    { geo: { lat: 10.000001, lng: 20 } },
    { geo: { lat: 10.000004, lng: 20 } },
    { geo: { lat: 10.00002, lng: 20 } }
  ]);
  assert.deepEqual(nearlyEqual.map((dot) => dot.events.length), [2, 1], "equal to 5 decimals means the same place");
}

function checkPathsAndSegments() {
  const scopes = buildScopes(timeline, located);
  const [all, trip, family] = scopes;

  assert.deepEqual(buildPaths(scopes, all, "off"), [], "Lines off draws nothing in All");
  assert.deepEqual(buildPaths(scopes, all, "all").map((path) => ids(path.events)), [["e1", "e3", "e4", "e5", "e6"]]);
  assert.deepEqual(buildPaths(scopes, all, "collection").map((path) => [path.id, ids(path.events)]),
    [["c-trip", ["e1", "e3", "e4"]], ["c-family", ["e3", "e6"]]], "an event in two collections is on both paths");
  assert.deepEqual(buildPaths(scopes, trip, "off").map((path) => ids(path.events)), [["e1", "e3", "e4"]],
    "a single collection is always connected, whatever Lines says");
  assert.deepEqual(buildPaths(scopes, family, "all").map((path) => ids(path.events)), [["e3", "e6"]]);
  assert.deepEqual(buildPaths([all], { id: null, events: [located[0]] }, "all"), [], "one event has no path");

  const segments = buildSegments(trip.events);
  assert.equal(segments.length, 1, "consecutive events at the same place make no line");
  assert.deepEqual([segments[0].fromEvent.id, segments[0].toEvent.id], ["e1", "e3"]);
  assert.deepEqual(segments[0].to, { lat: 41.1579, lng: -8.6291 });
  assert.deepEqual(buildSegments([]), []);
}

function checkNumbering() {
  const scopes = buildScopes(timeline, located);
  const [all, trip] = scopes;

  const overall = numberEvents(buildPaths(scopes, all, "all"), all);
  assert.deepEqual(located.map((event) => overall.get(event)), [1, 2, 3, 4, 5], "one run over the whole timeline");

  const unpathed = numberEvents([], all);
  assert.deepEqual(located.map((event) => unpathed.get(event)), [1, 2, 3, 4, 5], "no lines still numbers in date order");

  const perCollection = numberEvents(buildPaths(scopes, all, "collection"), all);
  assert.equal(perCollection.get(located[0]), 1);
  assert.equal(perCollection.get(located[1]), 2, "Porto keeps its number from Trip, the first collection");
  assert.equal(perCollection.get(located[4]), 2, "Family restarts at 1, so Lisbon return is 2");
  assert.equal(perCollection.get(located[3]), undefined, "an event in no collection is not numbered");

  const tripNumbers = numberEvents(buildPaths(scopes, trip, "off"), trip);
  assert.deepEqual(trip.events.map((event) => tripNumbers.get(event)), [1, 2, 3]);

  const dots = groupDots(located);
  assert.equal(dotLabel(dots[0], overall), "1+", "a shared dot shows its lowest number with a plus");
  assert.equal(dotLabel(dots[2], overall), "4");
  assert.equal(dotLabel(dots[0], new Map()), "", "no numbers, no label");
}

function checkArrows() {
  assert.equal(screenAngle({ x: 0, y: 0 }, { x: 10, y: 0 }), 0, "east");
  assert.equal(screenAngle({ x: 0, y: 0 }, { x: 0, y: 10 }), 90, "screen y grows downward, so this points down");
  assert.equal(screenAngle({ x: 0, y: 0 }, { x: -10, y: 0 }), 180);
  assert.equal(screenAngle({ x: 0, y: 0 }, { x: 0, y: -10 }), -90);
  assert.equal(showsArrow({ x: 0, y: 0 }, { x: 23, y: 0 }), false, "a very short segment gets no arrow");
  assert.equal(showsArrow({ x: 0, y: 0 }, { x: 24, y: 0 }), true);
  assert.equal(showsArrow({ x: 0, y: 0 }, { x: 18, y: 18 }), true, "length is the straight-line distance");
}

function checkFit() {
  assert.equal(fitTarget([]), null);
  assert.deepEqual(fitTarget([{ lat: 1, lng: 2 }, { lat: 1, lng: 2 }]), { kind: "point", lat: 1, lng: 2, zoom: SINGLE_POINT_ZOOM });
  assert.deepEqual(fitTarget([{ lat: 10, lng: 20 }, { lat: -5, lng: 30 }, { lat: 3, lng: -40 }]),
    { kind: "bounds", south: -5, west: -40, north: 10, east: 30 });
  assert.equal(fitTarget([{ lat: 1, lng: 2 }, { lat: 1, lng: 3 }]).kind, "bounds", "two points on a line still fit as bounds");
}

function checkStepping() {
  assert.equal(stepIndex(-1, 3, 1), 0, "next from nothing selected starts at the first");
  assert.equal(stepIndex(-1, 3, -1), null, "previous from nothing goes nowhere");
  assert.equal(stepIndex(0, 3, 1), 1);
  assert.equal(stepIndex(2, 3, -1), 1);
  assert.equal(stepIndex(2, 3, 1), null, "the last event stops without Loop");
  assert.equal(stepIndex(0, 3, -1), null);
  assert.equal(stepIndex(2, 3, 1, true), 0, "Loop wraps forward");
  assert.equal(stepIndex(0, 3, -1, true), 2, "Loop wraps back");
  assert.equal(stepIndex(-1, 0, 1), null, "nothing to step through");
  assert.equal(stepIndex(0, 1, 1, true), 0, "a single event loops onto itself");
}

function checkSettings() {
  assert.deepEqual(normalizeMapSettings(null), DEFAULT_MAP_SETTINGS);
  assert.deepEqual(normalizeMapSettings("junk"), DEFAULT_MAP_SETTINGS);

  const settings = normalizeMapSettings({
    tileSource: "nope", lines: "sideways", arrows: "yes", numbers: false, openDetails: 0, leftPinned: true, rightPinned: "x"
  });
  assert.equal(settings.tileSource, "osm", "unknown tile source falls back");
  assert.equal(settings.color, "green", "unknown colour falls back to the default");
  assert.equal(normalizeMapSettings({ color: "yellow" }).color, "yellow");
  assert.equal(normalizeMapSettings({ color: "blue" }).color, "green", "blue is no longer offered");
  assert.equal(settings.lines, "off", "unknown lines mode falls back");
  assert.equal(settings.arrows, null, "a non-boolean is 'not chosen'");
  assert.equal(settings.numbers, false);
  assert.equal(settings.openDetails, true);
  assert.equal(settings.leftPinned, true);
  assert.equal(settings.rightPinned, false);
  assert.deepEqual(normalizeMapSettings({ lines: "collection", tileSource: "esri-imagery" }).lines, "collection");

  const scopes = buildScopes(timeline, located);
  assert.equal(effectiveNumbers(DEFAULT_MAP_SETTINGS, scopes[0]), false, "numbers default off in All events");
  assert.equal(effectiveNumbers(DEFAULT_MAP_SETTINGS, scopes[1]), true, "and on in a collection");
  assert.equal(effectiveNumbers({ ...DEFAULT_MAP_SETTINGS, numbers: false }, scopes[1]), false, "a choice applies to every scope");
  assert.equal(effectiveNumbers({ ...DEFAULT_MAP_SETTINGS, numbers: true }, scopes[0]), true);
  assert.equal(effectiveArrows(DEFAULT_MAP_SETTINGS), true);
  assert.equal(effectiveArrows({ ...DEFAULT_MAP_SETTINGS, arrows: false }), false);
}

function checkDetails() {
  const lisbon = describeMapEvent(timeline, located[0]);
  assert.equal(lisbon.title, "Lisbon");
  assert.equal(lisbon.coordinates, "38.7223, -9.1393");
  assert.deepEqual(lisbon.collections, ["Trip"]);
  assert.deepEqual(lisbon.fields, [{ label: "Notes", value: "Rainy <b>" }], "raw text, escaped by the view");
  assert.equal(lisbon.photos.length, 1, "the javascript: link is dropped");
  assert.equal(lisbon.photos[0].caption, "Tram");
  assert.ok(lisbon.photos[0].src.startsWith("data:image/jpeg;base64,"));
  assert.ok(lisbon.type);

  const range = describeMapEvent(timeline, located[2]);
  assert.ok(range.date.includes("–"), "a date range shows both ends");
  assert.equal(range.photos.length, 0);
}

function checkColors() {
  assert.equal(MAP_COLORS.length, 4, "four choices");
  assert.equal(MAP_COLORS[0].id, "green", "the current dark green stays first and is the default");
  assert.equal(MAP_COLORS[0].value, "#2f6f68");
  assert.equal(DEFAULT_MAP_SETTINGS.color, "green");
  assert.equal(new Set(MAP_COLORS.map((color) => color.value)).size, 4, "no two alike");
  assert.equal(getMapColor("nope").id, "green");
  assert.equal(getMapColor("red").value, MAP_COLORS[1].value);
  assert.deepEqual(MAP_COLORS.map((color) => color.id), ["green", "red", "yellow", "purple"]);
  const yellow = getMapColor("yellow");
  assert.notEqual(yellow.ink, "#ffffff", "text on yellow can't be white");
  assert.notEqual(yellow.edge, "#ffffff", "and a white outline would vanish against it on a light map");
  for (const color of MAP_COLORS) {
    for (const key of ["value", "ink", "edge", "strong"]) assert.match(color[key], /^#[0-9a-f]{6}$/i, `${color.id}.${key}`);
  }
}

function checkTiles() {
  assert.ok(TILE_SOURCES.length >= 5);
  assert.equal(new Set(TILE_SOURCES.map((source) => source.id)).size, TILE_SOURCES.length, "ids are unique");
  for (const source of TILE_SOURCES) {
    assert.ok(source.url.startsWith("https://"), `${source.id} uses https`);
    assert.ok(source.attribution, `${source.id} carries its attribution`);
    assert.ok(["street", "aerial", "styled"].includes(source.kind));
  }
  assert.equal(normalizeTileSourceId("nope"), "osm");
  assert.equal(normalizeTileSourceId("carto-voyager"), "osm", "a remembered choice that no longer exists falls back");
  assert.equal(getTileSource("esri-imagery").kind, "aerial");
  assert.equal(getTileSource("versatiles-satellite").tileSize, 512, "VersaTiles imagery is 512 pixel tiles");
  assert.equal(getTileSource("nasa-blue-marble").maxNativeZoom, 8, "GIBS Blue Marble has real tiles only to zoom 8");
  assert.ok(getTileSource("nasa-blue-marble").maxZoom > 8, "and is enlarged past that");
  assert.equal(getTileSource("opentopomap").maxZoom, 17, "OpenTopoMap has no tiles past zoom 17");
  assert.equal(getTileSource(undefined).id, "osm");

  // A page opened from disk sends no Referer, and OSM can refuse it.
  assert.equal(fallbackTileSource("osm", "file:")?.id, FILE_PAGE_FALLBACK_ID);
  assert.equal(fallbackTileSource("nope", "file:")?.id, FILE_PAGE_FALLBACK_ID, "an unknown id counts as the default, OSM");
  assert.equal(fallbackTileSource("osm", "https:"), null, "a served page sends a Referer");
  assert.equal(fallbackTileSource("esri-imagery", "file:"), null, "only OSM is switched away from");
  assert.equal(fallbackTileSource(FILE_PAGE_FALLBACK_ID, "file:"), null, "no loop");
  assert.notEqual(FILE_PAGE_FALLBACK_ID, "osm");
  assert.ok(TILE_SOURCES.some((source) => source.id === FILE_PAGE_FALLBACK_ID));
}
