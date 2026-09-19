import { escapeHtml, renderEventListItem } from "./eventCard.js";
import { renderMapPlayer } from "./mapPlayer.js";
import { renderSlideshowPlayer } from "./slideshowPlayer.js";
import { renderTimelinePlayer } from "./timelinePlayer.js";

export const PLAYER_RENDERERS = {
  simple: renderSimplePlayer,
  timeline: renderTimelinePlayer,
  slideshow: renderSlideshowPlayer,
  map: renderMapPlayer
};

// A renderer may return { destroy() } to undo whatever it set up beyond the
// container's own children (classes, observers, timers, document listeners).
// The caller destroys the previous view before rendering into the same container
// again. This always returns a handle, so callers needn't check.
export function renderPlayer({ container, timeline, events, player }) {
  const renderer = PLAYER_RENDERERS[player.value] || PLAYER_RENDERERS.simple;
  const view = renderer({ container, timeline, events, player });
  return typeof view?.destroy === "function" ? view : { destroy() {} };
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
