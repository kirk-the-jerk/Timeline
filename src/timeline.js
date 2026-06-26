export const TIMELINE_FORMAT = "local-timeline-poc";
export const TIMELINE_VERSION = 2;

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
    events: []
  };
}

export function createEvent({ type, title, date, time, tz, location, fields }) {
  return {
    id: crypto.randomUUID(),
    type: normalizeEventType(type),
    title: cleanText(title) || "Untitled event",
    timestamp: normalizeTimestamp({ date, time, tz }),
    location: cleanText(location),
    fields: normalizeFields(fields)
  };
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

  return {
    format: TIMELINE_FORMAT,
    version: Number(input.version || TIMELINE_VERSION),
    title: String(input.title || "Imported timeline"),
    updatedAt: String(input.updatedAt || new Date().toISOString()),
    events: sortEvents(input.events.map(normalizeEvent))
  };
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

function normalizeEvent(event) {
  const timestamp = event.timestamp
    ? normalizeTimestamp(event.timestamp)
    : normalizeTimestamp({
      date: event.date,
      time: event.time,
      tz: event.tz
    });

  return {
    id: String(event.id || crypto.randomUUID()),
    type: normalizeEventType(event.type),
    title: getEventTitle(event),
    timestamp,
    location: cleanText(event.location),
    fields: normalizeFields(event.fields)
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
    .map((field) => createField(field))
    .filter((field) => field.label || field.value);
}

function createField({ id, key, label, type, value }) {
  const safeLabel = cleanText(label || key);
  return {
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

function slugify(value) {
  return String(value || "timeline")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "timeline";
}
