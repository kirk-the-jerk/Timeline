import { createTimelineLoadController } from "./fileLoad.js";
import {
  canRenderImageMedia,
  formatDisplayTimestamp,
  getEventTitle,
  getEventTypeLabel,
  normalizeTimeline,
  resolveEventImage,
  sortEvents
} from "./timeline.js";

const topbar = document.querySelector(".topbar");
const headerActions = document.querySelector("#header-actions");
const loadButton = document.querySelector("#open-load-file");
const loadFileInput = document.querySelector("#load-file");
const loadDialog = document.querySelector("#load-dialog");
const closeLoadDialogButton = document.querySelector("#close-load-dialog");
const loadProgressBar = document.querySelector("#load-progress-bar");
const loadLog = document.querySelector("#load-log");
const status = document.querySelector("#status");
const titleText = document.querySelector("#timeline-title-text");
const summary = document.querySelector("#timeline-summary");
const timelineEl = document.querySelector("#timeline");

let timelineDocument = null;

createTimelineLoadController({
  dialog: loadDialog,
  closeButton: closeLoadDialogButton,
  openButton: loadButton,
  fileInput: loadFileInput,
  dropTargets: [topbar],
  dragClassTarget: headerActions,
  progressBar: loadProgressBar,
  log: loadLog,
  onTimelineLoaded: async (loadedTimeline) => {
    renderTimeline(loadedTimeline);
  },
  onStatus: setStatus
});

init();

function init() {
  const embeddedData = document.querySelector("#timeline-data");
  if (!embeddedData) {
    renderEmptyState();
    return;
  }

  try {
    renderTimeline(normalizeTimeline(JSON.parse(embeddedData.textContent)));
    setStatus("Loaded embedded timeline.");
  } catch (error) {
    renderEmptyState();
    setStatus(`Could not load embedded timeline: ${error.message}`);
  }
}

function renderEmptyState() {
  titleText.textContent = "No timeline loaded";
  summary.textContent = "Use the load button in the header or drop a timeline file onto the header.";
  timelineEl.innerHTML = `<div class="empty-state">No timeline loaded.</div>`;
  loadButton.classList.add("attention");
}

function renderTimeline(loadedTimeline) {
  timelineDocument = loadedTimeline;
  const events = sortEvents(timelineDocument.events);
  titleText.textContent = timelineDocument.title;
  summary.textContent = `${events.length} event${events.length === 1 ? "" : "s"} in this timeline.`;
  timelineEl.innerHTML = "";
  loadButton.classList.remove("attention");

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
        ${renderEventImage(event)}
        <h2>${escapeHtml(getEventTitle(event))}</h2>
        <div class="small">${escapeHtml(getEventTypeLabel(event.type))}${event.location ? ` / ${escapeHtml(event.location)}` : ""}</div>
        ${renderImageLink(event.imageLink)}
        ${renderFieldSummary(event.fields)}
      </div>
    `;
    timelineEl.append(row);
  }
}

function renderEventImage(event) {
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

function setStatus(message) {
  status.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
