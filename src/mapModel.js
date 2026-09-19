// Pure logic for the map player: which events have a place, the scopes, shared
// dots, lines, numbering, arrows, fitting and stepping. No DOM and no Leaflet, so
// it can be tested in Node. See docs/players/map.md.

import { formatCoordinates, isValidCoordinatePair, roundCoordinate } from "./coords.js";
import {
  canRenderImageMedia,
  formatDisplayRange,
  getEventCollections,
  getEventTitle,
  getEventTypeDisplay,
  resolveEventImages
} from "./timeline.js";
import { getEventSpan } from "./timelineLayout.js";
import { DEFAULT_TILE_SOURCE_ID, normalizeTileSourceId } from "./mapTiles.js";

export const LINE_MODES = ["off", "collection", "all"];
export const SINGLE_POINT_ZOOM = 12;
export const FIT_MAX_ZOOM = 16;
export const MIN_ARROW_PIXELS = 24;

// The colours a viewer can give the dots, lines and arrows, four that differ in
// hue. `ink` is the text on a dot, `edge` is the outline round dots, lines and
// arrows, and `strong` is a darker shade of the colour for text on white.
export const MAP_COLORS = [
  { id: "green", label: "Green", value: "#2f6f68", ink: "#ffffff", edge: "#ffffff", strong: "#2f6f68" },
  { id: "red", label: "Red", value: "#d13a1c", ink: "#ffffff", edge: "#ffffff", strong: "#d13a1c" },
  { id: "yellow", label: "Yellow", value: "#f2c200", ink: "#222222", edge: "#3a3000", strong: "#7a5c00" },
  { id: "purple", label: "Purple", value: "#8e2bb5", ink: "#ffffff", edge: "#ffffff", strong: "#8e2bb5" }
];
export const DEFAULT_MAP_COLOR_ID = "green";

export function normalizeMapColorId(value) {
  return MAP_COLORS.some((color) => color.id === value) ? value : DEFAULT_MAP_COLOR_ID;
}

export function getMapColor(id) {
  return MAP_COLORS.find((color) => color.id === normalizeMapColorId(id));
}

export const DEFAULT_MAP_SETTINGS = {
  tileSource: DEFAULT_TILE_SOURCE_ID,
  color: DEFAULT_MAP_COLOR_ID,
  lines: "off",
  // null means "the default for this scope" (see effectiveArrows and effectiveNumbers).
  arrows: null,
  numbers: null,
  openDetails: true,
  leftPinned: false,
  rightPinned: false
};

// Events that have coordinates, in the order they arrive (chronological).
export function getLocatedEvents(events) {
  return events.filter((event) => hasLocation(event));
}

function hasLocation(event) {
  return Boolean(event?.geo) && isValidCoordinatePair(event.geo.lat, event.geo.lng);
}

// The scopes a viewer can pick: All events, then each collection that has at
// least one located event, in `timeline.collections` order. `id` is null for All.
export function buildScopes(timeline, located) {
  const scopes = [{ id: null, title: "All events", events: located }];
  for (const collection of Array.isArray(timeline?.collections) ? timeline.collections : []) {
    const inCollection = located.filter((event) => Array.isArray(event.collectionIds) && event.collectionIds.includes(collection.id));
    if (inCollection.length > 0) scopes.push({ id: collection.id, title: collection.title, events: inCollection });
  }
  return scopes;
}

export function findScope(scopes, id) {
  return scopes.find((scope) => scope.id === id) ?? scopes[0];
}

// Numbers for the launcher panel: how many events can be shown, how many
// collections have one, and the date span of the located events.
export function summarizeMap(timeline, events) {
  const located = getLocatedEvents(events);
  const collectionCount = buildScopes(timeline, located).length - 1;

  let first = null;
  let last = null;
  for (const event of located) {
    const span = getEventSpan(event);
    if (!span) continue;
    if (!first || span.start < first.span.start) first = { span, event };
    if (!last || span.end > last.span.end) last = { span, event };
  }

  return {
    totalCount: events.length,
    locatedCount: located.length,
    collectionCount,
    span: first
      ? {
        startDate: first.event.timestamp.date,
        endDate: last.span.end > last.span.start ? last.event.endTimestamp.date : last.event.timestamp.date
      }
      : null
  };
}

export function dotKey(geo) {
  return `${roundCoordinate(geo.lat)},${roundCoordinate(geo.lng)}`;
}

// One dot per place. Events at equal coordinates (to 5 decimals) share a dot;
// the dots come out in the order their first event appears.
export function groupDots(events) {
  const byKey = new Map();
  for (const event of events) {
    const key = dotKey(event.geo);
    if (!byKey.has(key)) byKey.set(key, { key, lat: roundCoordinate(event.geo.lat), lng: roundCoordinate(event.geo.lng), events: [] });
    byKey.get(key).events.push(event);
  }
  return [...byKey.values()];
}

// The ordered event lists to join with lines. A single collection is always one
// path. In All events it depends on the Lines setting: none, one path per
// collection (an event in two collections is on both), or one path through all.
// Each is { id, events }.
export function buildPaths(scopes, scope, lines) {
  if (scope.id !== null) return scope.events.length > 1 ? [{ id: scope.id, events: scope.events }] : [];
  if (lines === "all") return scope.events.length > 1 ? [{ id: null, events: scope.events }] : [];
  if (lines === "collection") {
    return scopes.filter((item) => item.id !== null && item.events.length > 1).map((item) => ({ id: item.id, events: item.events }));
  }
  return [];
}

