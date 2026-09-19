export const TIMELINE_FORMAT = "local-timeline-poc";
export const TIMELINE_VERSION = 9;
export const DEFAULT_EVENT_TYPE = "misc";

export const EVENT_TYPES = [
  { value: "misc", label: "Misc", emoji: "📌" },
  { value: "life", label: "Life", emoji: "✨" },
  { value: "family", label: "Family", emoji: "👨‍👩‍👧‍👦" },
  { value: "friends", label: "Friends", emoji: "🤝" },
  { value: "health", label: "Health", emoji: "🩺" },
  { value: "home", label: "Home", emoji: "🏠" },
  { value: "school", label: "School", emoji: "🎓" },
  { value: "travel", label: "Travel", emoji: "✈️" },
  { value: "work", label: "Work", emoji: "💼" }
];

const V7_EVENT_TYPE_ALIASES = {
  education: "school",
  move: "home"
};

const V8_EVENT_TYPE_ALIASES = {
  job: "work"
};

const EVENT_TYPE_ALIASES = {
  ...V7_EVENT_TYPE_ALIASES,
  ...V8_EVENT_TYPE_ALIASES
};

export const FIELD_PRESETS = [
  { key: "summary", label: "Summary", type: "text" },
  { key: "people", label: "People", type: "text" },
  { key: "organization", label: "Organization", type: "text" },
  { key: "role", label: "Role", type: "text" },
  { key: "project", label: "Project", type: "text" },
  { key: "url", label: "URL", type: "url" },
  { key: "notes", label: "Notes", type: "text" }
];

export const COMMON_TIME_ZONES = [
  "UTC",
  "America/Vancouver",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney"
];

export function createEmptyTimeline() {
  return {
    format: TIMELINE_FORMAT,
    version: TIMELINE_VERSION,
    title: "Untitled timeline",
    updatedAt: new Date().toISOString(),
    eventTypes: cloneEventTypes(EVENT_TYPES),
    collections: [],
    media: [],
    events: []
  };
}

export function createEvent({ type, title, date, time, tz, endDate, endTime, location, images, fields, collectionIds, eventTypes, collections }) {
  const timestamp = normalizeTimestamp({ date, time, tz });
  const endTimestamp = cleanText(endDate)
    ? normalizeEndTimestamp({ date: endDate, time: endTime, tz: timestamp.tz }, timestamp)
    : null;
  return {
    id: crypto.randomUUID(),
    type: normalizeEventType(type, eventTypes),
    title: cleanText(title) || "Untitled event",
    timestamp,
    ...(endTimestamp ? { endTimestamp } : {}),
    location: cleanText(location),
    images: normalizeEventImages(images),
    fields: normalizeFields(fields),
    collectionIds: normalizeEventCollectionIds(collectionIds, collections)
  };
}

export function createImageMedia(image) {
  return normalizeMedia(image);
}

export function sortEvents(events) {
  return [...events].sort((a, b) => {
    const aTimestamp = timestampSortValue(a.timestamp);
    const bTimestamp = timestampSortValue(b.timestamp);
    const timestampCompare = aTimestamp.localeCompare(bTimestamp);
    if (timestampCompare !== 0) return timestampCompare;
    return getEventTitle(a).localeCompare(getEventTitle(b));
  });
}

export function normalizeTimeline(input) {
  return normalizeTimelineWithDiagnostics(input).timeline;
}

export function normalizeTimelineWithDiagnostics(input) {
  const diagnostics = [];

  if (!input || typeof input !== "object") {
    throwSchemaError(diagnostics, "not-timeline-object", "The selected file does not contain a timeline object.", "$");
  }
  if (input.format && input.format !== TIMELINE_FORMAT) {
    throwSchemaError(diagnostics, "unsupported-format", `Unsupported timeline format: ${input.format}`, "$.format");
  }

  const migratedInput = migrateTimelineInput(input, diagnostics);
  const inputEvents = getEventInputs(migratedInput, diagnostics);
  const usedEventTypes = new Set(inputEvents.map((event) => getRawEventType(event)));
  const hiddenEventTypes = normalizeHiddenEventTypes(migratedInput.hiddenEventTypes, usedEventTypes, diagnostics, "$.hiddenEventTypes");
  const eventTypes = normalizeEventTypes(migratedInput.eventTypes, diagnostics, "$.eventTypes", hiddenEventTypes);
  const collections = normalizeCollections(migratedInput.collections, diagnostics, "$.collections");
  const mediaById = new Map();

  if (Array.isArray(migratedInput.media)) {
    migratedInput.media.forEach((item, index) => {
      const media = normalizeMedia(item, diagnostics, `$.media[${index}]`);
      if (!media) return;
      if (mediaById.has(media.id)) {
        addDiagnostic(diagnostics, "error", "duplicate-media-id", `Duplicate media id ${media.id}; the later media item was kept.`, `$.media[${index}].id`);
      }
      mediaById.set(media.id, media);
    });
  } else if (migratedInput.media !== undefined) {
    addDiagnostic(diagnostics, "error", "invalid-media-array", "Ignored media because it was not an array.", "$.media");
  }

  const usedEventIds = new Set();
  const events = inputEvents.map((event, index) => {
    const normalizedEvent = normalizeEvent(event, mediaById, eventTypes, collections, diagnostics, `$.events[${index}]`);
    if (usedEventIds.has(normalizedEvent.id)) {
      const originalId = normalizedEvent.id;
      normalizedEvent.id = crypto.randomUUID();
      addDiagnostic(diagnostics, "error", "duplicate-event-id", `Duplicate event id ${originalId}; assigned a new id.`, `$.events[${index}].id`);
    }
    usedEventIds.add(normalizedEvent.id);
    return normalizedEvent;
  });

  const usedMediaIds = new Set();
  for (const event of events) {
    for (const image of event.images) {
      if (image.kind === "embedded") usedMediaIds.add(image.mediaId);
    }
  }

  const normalized = {
    ...pickUnknown(migratedInput, TIMELINE_KEYS),
    format: TIMELINE_FORMAT,
    version: TIMELINE_VERSION,
    title: normalizeTimelineTitle(migratedInput.title, diagnostics),
    updatedAt: normalizeUpdatedAt(migratedInput.updatedAt, diagnostics),
    eventTypes,
    ...(hiddenEventTypes.length > 0 ? { hiddenEventTypes } : {}),
    collections: pruneUnusedCollections(collections, events),
    media: [...usedMediaIds].map((id) => mediaById.get(id)).filter(Boolean),
    events: sortEvents(events)
  };

  attachSchemaDiagnostics(normalized, diagnostics);
  return { timeline: normalized, diagnostics };
}

