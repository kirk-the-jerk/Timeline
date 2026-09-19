// Pure logic for the slideshow player: which slides play, in what order, and the
// numbers shown on the setup panel. No DOM access, so it can be tested in Node.
// See docs/players/slideshow.md.

import {
  canRenderImageMedia,
  formatDisplayRange,
  getEventCollections,
  getEventTitle,
  resolveEventImages
} from "./timeline.js";
import { getEventSpan } from "./timelineLayout.js";

export const MIN_DELAY_SECONDS = 1;
export const MAX_DELAY_SECONDS = 60;

export const DEFAULT_SLIDESHOW_SETTINGS = {
  details: true,
  autoAdvance: true,
  delay: 5,
  loop: false,
  fullscreen: true
};

// The slides, in order. Events keep the order they arrive in (chronological).
// Events with no renderable image are skipped. Before an event's first image
// comes a title card for each of its collections that hasn't had one yet.
//   { kind: "collection", collection }
//   { kind: "image", event, image, src, caption, first }
// `first` marks the first image of its event, which is the only one that shows
// the event's details.
export function buildSlides(timeline, events) {
  const slides = [];
  const introduced = new Set();

  for (const event of events) {
    const images = getRenderableImages(timeline, event);
    if (images.length === 0) continue;

    for (const collection of getEventCollections(timeline, event)) {
      if (introduced.has(collection.id)) continue;
      introduced.add(collection.id);
      slides.push({ kind: "collection", collection });
    }

    images.forEach((image, index) => {
      slides.push({
        kind: "image",
        event,
        image,
        src: image.kind === "embedded" ? image.media.dataUrl : image.url,
        caption: image.caption || "",
        first: index === 0
      });
    });
  }

  return slides;
}

function getRenderableImages(timeline, event) {
  return resolveEventImages(timeline, event)
    .filter((image) => image.kind === "link" || canRenderImageMedia(image.media));
}

// Numbers for the setup panel, from the slides that will play (not the whole
// timeline). `span` runs from the earliest start to the latest end, as the
// events' own date strings, or is null when no event has a usable date.
export function summarizeSlides(slides) {
  const imageSlides = slides.filter((slide) => slide.kind === "image");
  const events = [...new Set(imageSlides.map((slide) => slide.event))];
  const collectionCount = slides.filter((slide) => slide.kind === "collection").length;

  let first = null;
  let last = null;
  for (const event of events) {
    const span = getEventSpan(event);
    if (!span) continue;
    if (!first || span.start < first.span.start) first = { span, event };
    if (!last || span.end > last.span.end) last = { span, event };
  }

  return {
    photoCount: imageSlides.length,
    eventCount: events.length,
    collectionCount,
    span: first
      ? {
        startDate: first.event.timestamp.date,
        endDate: last.span.end > last.span.start ? last.event.endTimestamp.date : last.event.timestamp.date
      }
      : null
  };
}

// The text laid over an event's first image.
export function describeEvent(event) {
  return {
    title: getEventTitle(event),
    date: formatDisplayRange(event.timestamp, event.endTimestamp),
    location: event.location || ""
  };
}

export function clampDelay(value) {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds)) return DEFAULT_SLIDESHOW_SETTINGS.delay;
  return Math.min(MAX_DELAY_SECONDS, Math.max(MIN_DELAY_SECONDS, seconds));
}

// Anything stored or typed comes through here, so a bad value falls back to its
// default instead of breaking the player.
export function normalizeSlideshowSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const bool = (key) => (typeof source[key] === "boolean" ? source[key] : DEFAULT_SLIDESHOW_SETTINGS[key]);
  return {
    details: bool("details"),
    autoAdvance: bool("autoAdvance"),
    delay: source.delay === undefined ? DEFAULT_SLIDESHOW_SETTINGS.delay : clampDelay(source.delay),
    loop: bool("loop"),
    fullscreen: bool("fullscreen")
  };
}
