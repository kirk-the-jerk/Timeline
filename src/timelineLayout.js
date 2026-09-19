// Pure layout maths for the timeline player: turning event timestamps into a
// scale, axis ticks and non-overlapping lanes. No DOM access, so it can be
// tested directly in Node.
//
// Times are placed by their wall-clock date and time, read as UTC. Time zones
// are ignored here: the axis only has to order events and space them, and being
// a few hours out doesn't change where a bar sits at any scale worth drawing.

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30.4375 * DAY_MS;
const YEAR_MS = 365.25 * DAY_MS;

const TICK_STEPS = [
  ["hour", 1], ["hour", 3], ["hour", 6], ["hour", 12],
  ["day", 1], ["day", 2], ["day", 7],
  ["month", 1], ["month", 3], ["month", 6],
  ["year", 1], ["year", 2], ["year", 5], ["year", 10], ["year", 20],
  ["year", 50], ["year", 100], ["year", 200], ["year", 500], ["year", 1000]
];
const TICK_UNIT_MS = { hour: HOUR_MS, day: DAY_MS, month: MONTH_MS, year: YEAR_MS };

// Returns { start, end } in ms, or null when the event's start can't be placed.
// A missing, malformed or earlier end date leaves it a point event.
export function getEventSpan(event) {
  const start = parseTimestampMs(event?.timestamp);
  if (start === null) return null;
  const end = parseTimestampMs(event?.endTimestamp);
  return { start, end: end !== null && end > start ? end : start };
}

function parseTimestampMs(timestamp) {
  if (!timestamp || !/^\d{4}-\d{2}-\d{2}$/.test(timestamp.date)) return null;
  const time = /^\d{2}:\d{2}$/.test(timestamp.time) ? timestamp.time : "00:00";
  const ms = Date.parse(`${timestamp.date}T${time}:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

// The full extent of the spans, padded so events at the edges aren't flush with it.
export function getTimeDomain(spans) {
  if (spans.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const span of spans) {
    min = Math.min(min, span.start);
    max = Math.max(max, span.end);
  }
  const pad = max > min ? (max - min) * 0.03 : DAY_MS;
  return { min: min - pad, max: max + pad };
}

export function getWindowRange(domain, startPermille, endPermille) {
  const size = domain.max - domain.min;
  return {
    start: domain.min + (startPermille / 1000) * size,
    end: domain.min + (endPermille / 1000) * size
  };
}

export function spanOverlaps(span, range) {
  return span.end >= range.start && span.start <= range.end;
}

// Every word of the query must appear somewhere in the (lower-cased) haystack.
export function matchesSearch(haystack, query) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => haystack.includes(word));
}

// First-fit lane assignment. Items are { x0, x1 } fractions of the chart width,
// already sorted by x0. Returns a lane index per item and the number of lanes.
export function packLanes(items, gap = 0.004) {
  const laneEnds = [];
  const lanes = items.map((item) => {
    let lane = laneEnds.findIndex((end) => end + gap <= item.x0);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = item.x1;
    return lane;
  });
  return { lanes, laneCount: laneEnds.length };
}

// Round-numbered ticks (whole years, months, days or hours) with at most
// `maxTicks` across [min, max]. Each is { time, label }.
export function getTimeTicks(min, max, maxTicks = 8) {
  const span = max - min;
  const [unit, step] = TICK_STEPS.find(([tickUnit, tickStep]) => span / (TICK_UNIT_MS[tickUnit] * tickStep) <= maxTicks)
    || TICK_STEPS[TICK_STEPS.length - 1];
  const showYear = span > 300 * DAY_MS;
  const times = [];

  if (unit === "year") {
    const startYear = Math.floor(new Date(min).getUTCFullYear() / step) * step;
    for (let year = startYear; ; year += step) {
      const time = utcTime(year, 0, 1);
      if (time > max) break;
      if (time >= min) times.push(time);
    }
  } else if (unit === "month") {
    const first = new Date(min);
    const startIndex = Math.floor((first.getUTCFullYear() * 12 + first.getUTCMonth()) / step) * step;
    for (let index = startIndex; ; index += step) {
      const time = utcTime(Math.floor(index / 12), index % 12, 1);
      if (time > max) break;
      if (time >= min) times.push(time);
    }
  } else {
    const size = TICK_UNIT_MS[unit] * step;
    for (let time = Math.ceil(min / size) * size; time <= max; time += size) {
      times.push(time);
    }
  }

  return times.map((time) => ({ time, label: formatTickLabel(time, unit, showYear) }));
}

function utcTime(year, month, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date.getTime();
}

function formatTickLabel(time, unit, showYear) {
  const date = new Date(time);
  if (unit === "year") return String(date.getUTCFullYear());
  if (unit === "month") return formatUtc(date, { month: "short", year: "numeric" });
  if (unit === "day") return formatUtc(date, showYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
  return formatUtc(date, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

// A short label for one end of the visible window; adds the time of day when the
// window is only a few days wide.
export function formatWindowBound(time, rangeSize) {
  const date = new Date(time);
  return rangeSize < 3 * DAY_MS
    ? formatUtc(date, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    : formatUtc(date, { year: "numeric", month: "short", day: "numeric" });
}

function formatUtc(date, options) {
  return date.toLocaleString(undefined, { ...options, timeZone: "UTC" });
}
