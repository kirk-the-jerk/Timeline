export const TIMELINE_FORMAT = "local-timeline-poc";
export const TIMELINE_VERSION = 1;

export function createEmptyTimeline() {
  return {
    format: TIMELINE_FORMAT,
    version: TIMELINE_VERSION,
    title: "Untitled timeline",
    updatedAt: new Date().toISOString(),
    events: []
  };
}

export function createEvent({ name, date }) {
  return {
    id: crypto.randomUUID(),
    name: String(name || "Untitled event").trim() || "Untitled event",
    date: String(date || today())
  };
}

export function sortEvents(events) {
  return [...events].sort((a, b) => {
    const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
    if (dateCompare !== 0) return dateCompare;
    return String(a.name || "").localeCompare(String(b.name || ""));
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
    events: sortEvents(input.events.map((event) => ({
      id: String(event.id || crypto.randomUUID()),
      name: String(event.name || "Untitled event"),
      date: String(event.date || "")
    })))
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value || "timeline")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "timeline";
}
