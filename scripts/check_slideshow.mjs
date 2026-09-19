import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createChromeState } from "../src/slideshowChrome.js";
import {
  DEFAULT_SLIDESHOW_SETTINGS,
  buildSlides,
  clampDelay,
  describeEvent,
  normalizeSlideshowSettings,
  summarizeSlides
} from "../src/slideshowModel.js";
import { normalizeTimeline, sortEvents } from "../src/timeline.js";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

checkSlideList();
checkSummary();
checkEventDetails();
checkSettings();
checkChromeStateMachine();
console.log("OK slideshow");

function makeTimeline() {
  const at = (date) => ({ date, time: "00:00", tz: "UTC" });
  return normalizeTimeline({
    format: "local-timeline-poc",
    version: 9,
    title: "Slideshow fixture",
    collections: [
      { id: "c-trip", kind: "collection", title: "Trip" },
      { id: "c-family", kind: "collection", title: "Family" }
    ],
    media: [{
      id: "media-1",
      kind: "image",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD",
      width: 960,
      height: 640
    }],
    events: [
      {
        id: "e1", type: "travel", title: "Arrived", location: "Lisbon", timestamp: at("2020-01-01"), collectionIds: ["c-trip"],
        images: [
          { id: "i1", kind: "embedded", mediaId: "media-1", caption: "First light" },
          { id: "i2", kind: "link", url: "https://example.com/2.jpg" }
        ],
        fields: []
      },
      { id: "e2", type: "life", title: "No photos", timestamp: at("2020-02-01"), collectionIds: ["c-family"], images: [], fields: [] },
      {
        id: "e3", type: "life", title: "Reunion", timestamp: at("2020-03-01"), collectionIds: ["c-family", "c-trip"],
        images: [{ id: "i3", kind: "link", url: "https://example.com/3.jpg", caption: "Everyone" }],
        fields: []
      },
      {
        id: "e4", type: "life", title: "Bad link", timestamp: at("2020-04-01"),
        images: [{ id: "i4", kind: "link", url: "javascript:alert(1)" }],
        fields: []
      },
      {
        id: "e5", type: "travel", title: "Long stay", timestamp: at("2020-05-01"), endTimestamp: at("2020-06-01"),
        images: [{ id: "i5", kind: "link", url: "https://example.com/5.jpg" }],
        fields: []
      }
    ]
  });
}

function checkSlideList() {
  const timeline = makeTimeline();
  const slides = buildSlides(timeline, sortEvents(timeline.events));
  const shape = slides.map((slide) => (slide.kind === "collection"
    ? `card:${slide.collection.title}`
    : `${slide.event.id}${slide.first ? "*" : ""}`));

  assert.deepEqual(
    shape,
    ["card:Trip", "e1*", "e1", "card:Family", "e3*", "e5*"],
    "chronological, a title card the first time each collection appears, events without a usable image skipped"
  );

  const embedded = slides.find((slide) => slide.image?.id === "i1");
  assert.equal(embedded.src, "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD");
  assert.equal(embedded.caption, "First light");
  assert.equal(slides.find((slide) => slide.image?.id === "i2").src, "https://example.com/2.jpg");

  assert.deepEqual(buildSlides(timeline, []), [], "no events, no slides");
}

function checkSummary() {
  const timeline = makeTimeline();
  const slides = buildSlides(timeline, sortEvents(timeline.events));
  assert.deepEqual(summarizeSlides(slides), {
    photoCount: 4,
    eventCount: 3,
    collectionCount: 2,
    span: { startDate: "2020-01-01", endDate: "2020-06-01" }
  }, "counts and span describe what will play, and the span reaches the end of a range");

  assert.deepEqual(summarizeSlides([]), { photoCount: 0, eventCount: 0, collectionCount: 0, span: null });

  const undated = {
    ...timeline.events[0],
    id: "undated",
    timestamp: { date: "someday", time: "", tz: "UTC" },
    images: [{ id: "u", kind: "link", url: "https://example.com/u.jpg" }],
    collectionIds: []
  };
  const summary = summarizeSlides(buildSlides(timeline, [undated]));
  assert.equal(summary.photoCount, 1);
  assert.equal(summary.span, null, "events without a usable date don't make a span");
}