// Consecutive events at the same place make no line. Returns
// [{ from, to, fromEvent, toEvent }] with from and to as { lat, lng }.
export function buildSegments(pathEvents) {
  const segments = [];
  for (let index = 1; index < pathEvents.length; index += 1) {
    const fromEvent = pathEvents[index - 1];
    const toEvent = pathEvents[index];
    if (dotKey(fromEvent.geo) === dotKey(toEvent.geo)) continue;
    segments.push({
      from: { lat: fromEvent.geo.lat, lng: fromEvent.geo.lng },
      to: { lat: toEvent.geo.lat, lng: toEvent.geo.lng },
      fromEvent,
      toEvent
    });
  }
  return segments;
}

// Position in the sequence for each event (a Map from event to 1, 2, 3...).
// Along a path the count runs over its events. In "per collection" each path
// restarts at 1, and an event already numbered keeps the number from the path
// that came first. Without paths (Lines off in All events) the whole scope is
// numbered in date order.
export function numberEvents(paths, scope) {
  const numbers = new Map();
  const sequences = paths.length > 0 ? paths.map((path) => path.events) : [scope.events];
  for (const sequence of sequences) {
    sequence.forEach((event, index) => {
      if (!numbers.has(event)) numbers.set(event, index + 1);
    });
  }
  return numbers;
}

// "3" for a lone dot; "3+" when the dot is shared. Empty when nothing numbered it.
export function dotLabel(dot, numbers) {
  const values = dot.events.map((event) => numbers.get(event)).filter((value) => value !== undefined);
  if (values.length === 0) return "";
  return `${Math.min(...values)}${dot.events.length > 1 ? "+" : ""}`;
}

// The angle in degrees, clockwise from pointing right, of the line from
// screen point a to screen point b (y grows downward).
export function screenAngle(a, b) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

export function screenLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function showsArrow(a, b, minPixels = MIN_ARROW_PIXELS) {
  return screenLength(a, b) >= minPixels;
}

// Where to put the camera for these points: null (nothing), a single point at
// a fixed zoom, or the bounding box.
export function fitTarget(points) {
  if (points.length === 0) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const point of points) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
  }
  if (south === north && west === east) return { kind: "point", lat: south, lng: west, zoom: SINGLE_POINT_ZOOM };
  return { kind: "bounds", south, west, north, east };
}

// The next index when stepping through `count` events. `index` is -1 when
// nothing is selected. Returns null when there is nowhere to go: at an end
// without Loop, or with nothing to step through. Stepping back from nothing
// selected goes nowhere.
export function stepIndex(index, count, direction, loop = false) {
  if (count === 0) return null;
  if (index < 0) return direction > 0 ? 0 : null;
  const next = index + (direction > 0 ? 1 : -1);
  if (next >= 0 && next < count) return next;
  if (!loop) return null;
  return direction > 0 ? 0 : count - 1;
}

// Arrows and numbers have no stored value until the viewer changes them. Then
// the default depends on the scope: a collection shows both, All events shows
// arrows (they only appear on lines) and no numbers.
export function effectiveArrows(settings) {
  return settings.arrows ?? true;
}

export function effectiveNumbers(settings, scope) {
  return settings.numbers ?? scope.id !== null;
}

// Anything stored comes through here, so a bad value falls back to its default.
export function normalizeMapSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const bool = (key) => (typeof source[key] === "boolean" ? source[key] : DEFAULT_MAP_SETTINGS[key]);
  const tri = (key) => (typeof source[key] === "boolean" ? source[key] : null);
  return {
    tileSource: normalizeTileSourceId(source.tileSource),
    color: normalizeMapColorId(source.color),
    lines: LINE_MODES.includes(source.lines) ? source.lines : DEFAULT_MAP_SETTINGS.lines,
    arrows: tri("arrows"),
    numbers: tri("numbers"),
    openDetails: bool("openDetails"),
    leftPinned: bool("leftPinned"),
    rightPinned: bool("rightPinned")
  };
}

// The renderable photos of an event: { src, caption, kind }.
export function getEventPhotos(timeline, event) {
  return resolveEventImages(timeline, event)
    .filter((image) => image.kind === "link" || canRenderImageMedia(image.media))
    .map((image) => ({
      src: image.kind === "embedded" ? image.media.dataUrl : image.url,
      caption: image.caption || "",
      kind: image.kind
    }));
}

// Everything the details panel shows for one event, as plain text and lists.
export function describeMapEvent(timeline, event) {
  return {
    title: getEventTitle(event),
    date: formatDisplayRange(event.timestamp, event.endTimestamp),
    location: event.location || "",
    coordinates: formatCoordinates(event.geo),
    type: getEventTypeDisplay(event.type, timeline),
    collections: getEventCollections(timeline, event).map((collection) => collection.title),
    fields: (Array.isArray(event.fields) ? event.fields : [])
      .filter((field) => field.value)
      .map((field) => ({ label: field.label, value: field.value })),
    photos: getEventPhotos(timeline, event)
  };
}
