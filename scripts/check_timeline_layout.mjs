import assert from "node:assert/strict";
import {
  getEventSpan,
  getTimeDomain,
  getTimeTicks,
  getWindowRange,
  matchesSearch,
  packLanes,
  spanOverlaps
} from "../src/timelineLayout.js";

const at = (date, time = "00:00") => ({ date, time, tz: "UTC" });
const ms = (date, time = "00:00") => Date.parse(`${date}T${time}:00Z`);

function main() {
  checkSpans();
  checkDomainAndWindow();
  checkLanes();
  checkTicks();
  checkSearch();
  console.log("OK timeline layout");
}

function checkSpans() {
  const point = getEventSpan({ timestamp: at("2020-05-01", "09:30") });
  assert.deepEqual(point, { start: ms("2020-05-01", "09:30"), end: ms("2020-05-01", "09:30") });

  const range = getEventSpan({ timestamp: at("2020-01-01"), endTimestamp: at("2020-03-01") });
  assert.equal(range.end, ms("2020-03-01"));

  const backwards = getEventSpan({ timestamp: at("2020-03-01"), endTimestamp: at("2020-01-01") });
  assert.equal(backwards.end, backwards.start, "an end before the start leaves a point event");

  assert.equal(getEventSpan({ timestamp: at("not a date") }), null, "unplaceable dates give no span");
  assert.equal(getEventSpan({ timestamp: at("2020-13-45") }), null, "impossible dates give no span");
  assert.equal(getEventSpan({}), null);
}

function checkDomainAndWindow() {
  assert.equal(getTimeDomain([]), null);

  const domain = getTimeDomain([
    { start: ms("2020-01-01"), end: ms("2020-01-01") },
    { start: ms("2021-01-01"), end: ms("2022-01-01") }
  ]);
  assert.ok(domain.min < ms("2020-01-01") && domain.max > ms("2022-01-01"), "domain is padded");

  const single = getTimeDomain([{ start: ms("2020-01-01"), end: ms("2020-01-01") }]);
  assert.ok(single.max > single.min, "a single moment still gets a non-empty domain");

  assert.deepEqual(getWindowRange(domain, 0, 1000), { start: domain.min, end: domain.max });
  const half = getWindowRange(domain, 500, 1000);
  assert.equal(half.start, domain.min + (domain.max - domain.min) / 2);

  const span = { start: 10, end: 20 };
  assert.ok(spanOverlaps(span, { start: 15, end: 30 }), "overlapping window");
  assert.ok(spanOverlaps(span, { start: 0, end: 10 }), "touching counts as overlap");
  assert.ok(spanOverlaps(span, { start: 12, end: 14 }), "window inside the span");
  assert.ok(!spanOverlaps(span, { start: 21, end: 30 }), "disjoint window");
}

function checkLanes() {
  const { lanes, laneCount } = packLanes([
    { x0: 0, x1: 0.3 },
    { x0: 0.1, x1: 0.2 },
    { x0: 0.31, x1: 0.5 },
    { x0: 0.6, x1: 0.7 }
  ]);
  assert.deepEqual(lanes, [0, 1, 0, 0]);
  assert.equal(laneCount, 2);

  assert.equal(packLanes([]).laneCount, 0);

  const touching = packLanes([{ x0: 0, x1: 0.5 }, { x0: 0.5, x1: 0.9 }]);
  assert.equal(touching.laneCount, 2, "items closer than the gap don't share a lane");
}

function checkTicks() {
  const years = getTimeTicks(ms("2015-06-01"), ms("2021-06-01"));
  assert.deepEqual(years.map((tick) => tick.label), ["2016", "2017", "2018", "2019", "2020", "2021"]);
  assert.ok(years.every((tick) => tick.time >= ms("2015-06-01") && tick.time <= ms("2021-06-01")), "ticks stay in range");

  const decades = getTimeTicks(ms("1950-01-01"), ms("2020-01-01"));
  assert.ok(decades.every((tick) => Number(tick.label) % 10 === 0), "a long span uses round-numbered years");
  assert.ok(decades.length <= 8);

  const months = getTimeTicks(ms("2020-01-10"), ms("2020-06-20"));
  assert.equal(months.length, 5, "Feb to Jun");
  assert.ok(months.every((tick) => new Date(tick.time).getUTCDate() === 1), "month ticks fall on the 1st");

  const days = getTimeTicks(ms("2020-03-01"), ms("2020-03-06"));
  assert.ok(days.length >= 3 && days.length <= 8);
  assert.ok(days.every((tick) => tick.time % 86400000 === 0), "day ticks fall on midnight");

  const hours = getTimeTicks(ms("2020-03-01", "09:10"), ms("2020-03-01", "15:50"));
  assert.ok(hours.length >= 3 && hours.length <= 8);

  assert.ok(getTimeTicks(ms("2020-01-01"), ms("2020-01-01", "00:01")).length <= 8, "a tiny span doesn't loop forever");
  assert.ok(getTimeTicks(ms("0100-01-01"), ms("2500-01-01")).length <= 8, "a huge span stays bounded");
}

function checkSearch() {
  const haystack = "japan trip 2020 kyoto travel";
  assert.ok(matchesSearch(haystack, ""), "an empty query matches everything");
  assert.ok(matchesSearch(haystack, "   "));
  assert.ok(matchesSearch(haystack, "KYOTO"), "case-insensitive");
  assert.ok(matchesSearch(haystack, "trip japan"), "every word must appear, in any order");
  assert.ok(!matchesSearch(haystack, "japan paris"));
}

main();
