import {
  canRenderImageMedia,
  formatDisplayTimestamp,
  getEventTitle,
  getEventTypeDisplay,
  resolveEventImages
} from "./timeline.js";

export const PLAYER_RENDERERS = {
  simple: renderSimplePlayer,
  timeline: renderPlaceholderPlayer,
  slideshow: renderPlaceholderPlayer,
  map: renderPlaceholderPlayer
};

export function renderPlayer({ container, timeline, events, player }) {
  const renderer = PLAYER_RENDERERS[player.value] || PLAYER_RENDERERS.simple;
  renderer({ container, timeline, events, player });
}

export function renderSimplePlayer({ container, timeline, events }) {
  if (events.length === 0) {
    renderEmptyTimeline(container);
    return;
  }

  for (const event of events) {
    container.append(renderEventListItem(timeline, event));
  }
}

export function renderPlaceholderPlayer({ container, events, player }) {
  container.innerHTML = `
    <div class="empty-state placeholder-player">
      <strong>${escapeHtml(player.label)} player placeholder</strong>
      <span>${escapeHtml(player.description)}</span>
      <span>${events.length} event${events.length === 1 ? "" : "s"} loaded.</span>
    </div>
  `;
}

function renderEmptyTimeline(container) {
  container.innerHTML = `<div class="empty-state">This timeline does not contain any events.</div>`;
}

function renderEventListItem(timeline, event) {
  const row = document.createElement("article");
  row.className = "timeline-event";
  row.innerHTML = `
    <div class="event-date">${escapeHtml(formatDisplayTimestamp(event.timestamp))}</div>
    <div class="timeline-card">
      ${renderEventGallery(timeline, event)}
      <h2>${escapeHtml(getEventTitle(event))}</h2>
      <div class="small">${escapeHtml(formatEventMeta(timeline, event))}</div>
      ${renderFieldSummary(event.fields)}
    </div>
  `;
  return row;
}

function formatEventMeta(timeline, event) {
  return `${getEventTypeDisplay(event.type, timeline)}${event.location ? ` / ${event.location}` : ""}`;
}

function renderEventGallery(timeline, event) {
  const images = resolveEventImages(timeline, event)
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
