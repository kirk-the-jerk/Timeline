import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIMELINE_VERSION,
  normalizeTimelineWithDiagnostics
} from "../src/timeline.js";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE_DIR = join(ROOT, "tests", "fixtures", "schema");

function main() {
  checkV1Legacy();
  checkV2EmbeddedImage();
  checkV4ImageGallery();
  checkFutureVersion();
  checkMalformedRecoverable();
  checkCustomEventTypes();
  checkCollections();
  checkLegacyEventTypeAliases();
  checkLegacyJobEventTypeAlias();
  console.log("OK schema fixtures");
}

function checkV1Legacy() {
  const { timeline, diagnostics } = normalizeFixture("v1-legacy.timeline.json");
  assert.equal(timeline.version, TIMELINE_VERSION);
  assert.equal(timeline.title, "Legacy v1 timeline");
  assert.equal(timeline.events.length, 1);
  assert.equal(timeline.events[0].title, "Started the archive");
  assert.equal(timeline.events[0].timestamp.date, "2020-01-02");
  assert.equal(timeline.events[0].fields[0].type, "text");
  assertCodesInclude(diagnostics, [
    "missing-format",
    "missing-version",
    "migrated-v1-name",
    "migrated-v1-timestamp",
    "migrated-v1-schema",
    "migrated-v2-schema",
    "migrated-v3-schema",
    "migrated-v4-schema",
    "migrated-v5-schema",
    "migrated-v6-schema",
    "migrated-v7-schema",
    "default-time",
    "default-time-zone",
    "generated-event-id",
    "default-field-type"
  ]);
}

function checkV2EmbeddedImage() {
  const { timeline, diagnostics } = normalizeFixture("v2-embedded-image.timeline.json");
  assert.equal(timeline.version, TIMELINE_VERSION);
  assert.equal(timeline.events.length, 1);
  assert.equal(timeline.media.length, 0);
  assert.deepEqual(timeline.events[0].images, []);
  assert.equal(timeline.events[0].image, undefined);
  assertCodesInclude(diagnostics, [
    "migrated-v2-schema",
    "migrated-v3-schema",
    "migrated-v4-schema",
    "migrated-v5-schema",
    "migrated-v6-schema",
    "migrated-v7-schema",
    "ignored-legacy-event-images"
  ]);
}

function checkV4ImageGallery() {
  const { timeline, diagnostics } = normalizeFixture("v4-image-gallery.timeline.json");
  assert.equal(timeline.version, TIMELINE_VERSION);
  assert.equal(timeline.events.length, 1);
  assert.equal(timeline.media.length, 1);
  assert.equal(timeline.events[0].images.length, 2);
  assert.equal(timeline.events[0].images[0].kind, "embedded");
  assert.equal(timeline.events[0].images[0].mediaId, "media-1");
  assert.equal(timeline.events[0].images[1].kind, "link");
  assert.equal(timeline.events[0].images[1].url, "https://example.com/photo.jpg");
  assertCodesInclude(diagnostics, ["migrated-v4-schema", "migrated-v5-schema", "migrated-v6-schema", "migrated-v7-schema"]);
}

function checkFutureVersion() {
  const { timeline, diagnostics } = normalizeFixture("future-version.timeline.json");
  assert.equal(timeline.version, TIMELINE_VERSION);
  assert.deepEqual(timeline.futureTimelineField, { mode: "future" });
  assert.equal(timeline.events[0].futureEventField, "preserve me");
  assertCodesInclude(diagnostics, ["future-schema-version"]);
}

function checkMalformedRecoverable() {
  const { timeline, diagnostics } = normalizeFixture("malformed-recoverable.timeline.json");
  assert.equal(timeline.version, TIMELINE_VERSION);
  assert.equal(timeline.events.length, 3);
  assert.equal(timeline.media.length, 0);
  assert.equal(new Set(timeline.events.map((event) => event.id)).size, 3);
  assert.equal(timeline.events.find((event) => event.title === "Odd timestamp and fields").type, "misc");
  assertCodesInclude(diagnostics, [
    "invalid-media-dropped",
    "malformed-event-replaced",
    "invalid-fields-dropped",
    "ignored-legacy-event-images",
    "migrated-v3-schema",
    "migrated-v4-schema",
    "migrated-v5-schema",
    "migrated-v6-schema",
    "migrated-v7-schema",
    "duplicate-event-id",
    "unknown-event-type",
    "non-iso-date",
    "non-standard-time",
    "malformed-field-dropped",
    "empty-field-dropped",
    "stringified-field-value"
  ]);
  assertHasLevels(diagnostics, ["warning", "error"]);
}

