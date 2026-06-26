import { canRenderImageMedia, formatDisplayTimestamp, getEventTitle, getEventTypeLabel, getTimelineSchemaWarnings, readTimelineFile, resolveEventImage, sortEvents } from "./timeline.js";

const fileInput = document.querySelector("#timeline-file");
const dropZone = document.querySelector("#drop-zone");
const status = document.querySelector("#status");
const title = document.querySelector("#timeline-title");
const summary = document.querySelector("#timeline-summary");
const timelineEl = document.querySelector("#timeline");

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  await loadFile(file);
  fileInput.value = "";
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  const file = event.dataTransfer.files?.[0];
  if (!file) return;
  await loadFile(file);
});

async function loadFile(file) {
  try {
    const timelineDocument = await readTimelineFile(file);
    renderTimeline(timelineDocument);
    const warnings = getTimelineSchemaWarnings(timelineDocument);
    if (warnings.length > 0) console.warn("Timeline schema warnings", warnings);
    status.textContent = warnings.length > 0
      ? `Loaded ${file.name} with ${warnings.length} schema warning${warnings.length === 1 ? "" : "s"}.`
      : `Loaded ${file.name}.`;
  } catch (error) {
    status.textContent = `Could not load timeline: ${error.message}`;
  }
}

function renderTimeline(timelineDocument) {
  const events = sortEvents(timelineDocument.events);
  title.textContent = timelineDocument.title;
  summary.textContent = `${events.length} event${events.length === 1 ? "" : "s"} in this timeline.`;
  timelineEl.innerHTML = "";

  if (events.length === 0) {
    timelineEl.innerHTML = `<div class="empty-state">This timeline does not contain any events.</div>`;
    return;
  }

  for (const event of events) {
    const row = document.createElement("article");
    row.className = "timeline-event";
    row.innerHTML = `
      <div class="event-date">${escapeHtml(formatDisplayTimestamp(event.timestamp))}</div>
      <div class="timeline-card">
        ${renderEventImage(timelineDocument, event)}
        <h2>${escapeHtml(getEventTitle(event))}</h2>
        <div class="small">${escapeHtml(getEventTypeLabel(event.type))}${event.location ? ` / ${escapeHtml(event.location)}` : ""}</div>
        ${renderImageLink(event.imageLink)}
        ${renderFieldSummary(event.fields)}
      </div>
    `;
    timelineEl.append(row);
  }
}

function renderEventImage(timelineDocument, event) {
  const image = resolveEventImage(timelineDocument, event);
  if (!canRenderImageMedia(image)) return "";
  return `<img class="timeline-image" src="${escapeHtml(image.dataUrl)}" alt="">`;
}

function renderImageLink(imageLink) {
  if (!imageLink) return "";
  return `<a class="small" href="${escapeHtml(imageLink)}" target="_blank" rel="noreferrer">Image link</a>`;
}

function renderFieldSummary(fields) {
  const populatedFields = fields.filter((field) => field.value);
  if (populatedFields.length === 0) return "";

  return `
    <dl class="field-summary">
      ${populatedFields.map((field) => `
        <div>
          <dt>${escapeHtml(field.label)}</dt>
          <dd>${escapeHtml(field.value)}</dd>
        </div>
      `).join("")}
    </dl>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
