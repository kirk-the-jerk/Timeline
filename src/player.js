import { createTimelineLoadController } from "./fileLoad.js";
import { getPlayerType, normalizePlayerType } from "./players.js";
import {
  canRenderImageMedia,
  formatDisplayTimestamp,
  getEventTitle,
  getEventTypeDisplay,
  normalizeTimeline,
  resolveEventImages,
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
const selectedPlayer = getPlayerType(getRequestedPlayerType());

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
  summary.textContent = `Using the ${selectedPlayer.label} player. Use the load button in the header or drop a timeline file onto the header.`;
  timelineEl.innerHTML = `<div class="empty-state">No timeline loaded.</div>`;
  loadButton.classList.add("attention");
}

function renderTimeline(loadedTimeline) {
  timelineDocument = loadedTimeline;
  const events = sortEvents(timelineDocument.events);
  titleText.textContent = timelineDocument.title;
  summary.textContent = `${selectedPlayer.label} player / ${events.length} event${events.length === 1 ? "" : "s"} in this timeline.`;
  timelineEl.innerHTML = "";
  loadButton.classList.remove("attention");

  if (selectedPlayer.value !== "simple") {
    renderPlaceholderPlayer(events.length);
    return;
  }

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
        ${renderEventGallery(event)}
        <h2>${escapeHtml(getEventTitle(event))}</h2>
        <div class="small">${escapeHtml(getEventTypeDisplay(event.type, timelineDocument))}${event.location ? ` / ${escapeHtml(event.location)}` : ""}</div>
        ${renderFieldSummary(event.fields)}
      </div>
    `;
    timelineEl.append(row);
  }
}

function renderPlaceholderPlayer(eventCount) {
  timelineEl.innerHTML = `
    <div class="empty-state placeholder-player">
      <strong>${escapeHtml(selectedPlayer.label)} player placeholder</strong>
      <span>${escapeHtml(selectedPlayer.description)}</span>
      <span>${eventCount} event${eventCount === 1 ? "" : "s"} loaded.</span>
    </div>
  `;
}

function getRequestedPlayerType() {
  const params = new URLSearchParams(window.location.search);
  return normalizePlayerType(params.get("player"));
}

function renderEventGallery(event) {
  const images = resolveEventImages(timelineDocument, event)
    .filter((image) => image.kind === "link" || canRenderImageMedia(image.media));
  if (images.length === 0) return "";

  const visibleImages = images.slice(0, 4);
  return `
    <div class="event-gallery image-count-${Math.min(visibleImages.length, 4)}">
      ${visibleImages.map((image, index) => renderGalleryImage(image, images.length - visibleImages.length, index)).join("")}
    </div>
  `;
}

function renderGalleryImage(image, hiddenCount, index) {
  const src = image.kind === "embedded" ? image.media.dataUrl : image.url;
  const caption = image.caption || "";
  return `
    <figure class="gallery-item">
      <img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}">
      ${renderImageSourceIcon(image.kind)}
      ${caption ? `<figcaption><span>${escapeHtml(caption)}</span></figcaption>` : ""}
      ${hiddenCount > 0 && index === 3 ? `<span class="gallery-overflow">+${hiddenCount}</span>` : ""}
    </figure>
  `;
}

function renderImageSourceIcon(kind) {
  const label = kind === "embedded" ? "Embedded image" : "Linked image";
  const icon = kind === "embedded"
    ? `
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path>
      <path d="M14 2v6h6"></path>
    `
    : `
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
    `;
  return `
    <span class="source-icon" role="img" aria-label="${label}" title="${label}">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
    </span>
  `;
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
