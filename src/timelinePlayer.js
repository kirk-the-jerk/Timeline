import { escapeHtml, renderEventListItem } from "./eventCard.js";
import {
  formatDisplayRange,
  getEventCollections,
  getEventTitle,
  getEventType,
  getEventTypeDisplay
} from "./timeline.js";
import {
  formatWindowBound,
  getEventSpan,
  getTimeDomain,
  getTimeTicks,
  getWindowRange,
  matchesSearch,
  packLanes,
  spanOverlaps
} from "./timelineLayout.js";

const SLIDER_MAX = 1000;
const MIN_WINDOW_SIZE = 10;
const LANE_HEIGHT = 30;
const DOT_PX = 12;
const FALLBACK_CHART_PX = 720;

// Overview + detail: a chart of the events inside the chosen date window (ranges
// as bars, single moments as dots), a two-handle scrubber over the whole span to
// choose that window, search and type/collection toggles, and the full event
// cards below. Everything but the chart and the scrubber marks is built once;
// changing a filter or the window only toggles visibility and redraws marks.
export function renderTimelinePlayer({ container, timeline, events }) {
  if (events.length === 0) {
    container.innerHTML = `<div class="empty-state">This timeline does not contain any events.</div>`;
    return;
  }

  const entries = events.map((event) => ({
    event,
    span: getEventSpan(event),
    row: renderEventListItem(timeline, event),
    collections: getEventCollections(timeline, event),
    search: buildSearchText(timeline, event)
  }));
  const domain = getTimeDomain(entries.map((entry) => entry.span).filter(Boolean));
  const state = {
    query: "",
    types: new Set(),
    collections: new Set(),
    start: 0,
    end: SLIDER_MAX
  };
  let lastChartWidth = 0;

  container.classList.add("timeline-chart-mode");
  container.innerHTML = `
    <div class="tl-player">
      <div class="tl-controls">
        <input class="tl-search" type="search" placeholder="Search events" aria-label="Search events">
        ${renderChipGroup("type", "Event types", countTypes(timeline, entries))}
        ${renderChipGroup("collection", "Collections", countCollections(entries))}
      </div>
      ${domain ? `
        <div class="tl-chart">
          <div class="tl-plot" data-plot></div>
          <div class="tl-axis" data-axis></div>
        </div>
        <div class="tl-overview">
          <div class="tl-overview-marks" data-overview-marks></div>
          <div class="tl-overview-window" data-overview-window></div>
          <input class="tl-range" type="range" min="0" max="${SLIDER_MAX}" step="1" value="0" data-handle="start" aria-label="Window start">
          <input class="tl-range" type="range" min="0" max="${SLIDER_MAX}" step="1" value="${SLIDER_MAX}" data-handle="end" aria-label="Window end">
        </div>
      ` : ""}
      <div class="tl-status">
        <span data-status role="status" aria-live="polite"></span>
        <button class="tl-reset" type="button" data-reset hidden>Show everything</button>
      </div>
      <div class="tl-empty empty-state" data-empty hidden>No events match. Try widening the dates or clearing the filters.</div>
      <div class="tl-list timeline" data-list></div>
    </div>
  `;

  const root = container.querySelector(".tl-player");
  const searchInput = root.querySelector(".tl-search");
  const plot = root.querySelector("[data-plot]");
  const axis = root.querySelector("[data-axis]");
  const overviewMarks = root.querySelector("[data-overview-marks]");
  const overviewWindow = root.querySelector("[data-overview-window]");
  const startInput = root.querySelector('[data-handle="start"]');
  const endInput = root.querySelector('[data-handle="end"]');
  const statusEl = root.querySelector("[data-status]");
  const resetButton = root.querySelector("[data-reset]");
  const emptyEl = root.querySelector("[data-empty]");
  const listEl = root.querySelector("[data-list]");

  for (const entry of entries) listEl.append(entry.row);

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    update();
  });

  root.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-chip]");
    if (chip) {
      toggleChip(chip);
      return;
    }
    const mark = event.target.closest("[data-entry]");
    if (mark) {
      revealEntry(entries[Number(mark.dataset.entry)]);
      return;
    }
    if (event.target.closest("[data-reset]")) resetAll();
  });

  for (const input of [startInput, endInput]) {
    input?.addEventListener("input", () => {
      moveHandle(input.dataset.handle);
      update();
    });
  }

  if (plot && typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      if (Math.abs(plot.clientWidth - lastChartWidth) > 1) update();
    }).observe(plot);
  }

  update();

  function moveHandle(handle) {
    if (handle === "start") {
      state.start = Math.min(Number(startInput.value), state.end - MIN_WINDOW_SIZE);
      startInput.value = state.start;
    } else {
      state.end = Math.max(Number(endInput.value), state.start + MIN_WINDOW_SIZE);
      endInput.value = state.end;
    }
  }

  function toggleChip(chip) {
    const selected = chip.dataset.chip === "type" ? state.types : state.collections;
    const value = chip.dataset.value;
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    update();
  }

  function resetAll() {
    state.query = "";
    state.types.clear();
    state.collections.clear();
    state.start = 0;
    state.end = SLIDER_MAX;
    searchInput.value = "";
    if (startInput) startInput.value = 0;
    if (endInput) endInput.value = SLIDER_MAX;
    update();
  }

  function revealEntry(entry) {
    entry.row.scrollIntoView?.({ block: "center", behavior: "smooth" });
    entry.row.classList.add("is-highlighted");
    setTimeout(() => entry.row.classList.remove("is-highlighted"), 1600);
  }

  function matchesFilters(entry) {
    if (state.types.size > 0 && !state.types.has(entry.event.type)) return false;
    if (state.collections.size > 0 && !entry.collections.some((collection) => state.collections.has(collection.id))) return false;
    return matchesSearch(entry.search, state.query);
  }

  function update() {
    const range = domain ? getWindowRange(domain, state.start, state.end) : null;
    const filtered = entries.filter(matchesFilters);
    // Events with no usable date can't be placed, so a date window never hides them.
    const visible = filtered.filter((entry) => !range || !entry.span || spanOverlaps(entry.span, range));
    const visibleSet = new Set(visible);

    for (const entry of entries) entry.row.hidden = !visibleSet.has(entry);
    emptyEl.hidden = visible.length > 0;

    for (const chip of root.querySelectorAll("[data-chip]")) {
      const selected = chip.dataset.chip === "type" ? state.types : state.collections;
      chip.setAttribute("aria-pressed", String(selected.has(chip.dataset.value)));
    }

    const windowNarrowed = state.start > 0 || state.end < SLIDER_MAX;
    const filtersActive = Boolean(state.query.trim()) || state.types.size > 0 || state.collections.size > 0;
    statusEl.textContent = describeStatus(visible.length, entries.length, range, windowNarrowed);
    resetButton.hidden = !windowNarrowed && !filtersActive;

    if (domain) {
      overviewWindow.style.left = `${state.start / 10}%`;
      overviewWindow.style.width = `${(state.end - state.start) / 10}%`;
      drawOverviewMarks(overviewMarks, filtered, domain);
      drawChart(visible.filter((entry) => entry.span), range);
    }
  }

  function drawChart(chartEntries, range) {
    const width = plot.clientWidth || FALLBACK_CHART_PX;
    lastChartWidth = plot.clientWidth;
    const size = range.end - range.start;
    const dotFrac = DOT_PX / width;
    const toFrac = (time) => (time - range.start) / size;

    const items = chartEntries.map((entry) => {
      const title = getEventTitle(entry.event);
      const emoji = getEventType(entry.event.type, timeline).emoji;
      const label = emoji ? `${emoji} ${title}` : title;
      const isPoint = entry.span.end === entry.span.start;
      const labelFrac = Math.min(label.length * 7 + 16, 240) / width;
      const startFrac = Math.max(toFrac(entry.span.start), 0);
      const endFrac = Math.min(toFrac(entry.span.end), 1);
      const barFrac = isPoint ? dotFrac : Math.max(endFrac - startFrac, dotFrac);
      const barStart = Math.min(isPoint ? startFrac - dotFrac / 2 : startFrac, 1 - barFrac);
      const barLeft = Math.max(barStart, 0);
      const inside = !isPoint && barFrac >= labelFrac;

      let x0 = barLeft;
      let x1 = barLeft + barFrac;
      let flipped = false;
      if (!inside) {
        if (x1 + labelFrac <= 1) {
          x1 += labelFrac;
        } else if (x1 - barFrac - labelFrac >= 0) {
          x0 = x1 - barFrac - labelFrac;
          flipped = true;
        } else {
          x1 = 1;
        }
      }
      return { entry, label, isPoint, inside, flipped, barFrac, x0, x1 };
    }).sort((a, b) => a.x0 - b.x0);

    const { lanes, laneCount } = packLanes(items);
    plot.style.height = `${Math.max(laneCount, 1) * LANE_HEIGHT + 8}px`;

    const ticks = getTimeTicks(range.start, range.end, Math.max(3, Math.min(10, Math.floor(width / 110))));
    const grid = ticks.map((tick) => `<span class="tl-grid" style="left:${toFrac(tick.time) * 100}%"></span>`).join("");
    axis.innerHTML = ticks.map((tick) => `<span style="left:${toFrac(tick.time) * 100}%">${escapeHtml(tick.label)}</span>`).join("");

    plot.innerHTML = grid + items.map((item, index) => {
      const span = item.x1 - item.x0;
      const classes = ["tl-item", item.isPoint ? "is-point" : "is-range", item.inside ? "is-inside" : "", item.flipped ? "is-flipped" : ""];
      const barWidth = item.inside ? 100 : (item.barFrac / span) * 100;
      const dateText = formatDisplayRange(item.entry.event.timestamp, item.entry.event.endTimestamp);
      return `
        <button class="${classes.filter(Boolean).join(" ")}" type="button" data-entry="${entries.indexOf(item.entry)}"
          style="left:${item.x0 * 100}%;width:${span * 100}%;top:${lanes[index] * LANE_HEIGHT + 4}px"
          title="${escapeHtml(`${getEventTitle(item.entry.event)} — ${dateText}`)}">
          <span class="tl-bar" style="width:${barWidth}%">${item.inside ? `<span class="tl-label">${escapeHtml(item.label)}</span>` : ""}</span>
          ${item.inside ? "" : `<span class="tl-label">${escapeHtml(item.label)}</span>`}
        </button>
      `;
    }).join("");
  }
}