export async function readTimelineFile(file) {
  const text = await file.text();
  return normalizeTimeline(JSON.parse(text));
}

export function downloadTimeline(timeline) {
  const safeTimeline = normalizeTimeline({
    ...timeline,
    updatedAt: new Date().toISOString()
  });
  const blob = new Blob([JSON.stringify(safeTimeline, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${formatTimelineDownloadBaseName(safeTimeline.title)}.timeline.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Display text leaves out the time zone, and the time when it is midnight
// (which is also what an event with no time set defaults to).
export function formatDisplayTimestamp(timestamp) {
  const safeTimestamp = normalizeTimestamp(timestamp || {});
  if (!safeTimestamp.date) return "No date";
  return formatDisplayDateTime(safeTimestamp.date, safeTimestamp.time);
}

function formatDisplayDateTime(date, time) {
  return time && time !== "00:00" ? `${formatDisplayDate(date)} ${time}` : formatDisplayDate(date);
}

export function formatDisplayRange(timestamp, endTimestamp) {
  if (!endTimestamp?.date) return formatDisplayTimestamp(timestamp);
  const start = normalizeTimestamp(timestamp || {});
  const end = {
    date: cleanText(endTimestamp.date),
    time: cleanText(endTimestamp.time) || "00:00",
    tz: cleanText(endTimestamp.tz) || start.tz
  };
  if (end.date === start.date && end.time === start.time && end.tz === start.tz) {
    return formatDisplayTimestamp(start);
  }
  const startText = formatDisplayDateTime(start.date, start.time);
  const endText = end.date === start.date && end.tz === start.tz && end.time !== "00:00"
    ? end.time
    : formatDisplayDateTime(end.date, end.time);
  return `${startText} – ${endText}`;
}

export function formatDisplayDate(date) {
  if (!date) return "No date";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function getEventTitle(event) {
  return cleanText(event?.title || event?.name) || "Untitled event";
}

export function getEventTypes(timeline) {
  const hidden = normalizeHiddenEventTypes(timeline?.hiddenEventTypes);
  return normalizeEventTypes(timeline?.eventTypes, [], "$.eventTypes", hidden);
}

// The built-in types missing from `eventTypes`, as a hiddenEventTypes value.
export function getHiddenEventTypes(eventTypes) {
  const present = new Set(eventTypes.map((eventType) => eventType.value));
  return EVENT_TYPES
    .map((eventType) => eventType.value)
    .filter((value) => value !== DEFAULT_EVENT_TYPE && !present.has(value));
}

export function getCollections(timeline) {
  return normalizeCollections(timeline?.collections);
}

export function createCollection({ title, kind = "collection" }) {
  const safeTitle = cleanText(title) || "Untitled collection";
  return normalizeCollection({
    id: crypto.randomUUID(),
    kind,
    title: safeTitle
  });
}

export function getEventCollections(timeline, event) {
  const collectionIds = new Set(normalizeEventCollectionIds(event?.collectionIds, getCollections(timeline)));
  return getCollections(timeline).filter((collection) => collectionIds.has(collection.id));
}

export function getEventType(type, timeline) {
  const safeType = cleanText(type).toLowerCase();
  const eventTypes = getEventTypes(timeline);
  return eventTypes.find((eventType) => eventType.value === safeType)
    || eventTypes.find((eventType) => eventType.value === DEFAULT_EVENT_TYPE)
    || EVENT_TYPES[0];
}

export function getEventTypeLabel(type, timeline) {
  return getEventType(type, timeline).label;
}

export function getEventTypeEmoji(type, timeline) {
  return getEventType(type, timeline).emoji;
}

export function getEventTypeDisplay(type, timeline) {
  const eventType = getEventType(type, timeline);
  return eventType.emoji ? `${eventType.emoji} ${eventType.label}` : eventType.label;
}

export function getEventTimeZone(event) {
  return cleanText(event?.timestamp?.tz || event?.tz);
}

export function resolveEventImages(timeline, event) {
  const mediaById = new Map((Array.isArray(timeline?.media) ? timeline.media : [])
    .map((item) => [item.id, item]));
  return (Array.isArray(event?.images) ? event.images : [])
    .map((image) => {
      if (image?.kind === "embedded") {
        const media = mediaById.get(image.mediaId);
        if (!media) return null;
        return {
          ...image,
          media
        };
      }
      if (image?.kind === "link" && isSafeHttpUrl(image.url)) {
        return image;
      }
      return null;
    })
    .filter(Boolean);
}

export function canRenderImageMedia(media) {
  return media?.kind === "image"
    && media?.mimeType === "image/jpeg"
    && cleanText(media.dataUrl).startsWith("data:image/jpeg;base64,");
}

export function getTimelineSchemaWarnings(timeline) {
  return getTimelineSchemaDiagnostics(timeline)
    .filter((diagnostic) => diagnostic.level === "warning")
    .map((diagnostic) => diagnostic.message);
}

export function getTimelineSchemaDiagnostics(timeline) {
  if (Array.isArray(timeline?.schemaDiagnostics)) return timeline.schemaDiagnostics;
  if (Array.isArray(timeline?.schemaWarnings)) {
    return timeline.schemaWarnings.map((message) => ({
      level: "warning",
      code: "legacy-warning",
      message
    }));
  }
  return [];
}

export function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function getAvailableTimeZones() {
  let zones = COMMON_TIME_ZONES;
  try {
    zones = typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : COMMON_TIME_ZONES;
  } catch {
    zones = COMMON_TIME_ZONES;
  }
  return unique([getBrowserTimeZone(), ...COMMON_TIME_ZONES, ...zones]);
}

export function getFieldPreset(key) {
  return FIELD_PRESETS.find((field) => field.key === key);
}

export function makeFieldFromPreset(key) {
  const preset = getFieldPreset(key);
  if (!preset) return null;
  return createField({
    key: preset.key,
    label: preset.label,
    type: preset.type,
    value: ""
  });
}

export function createCustomField(label) {
  const safeLabel = cleanText(label) || "Custom field";
  return createField({
    key: slugify(safeLabel),
    label: safeLabel,
    type: "text",
    value: ""
  });
}

export function createCustomEventType({ label, emoji }) {
  const safeLabel = cleanText(label) || "Custom";
  return {
    value: slugify(safeLabel),
    label: safeLabel,
    emoji: normalizeEmoji(emoji) || "🏷️",
    custom: true
  };
}

function normalizeEvent(event, mediaById, eventTypes, collections, diagnostics, path) {
  if (!event || typeof event !== "object") {
    addDiagnostic(diagnostics, "error", "malformed-event-replaced", "Replaced malformed event with an untitled placeholder event.", path);
    event = {};
  }

  if (event.timestamp && typeof event.timestamp !== "object") {
    addDiagnostic(diagnostics, "error", "invalid-timestamp-dropped", "Ignored timestamp because it was not an object.", `${path}.timestamp`);
  }

  const timestamp = event.timestamp && typeof event.timestamp === "object"
    ? normalizeTimestamp(event.timestamp, diagnostics, `${path}.timestamp`)
    : normalizeTimestamp({
      date: event.date,
      time: event.time,
      tz: event.tz
    }, diagnostics, path);
  const endTimestamp = normalizeEndTimestamp(event.endTimestamp, timestamp, diagnostics, `${path}.endTimestamp`);
  const id = cleanText(event.id);
  if (!id) {
    addDiagnostic(diagnostics, "warning", "generated-event-id", "Event was missing an id; assigned a new id.", `${path}.id`);
  }

  return {
    ...pickUnknown(event, EVENT_KEYS),
    id: id || crypto.randomUUID(),
    type: normalizeEventType(event.type, eventTypes, diagnostics, `${path}.type`),
    title: getEventTitle(event),
    timestamp,
    ...(endTimestamp ? { endTimestamp } : {}),
    location: cleanText(event.location),
    images: normalizeEventImages(event.images, mediaById, diagnostics, `${path}.images`),
    fields: normalizeFields(event.fields, diagnostics, `${path}.fields`),
    collectionIds: normalizeEventCollectionIds(event.collectionIds, collections, diagnostics, `${path}.collectionIds`)
  };
}

function normalizeCollections(collections, diagnostics = [], path = "$.collections") {
  if (collections === undefined) return [];
  if (!Array.isArray(collections)) {
    addDiagnostic(diagnostics, "error", "invalid-collections-array", "Ignored collections because they were not an array.", path);
    return [];
  }

  const usedIds = new Set();
  return collections
    .map((collection, index) => normalizeCollection(collection, diagnostics, `${path}[${index}]`))
    .filter(Boolean)
    .map((collection, index) => {
      if (!usedIds.has(collection.id)) {
        usedIds.add(collection.id);
        return collection;
      }
      const originalId = collection.id;
      const id = crypto.randomUUID();
      usedIds.add(id);
      addDiagnostic(diagnostics, "error", "duplicate-collection-id", `Duplicate collection id ${originalId}; assigned a new id.`, `${path}[${index}].id`);
      return {
        ...collection,
        id
      };
    });
}

function normalizeCollection(collection, diagnostics = [], path = "$.collections[]") {
  if (!collection || typeof collection !== "object") {
    addDiagnostic(diagnostics, "error", "malformed-collection-dropped", "Ignored malformed collection.", path);
    return null;
  }

  const id = cleanText(collection.id);
  const title = cleanText(collection.title || collection.name);
  if (!id && !title) {
    addDiagnostic(diagnostics, "error", "invalid-collection-dropped", "Ignored collection without an id or title.", path);
    return null;
  }
  if (!id) {
    addDiagnostic(diagnostics, "warning", "generated-collection-id", "Collection was missing an id; assigned a new id.", `${path}.id`);
  }

  return {
    ...pickUnknown(collection, COLLECTION_KEYS),
    id: id || crypto.randomUUID(),
    kind: cleanText(collection.kind) || "collection",
    title: title || "Untitled collection"
  };
}

function normalizeEventCollectionIds(collectionIds, collections = [], diagnostics = [], path = "$.collectionIds") {
  if (collectionIds === undefined) return [];
  const input = Array.isArray(collectionIds) ? collectionIds : [collectionIds];
  if (!Array.isArray(collectionIds)) {
    addDiagnostic(diagnostics, "warning", "coerced-event-collection-id", "Event collection id was not an array; loaded it as a single collection id.", path);
  }
  const collectionIdSet = new Set((collections || []).map((collection) => collection.id));
  const normalized = unique(input.map(cleanText));
  return normalized.filter((id, index) => {
    if (!id) return false;
    if (collectionIdSet.size > 0 && !collectionIdSet.has(id)) {
      addDiagnostic(diagnostics, "warning", "unknown-event-collection", `Ignored event collection ${id} because it was not found.`, `${path}[${index}]`);
      return false;
    }
    return true;
  });
}

function pruneUnusedCollections(collections, events) {
  const usedIds = new Set((events || []).flatMap((event) => event.collectionIds || []));
  return collections.filter((collection) => usedIds.has(collection.id));
}

function normalizeEventImages(images, mediaById = null, diagnostics = [], path = "$.images") {
  if (images === undefined) return [];
  if (!Array.isArray(images)) {
    addDiagnostic(diagnostics, "error", "invalid-images-array", "Ignored event images because they were not an array.", path);
    return [];
  }

  return images
    .map((image, index) => normalizeEventImage(image, mediaById, diagnostics, `${path}[${index}]`))
    .filter(Boolean);
}

function normalizeEventImage(image, mediaById, diagnostics, path) {
  if (!image || typeof image !== "object") {
    addDiagnostic(diagnostics, "error", "malformed-image-gallery-item-dropped", "Ignored malformed image gallery item.", path);
    return null;
  }

  let kind = cleanText(image.kind).toLowerCase();
  if (!kind) {
    if (cleanText(image.mediaId)) kind = "embedded";
    if (cleanText(image.url)) kind = "link";
    if (kind) {
      addDiagnostic(diagnostics, "warning", "inferred-image-gallery-kind", "Image gallery item was missing kind; inferred it from the available fields.", `${path}.kind`);
    }
  }

  const id = cleanText(image.id) || crypto.randomUUID();
  if (!cleanText(image.id)) {
    addDiagnostic(diagnostics, "warning", "generated-image-gallery-id", "Image gallery item was missing an id; assigned a new id.", `${path}.id`);
  }

  if (kind === "embedded") {
    const mediaId = cleanText(image.mediaId);
    if (!mediaId || (mediaById && !mediaById.has(mediaId))) {
      addDiagnostic(diagnostics, "error", "missing-gallery-media-reference", `Ignored gallery image because media ${mediaId || "(missing)"} was not found.`, `${path}.mediaId`);
      return null;
    }
    return {
      ...pickUnknown(image, IMAGE_ITEM_KEYS),
      id,
      kind,
      mediaId,
      caption: cleanText(image.caption)
    };
  }

  if (kind === "link") {
    const url = cleanText(image.url);
    if (!isSafeHttpUrl(url)) {
      addDiagnostic(diagnostics, "error", "invalid-gallery-image-url", "Ignored linked gallery image because the URL was not http or https.", `${path}.url`);
      return null;
    }
    return {
      ...pickUnknown(image, IMAGE_ITEM_KEYS),
      id,
      kind,
      url,
      caption: cleanText(image.caption)
    };
  }

  addDiagnostic(diagnostics, "error", "unknown-gallery-image-kind", `Ignored gallery image with unsupported kind ${kind || "(missing)"}.`, `${path}.kind`);
  return null;
}

function normalizeMedia(image, diagnostics = [], path = "$.media[]") {
  if (!image || typeof image !== "object") {
    addDiagnostic(diagnostics, "error", "malformed-media-dropped", "Ignored malformed media item.", path);
    return null;
  }

  const dataUrl = cleanText(image.dataUrl);
  const kind = cleanText(image.kind) || "image";
  const mimeType = cleanText(image.mimeType) || (dataUrl.startsWith("data:image/jpeg;base64,") ? "image/jpeg" : "");

  if (!cleanText(image.id) && !dataUrl && !cleanText(image.path)) {
    addDiagnostic(diagnostics, "error", "invalid-media-dropped", "Ignored media item without an id, dataUrl, or path.", path);
    return null;
  }

  if (!cleanText(image.id)) {
    addDiagnostic(diagnostics, "warning", "generated-media-id", "Media item was missing an id; assigned a new id.", `${path}.id`);
  }
  if (!cleanText(image.kind)) {
    addDiagnostic(diagnostics, "warning", "default-media-kind", "Media item was missing kind; defaulted to image.", `${path}.kind`);
  }
  if (dataUrl && !cleanText(image.mimeType)) {
    addDiagnostic(diagnostics, "warning", "inferred-media-mime-type", "Media item was missing mimeType; inferred it from the data URL when possible.", `${path}.mimeType`);
  }
  if (kind === "image" && dataUrl && !dataUrl.startsWith("data:image/jpeg;base64,")) {
    addDiagnostic(diagnostics, "warning", "unrenderable-image-media", "Preserved image media that this app cannot render because it was not a JPEG data URL.", path);
  }

  return {
    ...pickUnknown(image, MEDIA_KEYS),
    id: cleanText(image.id) || crypto.randomUUID(),
    kind,
    mimeType,
    dataUrl,
    path: cleanText(image.path),
    width: Number(image.width || 0),
    height: Number(image.height || 0),
    originalName: cleanText(image.originalName),
    encodedAt: cleanText(image.encodedAt) || new Date().toISOString()
  };
}

function normalizeTimestamp(timestamp, diagnostics = [], path = "$.timestamp") {
  const date = cleanText(timestamp.date);
  const time = cleanText(timestamp.time);
  const tz = cleanText(timestamp.tz);

  if (!date) {
    addDiagnostic(diagnostics, "warning", "default-date", "Timestamp was missing date; defaulted to today's date.", `${path}.date`);
  } else if (!isIsoDate(date)) {
    addDiagnostic(diagnostics, "warning", "non-iso-date", "Timestamp date is not YYYY-MM-DD; preserved the original value.", `${path}.date`);
  }

  if (!time) {
    addDiagnostic(diagnostics, "warning", "default-time", "Timestamp was missing time; defaulted to 00:00.", `${path}.time`);
  } else if (!isClockTime(time)) {
    addDiagnostic(diagnostics, "warning", "non-standard-time", "Timestamp time is not HH:MM; preserved the original value.", `${path}.time`);
  }

  if (!tz) {
    addDiagnostic(diagnostics, "warning", "default-time-zone", "Timestamp was missing time zone; defaulted to the browser time zone.", `${path}.tz`);
  }

  return {
    date: date || today(),
    time: time || "00:00",
    tz: tz || getBrowserTimeZone()
  };
}

function normalizeEndTimestamp(endTimestamp, startTimestamp, diagnostics = [], path = "$.endTimestamp") {
  if (endTimestamp === undefined || endTimestamp === null) return null;
  if (typeof endTimestamp !== "object") {
    addDiagnostic(diagnostics, "warning", "invalid-end-timestamp-dropped", "Ignored end timestamp because it was not an object.", path);
    return null;
  }

  const date = cleanText(endTimestamp.date);
  const time = cleanText(endTimestamp.time);
  const tz = cleanText(endTimestamp.tz);

  if (!date) {
    addDiagnostic(diagnostics, "warning", "end-timestamp-missing-date", "Ignored end timestamp because it was missing a date.", `${path}.date`);
    return null;
  }
  if (!isIsoDate(date)) {
    addDiagnostic(diagnostics, "warning", "non-iso-end-date", "End timestamp date is not YYYY-MM-DD; preserved the original value.", `${path}.date`);
  }
  if (time && !isClockTime(time)) {
    addDiagnostic(diagnostics, "warning", "non-standard-end-time", "End timestamp time is not HH:MM; preserved the original value.", `${path}.time`);
  }

  const normalized = {
    date,
    time: time || "00:00",
    tz: tz || startTimestamp.tz
  };
  if (isEndBeforeStart(startTimestamp, normalized)) {
    addDiagnostic(diagnostics, "warning", "end-before-start", "Ignored end timestamp because it was earlier than the start.", path);
    return null;
  }
  return normalized;
}

// Only comparable when both sides are well-formed and share a time zone.
export function isEndBeforeStart(start, end) {
  if (!start || !end) return false;
  if (!isIsoDate(start.date) || !isIsoDate(end.date)) return false;
  if (!isClockTime(start.time) || !isClockTime(end.time)) return false;
  if (start.tz !== end.tz) return false;
  return `${end.date}T${end.time}` < `${start.date}T${start.time}`;
}

function normalizeFields(fields, diagnostics = [], path = "$.fields") {
  if (fields === undefined) return [];
  if (!Array.isArray(fields)) {
    addDiagnostic(diagnostics, "error", "invalid-fields-dropped", "Ignored fields because they were not an array.", path);
    return [];
  }

  return fields
    .map((field, index) => {
      if (!field || typeof field !== "object") {
        addDiagnostic(diagnostics, "error", "malformed-field-dropped", "Ignored malformed field.", `${path}[${index}]`);
        return null;
      }

      const normalized = createField(field);
      if (!normalized.label && !normalized.value) {
        addDiagnostic(diagnostics, "warning", "empty-field-dropped", "Ignored empty field with no label or value.", `${path}[${index}]`);
        return null;
      }
      if (!cleanText(field.id)) {
        addDiagnostic(diagnostics, "warning", "generated-field-id", "Field was missing an id; assigned a new id.", `${path}[${index}].id`);
      }
      if (!cleanText(field.type)) {
        addDiagnostic(diagnostics, "warning", "default-field-type", "Field was missing type; defaulted to text.", `${path}[${index}].type`);
      }
      if (isComplexValue(field.value)) {
        addDiagnostic(diagnostics, "warning", "stringified-field-value", "Field value was not plain text; converted it to text.", `${path}[${index}].value`);
      }
      return normalized;
    })
    .filter(Boolean);
}

function createField(field) {
  const { id, key, label, type, value } = field;
  const safeLabel = cleanText(label || key);
  return {
    ...pickUnknown(field, FIELD_KEYS),
    id: cleanText(id) || crypto.randomUUID(),
    key: cleanText(key) || slugify(safeLabel),
    label: safeLabel,
    type: cleanText(type) || "text",
    value: cleanText(value)
  };
}

function normalizeEventType(type, eventTypes = EVENT_TYPES, diagnostics = [], path = "$.type") {
  const rawType = cleanText(type).toLowerCase();
  const safeType = EVENT_TYPE_ALIASES[rawType] || rawType;
  if (!safeType) {
    addDiagnostic(diagnostics, "warning", "default-event-type", "Event was missing type; defaulted to misc.", path);
    return DEFAULT_EVENT_TYPE;
  }
  if (!isEventTypeValue(safeType)) {
    addDiagnostic(diagnostics, "warning", "invalid-event-type", `Event type ${safeType} was not a valid slug; defaulted to misc.`, path);
    return DEFAULT_EVENT_TYPE;
  }
  if (!eventTypes.some((eventType) => eventType.value === safeType)) {
    addDiagnostic(diagnostics, "warning", "unknown-event-type", `Unknown event type ${safeType}; defaulted to misc.`, path);
    return DEFAULT_EVENT_TYPE;
  }
  return safeType;
}

function getRawEventType(event) {
  const rawType = cleanText(event?.type).toLowerCase();
  return EVENT_TYPE_ALIASES[rawType] || rawType;
}

// Built-in types are always present unless listed in hiddenEventTypes. Types
// that events still use are never hidden, so no event is silently retyped.
function normalizeHiddenEventTypes(hiddenEventTypes, usedTypes = new Set(), diagnostics = [], path = "$.hiddenEventTypes") {
  if (hiddenEventTypes === undefined) return [];
  if (!Array.isArray(hiddenEventTypes)) {
    addDiagnostic(diagnostics, "warning", "invalid-hidden-event-types", "Ignored hidden event types because they were not an array.", path);
    return [];
  }

  const hidden = [];
  hiddenEventTypes.forEach((value, index) => {
    const slug = cleanText(value).toLowerCase();
    const safeValue = EVENT_TYPE_ALIASES[slug] || slug;
    const isHideable = safeValue !== DEFAULT_EVENT_TYPE && EVENT_TYPES.some((type) => type.value === safeValue);
    if (!isHideable) {
      addDiagnostic(diagnostics, "warning", "invalid-hidden-event-type", `Ignored hidden event type ${slug || "(missing)"} because it is not a hideable built-in type.`, `${path}[${index}]`);
      return;
    }
    if (usedTypes.has(safeValue)) {
      addDiagnostic(diagnostics, "warning", "hidden-event-type-in-use", `Kept event type ${safeValue} visible because events still use it.`, `${path}[${index}]`);
      return;
    }
    if (!hidden.includes(safeValue)) hidden.push(safeValue);
  });
  return hidden;
}

function normalizeEventTypes(eventTypes, diagnostics = [], path = "$.eventTypes", hiddenTypes = []) {
  const normalized = [];
  const usedValues = new Set();

  for (const eventType of EVENT_TYPES) {
    if (hiddenTypes.includes(eventType.value)) continue;
    addEventType(normalized, usedValues, eventType);
  }

  if (eventTypes === undefined) return normalized;
  if (!Array.isArray(eventTypes)) {
    addDiagnostic(diagnostics, "error", "invalid-event-types-array", "Ignored event types because they were not an array.", path);
    return normalized;
  }

  eventTypes.forEach((eventType, index) => {
    if (!eventType || typeof eventType !== "object") {
      addDiagnostic(diagnostics, "error", "malformed-event-type-dropped", "Ignored malformed event type.", `${path}[${index}]`);
      return;
    }

    const label = cleanText(eventType.label || eventType.name);
    const rawValue = cleanText(eventType.value || eventType.key).toLowerCase() || slugify(label);
    const value = EVENT_TYPE_ALIASES[rawValue] || rawValue;
    if (!isEventTypeValue(value)) {
      addDiagnostic(diagnostics, "warning", "invalid-event-type-definition", `Ignored event type ${value || "(missing)"} because its value was not a valid slug.`, `${path}[${index}].value`);
      return;
    }
    if (usedValues.has(value)) {
      if (!EVENT_TYPES.some((type) => type.value === value)) {
        addDiagnostic(diagnostics, "warning", "duplicate-event-type", `Ignored duplicate event type ${value}.`, `${path}[${index}].value`);
      }
      return;
    }

    addEventType(normalized, usedValues, {
      ...pickUnknown(eventType, EVENT_TYPE_KEYS),
      value,
      label: label || titleFromSlug(value),
      emoji: normalizeEmoji(eventType.emoji) || "🏷️",
      ...(eventType.custom !== undefined || !EVENT_TYPES.some((type) => type.value === value)
        ? { custom: Boolean(eventType.custom || !EVENT_TYPES.some((type) => type.value === value)) }
        : {})
    });
  });

  return normalized;
}

function migrateTimelineInput(input, diagnostics) {
  let migrated = { ...input };
  const version = getInputSchemaVersion(input, diagnostics);

  if (version < 2) {
    migrated = migrateV1ToV2(migrated, diagnostics);
  }
  if (version < 4) {
    noteIgnoredLegacyEventImages(migrated, diagnostics);
  }
  if (version < 5) {
    migrated = migrateV4ToV5(migrated, diagnostics);
  }
  if (version < 6) {
    migrated = migrateV5ToV6(migrated, diagnostics);
  }
  if (version < 7) {
    migrated = migrateV6ToV7(migrated, diagnostics);
  }
  if (version < 8) {
    migrated = migrateV7ToV8(migrated, diagnostics);
  }
  if (version < 9) {
    migrated = migrateV8ToV9(migrated, diagnostics);
  }
  if (version > TIMELINE_VERSION) {
    addDiagnostic(diagnostics, "warning", "future-schema-version", `Timeline schema version ${input.version} is newer than this app supports. Known fields were loaded and unknown fields were preserved.`, "$.version");
  }

  return migrated;
}

function migrateV1ToV2(input, diagnostics) {
  const events = Array.isArray(input.events)
    ? input.events.map((event, index) => {
      if (!event || typeof event !== "object") return event;
      const migratedEvent = { ...event };
      if (cleanText(event.name) && !cleanText(event.title)) {
        migratedEvent.title = event.name;
        addDiagnostic(diagnostics, "warning", "migrated-v1-name", "Migrated legacy event name to title.", `$.events[${index}].name`);
      }
      if (!event.timestamp && (event.date !== undefined || event.time !== undefined || event.tz !== undefined)) {
        migratedEvent.timestamp = {
          date: event.date,
          time: event.time,
          tz: event.tz
        };
        addDiagnostic(diagnostics, "warning", "migrated-v1-timestamp", "Migrated legacy event date/time fields to timestamp.", `$.events[${index}]`);
      }
      return migratedEvent;
    })
    : input.events;

  addDiagnostic(diagnostics, "warning", "migrated-v1-schema", "Applied version 1 to version 2 timeline migration.", "$.version");
  return {
    ...input,
    version: 2,
    events
  };
}

// Versions 2 and 3 changed no data, so there is no migration for them. Version 4 moved
// images into galleries; the old single-image fields are dropped by normalizeEvent.
function noteIgnoredLegacyEventImages(input, diagnostics) {
  if (!Array.isArray(input.events)) return;
  const hasLegacyImages = input.events.some((event) => event && typeof event === "object"
    && (event.image !== undefined || event.imageId !== undefined || event.mediaId !== undefined || event.imageLink !== undefined));
  if (hasLegacyImages) {
    addDiagnostic(diagnostics, "warning", "ignored-legacy-event-images", "Ignored legacy event image fields while loading the gallery-based schema.", "$.events");
  }
}

function migrateV4ToV5(input, diagnostics) {
  addDiagnostic(diagnostics, "warning", "migrated-v4-schema", "Applied version 4 to version 5 timeline migration.", "$.version");
  return {
    ...input,
    version: 5,
    eventTypes: Array.isArray(input.eventTypes) ? input.eventTypes : cloneEventTypes(EVENT_TYPES)
  };
}

function migrateV5ToV6(input, diagnostics) {
  addDiagnostic(diagnostics, "warning", "migrated-v5-schema", "Applied version 5 to version 6 timeline migration.", "$.version");
  return {
    ...input,
    version: 6,
    collections: Array.isArray(input.collections) ? input.collections : []
  };
}

function migrateV6ToV7(input, diagnostics) {
  addDiagnostic(diagnostics, "warning", "migrated-v6-schema", "Applied version 6 to version 7 timeline migration.", "$.version");
  return {
    ...input,
    version: 7,
    eventTypes: migrateLegacyEventTypes(input.eventTypes, V7_EVENT_TYPE_ALIASES),
    events: migrateLegacyEventEventTypes(input.events, V7_EVENT_TYPE_ALIASES)
  };
}

function migrateV7ToV8(input, diagnostics) {
  addDiagnostic(diagnostics, "warning", "migrated-v7-schema", "Applied version 7 to version 8 timeline migration.", "$.version");
  return {
    ...input,
    version: 8,
    eventTypes: migrateLegacyEventTypes(input.eventTypes, V8_EVENT_TYPE_ALIASES),
    events: migrateLegacyEventEventTypes(input.events, V8_EVENT_TYPE_ALIASES)
  };
}

function migrateV8ToV9(input, diagnostics) {
  addDiagnostic(diagnostics, "warning", "migrated-v8-schema", "Applied version 8 to version 9 timeline migration (events may now have an optional end timestamp).", "$.version");
  return {
    ...input,
    version: 9
  };
}

function migrateLegacyEventTypes(eventTypes, aliases) {
  if (!Array.isArray(eventTypes)) return eventTypes;
  return eventTypes.map((eventType) => {
    if (!eventType || typeof eventType !== "object") return eventType;
    const legacyValue = cleanText(eventType.value || eventType.key).toLowerCase();
    const nextValue = aliases[legacyValue];
    if (!nextValue) return eventType;
    const builtin = EVENT_TYPES.find((type) => type.value === nextValue);
    return {
      ...eventType,
      value: nextValue,
      label: builtin?.label || eventType.label,
      emoji: builtin?.emoji || eventType.emoji
    };
  });
}

function migrateLegacyEventEventTypes(events, aliases) {
  if (!Array.isArray(events)) return events;
  return events.map((event) => {
    if (!event || typeof event !== "object") return event;
    const nextType = aliases[cleanText(event.type).toLowerCase()];
    return nextType ? { ...event, type: nextType } : event;
  });
}

function getEventInputs(input, diagnostics) {
  if (Array.isArray(input.events)) return input.events;
  if (Array.isArray(input.timeline?.events)) {
    addDiagnostic(diagnostics, "warning", "nested-events-array", "Loaded events from nested timeline.events.", "$.timeline.events");
    return input.timeline.events;
  }
  if (Array.isArray(input.items)) {
    addDiagnostic(diagnostics, "warning", "items-events-array", "Loaded events from legacy items array.", "$.items");
    return input.items;
  }
  addDiagnostic(diagnostics, "error", "missing-events-array", "Timeline was missing an events array; loaded as an empty timeline.", "$.events");
  return [];
}

function getInputSchemaVersion(input, diagnostics) {
  if (!input.format) {
    addDiagnostic(diagnostics, "warning", "missing-format", "Timeline was missing a format; treated as a legacy local timeline.", "$.format");
  }
  if (input.version === undefined || input.version === null || input.version === "") {
    addDiagnostic(diagnostics, "warning", "missing-version", "Timeline was missing a schema version; treated as legacy version 1 data.", "$.version");
    return 1;
  }

  const version = Number(input.version);
  if (!Number.isFinite(version)) {
    addDiagnostic(diagnostics, "warning", "invalid-version", "Timeline schema version was not numeric; treated as legacy version 1 data.", "$.version");
    return 1;
  }
  if (version < 1) {
    addDiagnostic(diagnostics, "warning", "invalid-version", "Timeline schema version was below 1; treated as legacy version 1 data.", "$.version");
    return 1;
  }
  if (!Number.isInteger(version)) {
    addDiagnostic(diagnostics, "warning", "fractional-version", `Timeline schema version ${input.version} was fractional; treated as version ${Math.floor(version)}.`, "$.version");
  }
  return Math.floor(version);
}

function normalizeTimelineTitle(title, diagnostics) {
  const safeTitle = cleanText(title);
  if (!safeTitle) {
    addDiagnostic(diagnostics, "warning", "default-title", "Timeline was missing title; defaulted to Imported timeline.", "$.title");
    return "Imported timeline";
  }
  return safeTitle;
}

function normalizeUpdatedAt(updatedAt, diagnostics) {
  const safeUpdatedAt = cleanText(updatedAt);
  if (!safeUpdatedAt) {
    addDiagnostic(diagnostics, "warning", "default-updated-at", "Timeline was missing updatedAt; defaulted to the current time.", "$.updatedAt");
    return new Date().toISOString();
  }
  return safeUpdatedAt;
}

function timestampSortValue(timestamp) {
  const safeTimestamp = normalizeTimestamp(timestamp || {});
  return `${safeTimestamp.date}T${safeTimestamp.time} ${safeTimestamp.tz}`;
}

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cloneEventTypes(eventTypes) {
  return eventTypes.map((eventType) => ({ ...eventType }));
}

function addEventType(eventTypes, usedValues, eventType) {
  eventTypes.push({ ...eventType });
  usedValues.add(eventType.value);
}

function normalizeEmoji(value) {
  return cleanText(value).slice(0, 16);
}

function titleFromSlug(value) {
  return cleanText(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Event";
}

function isEventTypeValue(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function addDiagnostic(diagnostics, level, code, message, path) {
  diagnostics.push({
    level,
    code,
    message,
    ...(path ? { path } : {})
  });
}

function throwSchemaError(diagnostics, code, message, path) {
  addDiagnostic(diagnostics, "error", code, message, path);
  const error = new Error(message);
  error.diagnostics = diagnostics;
  throw error;
}

function attachSchemaDiagnostics(timeline, diagnostics) {
  const warnings = diagnostics
    .filter((diagnostic) => diagnostic.level === "warning")
    .map((diagnostic) => diagnostic.message);
  Object.defineProperties(timeline, {
    schemaDiagnostics: {
      value: diagnostics,
      enumerable: false,
      configurable: true
    },
    schemaWarnings: {
      value: warnings,
      enumerable: false,
      configurable: true
    }
  });
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isClockTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isComplexValue(value) {
  return value !== null && typeof value === "object";
}

function isSafeHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function pickUnknown(source, knownKeys) {
  if (!source || typeof source !== "object") return {};
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !knownKeys.has(key))
  );
}

const TIMELINE_KEYS = new Set([
  "format",
  "version",
  "title",
  "updatedAt",
  "eventTypes",
  "hiddenEventTypes",
  "collections",
  "events",
  "media"
]);

const EVENT_TYPE_KEYS = new Set([
  "value",
  "key",
  "label",
  "name",
  "emoji",
  "custom"
]);

const EVENT_KEYS = new Set([
  "id",
  "type",
  "title",
  "name",
  "timestamp",
  "endTimestamp",
  "date",
  "time",
  "tz",
  "location",
  "image",
  "imageId",
  "mediaId",
  "imageLink",
  "images",
  "fields",
  "collectionIds"
]);

const COLLECTION_KEYS = new Set([
  "id",
  "kind",
  "title",
  "name"
]);

const IMAGE_ITEM_KEYS = new Set([
  "id",
  "kind",
  "mediaId",
  "url",
  "caption"
]);

const MEDIA_KEYS = new Set([
  "id",
  "kind",
  "mimeType",
  "dataUrl",
  "path",
  "width",
  "height",
  "originalName",
  "encodedAt"
]);

const FIELD_KEYS = new Set([
  "id",
  "key",
  "label",
  "type",
  "value"
]);

function slugify(value) {
  return String(value || "timeline")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "timeline";
}

export function formatTimelineDownloadBaseName(title, date = new Date()) {
  return `${slugify(title)}-[${formatFilenameTimestamp(date)}]`;
}

function formatFilenameTimestamp(date) {
  const value = date instanceof Date ? date : new Date(date);
  const pad = (number) => String(number).padStart(2, "0");
  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
    pad(value.getHours()),
    pad(value.getMinutes())
  ].join("");
}
