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
  assert.equal(diagnostics.length, 0);
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
  assert.equal(timeline.events.find((event) => event.title === "Odd timestamp and fields").type, "life");
  assertCodesInclude(diagnostics, [
    "invalid-media-dropped",
    "malformed-event-replaced",
    "invalid-fields-dropped",
    "ignored-legacy-event-images",
    "migrated-v3-schema",
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