function checkEventDetails() {
  const timeline = makeTimeline();
  const info = describeEvent(timeline.events.find((event) => event.id === "e1"));
  assert.equal(info.title, "Arrived");
  assert.equal(info.location, "Lisbon");
  assert.ok(info.date.length > 0, "a date is shown");
  assert.equal(describeEvent(timeline.events.find((event) => event.id === "e3")).location, "");
}

function checkSettings() {
  assert.deepEqual(normalizeSlideshowSettings(null), DEFAULT_SLIDESHOW_SETTINGS);
  assert.deepEqual(normalizeSlideshowSettings("nonsense"), DEFAULT_SLIDESHOW_SETTINGS);
  assert.deepEqual(
    normalizeSlideshowSettings({ details: false, autoAdvance: false, delay: "9", loop: true, fullscreen: false }),
    { details: false, autoAdvance: false, delay: 9, loop: true, fullscreen: false }
  );
  assert.equal(normalizeSlideshowSettings({ details: "yes", loop: 1 }).details, true, "non-booleans fall back");
  assert.equal(normalizeSlideshowSettings({ delay: 0 }).delay, 1);
  assert.equal(normalizeSlideshowSettings({ delay: 500 }).delay, 60);
  assert.equal(clampDelay("abc"), DEFAULT_SLIDESHOW_SETTINGS.delay);
  assert.equal(clampDelay(2.6), 3);
}

function checkChromeStateMachine() {
  let time = 0;
  const chrome = createChromeState({ now: () => time });

  let state = chrome.update();
  assert.equal(state.buttonVisible, true, "the reveal button shows while paused");
  assert.equal(state.cursorHidden, false, "the cursor stays while paused");
  assert.equal(chrome.nextChangeIn(), null, "nothing changes by itself while paused");

  chrome.setPaused(false);
  state = chrome.update();
  assert.equal(state.buttonVisible, false, "the button hides while playing");
  assert.equal(state.cursorHidden, true);

  chrome.pointerMoved();
  state = chrome.update();
  assert.equal(state.buttonVisible, true, "moving the mouse shows the button");
  assert.equal(state.cursorHidden, false);
  assert.equal(chrome.nextChangeIn(), 1000);

  time = 999;
  assert.equal(chrome.update().buttonVisible, true);
  time = 1000;
  state = chrome.update();
  assert.equal(state.buttonVisible, false, "the button hides 1s after the mouse stops");
  assert.equal(state.cursorHidden, false, "the cursor hides later");
  assert.equal(chrome.nextChangeIn(), 1000);
  time = 2000;
  assert.equal(chrome.update().cursorHidden, true, "the cursor hides after 2s");
  assert.equal(chrome.nextChangeIn(), null);

  chrome.openBar();
  state = chrome.update();
  assert.equal(state.barOpen, true);
  assert.equal(state.buttonVisible, false, "the button gives way to the bar");
  assert.equal(state.cursorHidden, false);
  assert.equal(chrome.nextChangeIn(), 2000);
  time = 3999;
  assert.equal(chrome.update().barOpen, true, "the bar stays for 2s with the pointer away");
  time = 4000;
  assert.equal(chrome.update().barOpen, false, "then closes");

  chrome.openBar();
  chrome.barLeft();
  assert.equal(chrome.nextChangeIn(), 2000, "leaving a bar the pointer never entered doesn't restart the clock");
  chrome.openBar({ pointerInside: true });
  assert.equal(chrome.nextChangeIn(), null, "opened under the pointer, it stays until the pointer leaves");
  chrome.barEntered();
  time = 60000;
  assert.equal(chrome.update().barOpen, true, "the bar stays open while the pointer is on it");
  assert.equal(chrome.nextChangeIn(), null);
  chrome.barLeft();
  assert.equal(chrome.nextChangeIn(), 2000);
  time = 61999;
  assert.equal(chrome.update().barOpen, true);
  time = 62000;
  assert.equal(chrome.update().barOpen, false, "and closes 2s after the pointer leaves");

  chrome.setPaused(true);
  time = 999999;
  assert.equal(chrome.update().buttonVisible, true, "paused: the button stays however still the mouse is");
  chrome.toggleBar();
  assert.equal(chrome.update().barOpen, true);
  chrome.toggleBar();
  assert.equal(chrome.update().barOpen, false);
}
