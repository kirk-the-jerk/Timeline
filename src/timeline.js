export const TIMELINE_FORMAT = "local-timeline-poc";
export const TIMELINE_VERSION = 3;

export const EVENT_TYPES = [
  { value: "life", label: "Life" },
  { value: "move", label: "Move" },
  { value: "travel", label: "Travel" },
  { value: "job", label: "Job" }
];

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
    media: [],
    events: []
  };
}

export function createEvent({ type, title, date, time, tz, location, imageId, imageLink, fields }) {
  return {
    id: crypto.randomUUID(),
    type: normalizeEventType(type),
    title: cleanText(title) || "Untitled event",
    timestamp: normalizeTimestamp({ date, time, tz }),
    location: cleanText(location),
    imageId: cleanText(imageId),
    imageLink: cleanText(imageLink),
    fields: normalizeFields(fields)
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
  if (!input || typeof input !== "object") {
    throw new Error("The selected file does not contain a timeline object.");
  }

  if (input.format && input.format !== TIMELINE_FORMAT) {
    throw new Error(`Unsupported timeline format: ${input.format}`);
  }

  if (!Array.isArray(input.events)) {
    throw new Error("The timeline is missing an events array.");
  }

  const warnings = getInputWarnings(input);
  const mediaById = new Map();

  if (Array.isArray(input.media)) {
    for (const item of input.media) {
      const media = normalizeMedia(item, warnings);
      if (media) mediaById.set(media.id, media);
    }
  } else if (input.media !== undefined) {
    warnings.push("Ignored media because it was not an array.");
  }

  const events = input.events.map((event) => normalizeEvent(event, mediaById, warnings));
  const normalized = {
    ...pickUnknown(input, TIMELINE_KEYS),
    format: TIMELINE_FORMAT,
    version: TIMELINE_VERSION,
    title: String(input.title || "Imported timeline"),
    updatedAt: String(input.updatedAt || new Date().toISOString()),
    media: [...mediaById.values()],
    events: sortEvents(events)
  };

  attachSchemaWarnings(normalized, warnings);
  return normalized;
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
  link.download = `${slugify(safeTimeline.title)}.timeline.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function formatDisplayTimestamp(timestamp) {
  const safeTimestamp = normalizeTimestamp(timestamp || {});
  if (!safeTimestamp.date) return "No date";
  const parsed = new Date(`${safeTimestamp.date}T00:00:00`);
  const dateText = Number.isNaN(parsed.getTime())
    ? safeTimestamp.date
    : parsed.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  const timeText = safeTimestamp.time || "00:00";
  return `${dateText} ${timeText} ${safeTimestamp.tz}`;
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

export function getEventTypeLabel(type) {
  return EVENT_TYPES.find((eventType) => eventType.value === type)?.label || "Life";
}

export function getEventTimeZone(event) {
  return cleanText(event?.timestamp?.tz || event?.tz);
}

export function resolveEventImage(timeline, event) {
  const media = Array.isArray(timeline?.media) ? timeline.media : [];
  return media.find((item) => item.id === event?.imageId) || normalizeMedia(event?.image);
}

export function canRenderImageMedia(media) {
  return media?.kind === "image"
    && media?.mimeType === "image/jpeg"
    && cleanText(media.dataUrl).startsWith("data:image/jpeg;base64,");
}

export function getTimelineSchemaWarnings(timeline) {
  return Array.isArray(timeline?.schemaWarnings) ? timeline.schemaWarnings : [];
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

function normalizeEvent(event, mediaById, warnings) {
  if (!event || typeof event !== "object") {
    warnings.push("Replaced malformed event with an untitled placeholder event.");
    event = {};
  }

  const timestamp = event.timestamp
    ? normalizeTimestamp(event.timestamp)
    : normalizeTimestamp({
      date: event.date,
      time: event.time,
      tz: event.tz
    });
  let imageId = cleanText(event.imageId || event.mediaId);

  if (event.image) {
    const media = normalizeMedia(event.image, warnings);
    if (media) {
      mediaById.set(media.id, media);
      imageId ||= media.id;
    }
  }

  if (imageId && !mediaById.has(imageId)) {
    warnings.push(`Event ${event.id || getEventTitle(event)} references missing media ${imageId}.`);
  }

  return {
    ...pickUnknown(event, EVENT_KEYS),
    id: String(event.id || crypto.randomUUID()),
    type: normalizeEventType(event.type),
    title: getEventTitle(event),
    timestamp,
    location: cleanText(event.location),
    imageId,
    imageLink: cleanText(event.imageLink),
    fields: normalizeFields(event.fields)
  };
}

function normalizeMedia(image, warnings = []) {
  if (!image || typeof image !== "object") return null;

  const dataUrl = cleanText(image.dataUrl);
  const kind = cleanText(image.kind) || "image";
  const mimeType = cleanText(image.mimeType) || (dataUrl.startsWith("data:image/jpeg;base64,") ? "image/jpeg" : "");

  if (!cleanText(image.id) && !dataUrl && !cleanText(image.path)) {
    warnings.push("Ignored media item without an id, dataUrl, or path.");
    return null;
  }

  if (kind === "image" && dataUrl && !dataUrl.startsWith("data:image/jpeg;base64,")) {
    warnings.push("Preserved image media that this app cannot render because it was not a JPEG data URL.");
  }

  return {
    ...pickUnknown(image, MEDIA_KEYS),
    id: String(image.id || crypto.randomUUID()),
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

function normalizeTimestamp(timestamp) {
  return {
    date: cleanText(timestamp.date) || today(),
    time: cleanText(timestamp.time) || "00:00",
    tz: cleanText(timestamp.tz) || getBrowserTimeZone()
  };
}

function normalizeFields(fields) {
  if (!Array.isArray(fields)) return [];

  return fields
    .map((field) => {
      if (!field || typeof field !== "object") return null;
      return createField(field);
    })
    .filter(Boolean)
    .filter((field) => field.label || field.value);
}

function createField(field) {
  const { id, key, label, type, value } = field;
  const safeLabel = cleanText(label || key);
  return {
    ...pickUnknown(field, FIELD_KEYS),
    id: String(id || crypto.randomUUID()),
    key: cleanText(key) || slugify(safeLabel),
    label: safeLabel,
    type: cleanText(type) || "text",
    value: cleanText(value)
  };
}

function normalizeEventType(type) {
  const safeType = cleanText(type).toLowerCase();
  return EVENT_TYPES.some((eventType) => eventType.value === safeType) ? safeType : "life";
}

function timestampSortValue(timestamp) {
  const safeTimestamp = normalizeTimestamp(timestamp || {});
  return `${safeTimestamp.date}T${safeTimestamp.time} ${safeTimestamp.tz}`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function getInputWarnings(input) {
  const warnings = [];
  if (!input.format) warnings.push("Timeline was missing a format; treated as a legacy local timeline.");
  if (!input.version) warnings.push("Timeline was missing a schema version; treated as legacy data.");
  if (Number(input.version || 1) > TIMELINE_VERSION) {
    warnings.push(`Timeline schema version ${input.version} is newer than this app supports. Known fields were loaded and unknown fields were preserved.`);
  }
  return warnings;
}

function attachSchemaWarnings(timeline, warnings) {
  Object.defineProperty(timeline, "schemaWarnings", {
    value: warnings,
    enumerable: false,
    configurable: true
  });
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
  "events",
  "media"
]);

const EVENT_KEYS = new Set([
  "id",
  "type",
  "title",
  "name",
  "timestamp",
  "date",
  "time",
  "tz",
  "location",
  "image",
  "imageId",
  "mediaId",
  "imageLink",
  "fields"
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