function checkCustomEventTypes() {
  const { timeline, diagnostics } = normalizeTimelineWithDiagnostics({
    format: "local-timeline-poc",
    version: TIMELINE_VERSION,
    title: "Custom event type timeline",
    updatedAt: "2026-06-25T00:00:00.000Z",
    eventTypes: [
      { value: "conference", label: "Conference", emoji: "🎤", custom: true }
    ],
    events: [
      {
        id: "event-1",
        type: "conference",
        title: "Spoke at JSConf",
        timestamp: {
          date: "2026-06-25",
          time: "09:00",
          tz: "UTC"
        }
      },
      {
        id: "event-2",
        type: "mystery",
        title: "Unknown type",
        timestamp: {
          date: "2026-06-26",
          time: "09:00",
          tz: "UTC"
        }
      }
    ]
  });

  assert.equal(timeline.version, TIMELINE_VERSION);
  assert.equal(timeline.eventTypes[0].value, "misc");
  assert.ok(timeline.eventTypes.some((eventType) => eventType.value === "conference" && eventType.emoji === "🎤"));
  assert.equal(timeline.events.find((event) => event.title === "Spoke at JSConf").type, "conference");
  assert.equal(timeline.events.find((event) => event.title === "Unknown type").type, "misc");
  assertCodesInclude(diagnostics, ["unknown-event-type"]);
}

function checkCollections() {
  const { timeline } = normalizeTimelineWithDiagnostics({
    format: "local-timeline-poc",
    version: TIMELINE_VERSION,
    title: "Collection timeline",
    updatedAt: "2026-06-25T00:00:00.000Z",
    collections: [
      { id: "collection-1", kind: "trip", title: "Japan 2026" },
      { id: "unused", title: "Unused" }
    ],
    events: [
      {
        id: "event-1",
        type: "travel",
        title: "Flight to Tokyo",
        timestamp: {
          date: "2026-04-10",
          time: "09:00",
          tz: "UTC"
        },
        collectionIds: ["collection-1"]
      }
    ]
  });

  assert.equal(timeline.version, TIMELINE_VERSION);
  assert.equal(timeline.collections.length, 1);
  assert.equal(timeline.collections[0].title, "Japan 2026");
  assert.deepEqual(timeline.events[0].collectionIds, ["collection-1"]);
}

function checkLegacyEventTypeAliases() {
  const { timeline, diagnostics } = normalizeTimelineWithDiagnostics({
    format: "local-timeline-poc",
    version: 6,
    title: "Legacy event types",
    updatedAt: "2026-06-25T00:00:00.000Z",
    eventTypes: [
      { value: "move", label: "Move", emoji: "📦" },
      { value: "education", label: "Education", emoji: "🎓" }
    ],
    events: [
      {
        id: "event-1",
        type: "move",
        title: "Moved apartments",
        timestamp: {
          date: "2026-05-01",
          time: "09:00",
          tz: "UTC"
        }
      },
      {
        id: "event-2",
        type: "education",
        title: "Started a class",
        timestamp: {
          date: "2026-05-02",
          time: "09:00",
          tz: "UTC"
        }
      }
    ]
  });

  assert.equal(timeline.version, TIMELINE_VERSION);
  assert.ok(timeline.eventTypes.some((eventType) => eventType.value === "home" && eventType.label === "Home"));
  assert.ok(timeline.eventTypes.some((eventType) => eventType.value === "school" && eventType.label === "School"));
  assert.ok(!timeline.eventTypes.some((eventType) => eventType.value === "move"));
  assert.ok(!timeline.eventTypes.some((eventType) => eventType.value === "education"));
  assert.equal(timeline.events.find((event) => event.title === "Moved apartments").type, "home");
  assert.equal(timeline.events.find((event) => event.title === "Started a class").type, "school");
  assertCodesInclude(diagnostics, ["migrated-v6-schema", "migrated-v7-schema"]);
}

function checkLegacyJobEventTypeAlias() {
  const { timeline, diagnostics } = normalizeTimelineWithDiagnostics({
    format: "local-timeline-poc",
    version: 7,
    title: "Legacy job event type",
    updatedAt: "2026-06-25T00:00:00.000Z",
    eventTypes: [
      { value: "job", label: "Job", emoji: "💼" }
    ],
    events: [
      {
        id: "event-1",
        type: "job",
        title: "Started a new role",
        timestamp: {
          date: "2026-05-01",
          time: "09:00",
          tz: "UTC"
        }
      }
    ]
  });

  assert.equal(timeline.version, TIMELINE_VERSION);
  assert.ok(timeline.eventTypes.some((eventType) => eventType.value === "work" && eventType.label === "Work"));
  assert.ok(timeline.eventTypes.some((eventType) => eventType.value === "health" && eventType.label === "Health"));
  assert.ok(!timeline.eventTypes.some((eventType) => eventType.value === "job"));
  assert.equal(timeline.events[0].type, "work");
  assertCodesInclude(diagnostics, ["migrated-v7-schema"]);
}

function normalizeFixture(name) {
  const data = JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));
  return normalizeTimelineWithDiagnostics(data);
}

function assertCodesInclude(diagnostics, expectedCodes) {
  const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
  for (const code of expectedCodes) {
    assert.ok(codes.has(code), `Expected diagnostic code ${code}`);
  }
}

function assertHasLevels(diagnostics, expectedLevels) {
  const levels = new Set(diagnostics.map((diagnostic) => diagnostic.level));
  for (const level of expectedLevels) {
    assert.ok(levels.has(level), `Expected diagnostic level ${level}`);
  }
}

main();