function drawOverviewMarks(element, filtered, domain) {
  const size = domain.max - domain.min;
  element.innerHTML = filtered.filter((entry) => entry.span).map((entry) => {
    const left = ((entry.span.start - domain.min) / size) * 100;
    const width = ((entry.span.end - entry.span.start) / size) * 100;
    return `<span style="left:${left}%;width:${width}%"></span>`;
  }).join("");
}

function describeStatus(visibleCount, totalCount, range, windowNarrowed) {
  const counts = `Showing ${visibleCount} of ${totalCount} event${totalCount === 1 ? "" : "s"}`;
  if (!windowNarrowed || !range) return counts;
  const size = range.end - range.start;
  return `${counts} between ${formatWindowBound(range.start, size)} and ${formatWindowBound(range.end, size)}`;
}

function renderChipGroup(kind, label, options) {
  if (options.length < 2) return "";
  return `
    <div class="tl-chips" role="group" aria-label="${escapeHtml(label)}">
      ${options.map((option) => `
        <button class="tl-chip" type="button" aria-pressed="false" data-chip="${kind}" data-value="${escapeHtml(option.value)}">
          ${escapeHtml(option.label)} <span class="tl-chip-count">${option.count}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function countTypes(timeline, entries) {
  const counts = new Map();
  for (const { event } of entries) counts.set(event.type, (counts.get(event.type) || 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count, label: getEventTypeDisplay(value, timeline) }));
}

function countCollections(entries) {
  const options = new Map();
  for (const { collections } of entries) {
    for (const collection of collections) {
      const option = options.get(collection.id) || { value: collection.id, label: collection.title, count: 0 };
      option.count += 1;
      options.set(collection.id, option);
    }
  }
  return [...options.values()];
}

function buildSearchText(timeline, event) {
  return [
    getEventTitle(event),
    event.location,
    getEventTypeDisplay(event.type, timeline),
    formatDisplayRange(event.timestamp, event.endTimestamp),
    ...getEventCollections(timeline, event).map((collection) => collection.title),
    ...event.fields.flatMap((field) => [field.label, field.value]),
    ...(event.images || []).map((image) => image.caption)
  ].filter(Boolean).join(" ").toLowerCase();
}
