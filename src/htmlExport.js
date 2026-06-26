import { normalizeTimeline } from "./timeline.js";
import { getPlayerType, normalizePlayerType } from "./players.js";

export function downloadStandaloneHtml(timeline, playerType = "simple") {
  const safeTimeline = normalizeTimeline({
    ...timeline,
    updatedAt: new Date().toISOString()
  });
  const safePlayerType = normalizePlayerType(playerType);
  const html = buildStandaloneHtml(safeTimeline, safePlayerType);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(safeTimeline.title)}.timeline.html`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildStandaloneHtml(timeline, playerType) {
  const title = escapeHtml(timeline.title);
  const timelineJson = JSON.stringify(timeline).replaceAll("<", "\\u003c");
  const player = getPlayerType(playerType);
  const playerJson = JSON.stringify(player).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>${standaloneCss()}</style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div>
          <div class="eyebrow">Standalone Timeline</div>
          <h1 id="timeline-title"></h1>
          <p id="timeline-summary"></p>
        </div>
      </header>
      <section class="timeline" id="timeline"></section>
    </main>
    <script type="application/json" id="timeline-data">${timelineJson}</script>
    <script type="application/json" id="player-data">${playerJson}</script>
    <script>${standaloneRuntime()}</script>
  </body>
</html>
`;
}

function standaloneCss() {
  return `
:root {
  color-scheme: light;
  --bg: #f6f4ef;
  --panel: #ffffff;
  --text: #222222;
  --muted: #666666;
  --line: #d7d3c8;
  --accent: #2f6f68;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
}
.shell {
  width: min(960px, calc(100% - 32px));
  margin: 0 auto;
  padding: 34px 0 56px;
}
.topbar {
  border-bottom: 1px solid var(--line);
  padding-bottom: 18px;
  margin-bottom: 28px;
}
.eyebrow {
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
h1 {
  margin: 6px 0 8px;
  font-size: clamp(2rem, 6vw, 4rem);
  line-height: 1;
}
p {
  margin: 0;
  color: var(--muted);
}
.timeline {
  position: relative;
  display: grid;
  gap: 18px;
}
.timeline::before {
  content: "";
  position: absolute;
  left: 92px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--line);
}
.timeline-event {
  position: relative;
  display: grid;
  grid-template-columns: 184px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.timeline-event::before {
  content: "";
  position: absolute;
  left: 85px;
  top: 10px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  border: 3px solid var(--bg);
}
.event-date {
  color: #245650;
  font-weight: 800;
  line-height: 1.35;
}
.timeline-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
}
.timeline-card h2 {
  margin: 0 0 4px;
  font-size: 1.2rem;
}
.small {
  color: var(--muted);
  font-size: 0.92rem;
}
.timeline-image {
  display: block;
  width: 100%;
  max-height: 380px;
  object-fit: cover;
  border: 1px solid var(--line);
  border-radius: 6px;
  margin-bottom: 12px;
}
.field-summary {
  display: grid;
  gap: 6px;
  margin: 12px 0 0;
}
.field-summary div {
  display: grid;
  grid-template-columns: minmax(100px, 150px) minmax(0, 1fr);
  gap: 8px;
}
.field-summary dt {
  color: var(--muted);
  font-weight: 800;
}
.field-summary dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.empty-state {
  border: 1px dashed #b8b1a1;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.55);
  color: var(--muted);
  padding: 28px;
  text-align: center;
}
.placeholder-player {
  display: grid;
  gap: 8px;
}
a {
  color: #245650;
}
@media (max-width: 760px) {
  .timeline::before,
  .timeline-event::before {
    display: none;
  }
  .timeline-event,
  .field-summary div {
    grid-template-columns: 1fr;
  }
}
`;
}

function standaloneRuntime() {
  return `
(function () {
  const EVENT_TYPES = {
    life: "Life",
    move: "Move",
    travel: "Travel",
    job: "Job"
  };

  const timelineData = JSON.parse(document.getElementById("timeline-data").textContent);
  const playerData = JSON.parse(document.getElementById("player-data").textContent);
  const title = document.getElementById("timeline-title");
  const summary = document.getElementById("timeline-summary");
  const timeline = document.getElementById("timeline");
  const events = sortEvents(timelineData.events || []);
  const mediaById = new Map((timelineData.media || []).map((item) => [item.id, item]));

  title.textContent = timelineData.title || "Untitled timeline";
  summary.textContent = playerData.label + " player / " + events.length + " event" + (events.length === 1 ? "" : "s");

  if (playerData.value !== "simple") {
    renderPlaceholderPlayer(events.length);
    return;
  }

  if (events.length === 0) {
    timeline.innerHTML = '<div class="empty-state">This timeline does not contain any events.</div>';
    return;
  }

  for (const event of events) {
    const row = document.createElement("article");
    row.className = "timeline-event";

    const date = document.createElement("div");
    date.className = "event-date";
    date.textContent = formatDisplayTimestamp(event.timestamp);

    const card = document.createElement("div");
    card.className = "timeline-card";

    const eventImage = resolveEventImage(event);
    if (canRenderImageMedia(eventImage)) {
      const image = document.createElement("img");
      image.className = "timeline-image";
      image.src = eventImage.dataUrl;
      image.alt = "";
      card.append(image);
    }

    const heading = document.createElement("h2");
    heading.textContent = event.title || "Untitled event";
    card.append(heading);

    const meta = document.createElement("div");
    meta.className = "small";
    meta.textContent = (EVENT_TYPES[event.type] || "Life") + (event.location ? " / " + event.location : "");
    card.append(meta);

    const imageLink = makeImageLink(event.imageLink);
    if (imageLink) card.append(imageLink);

    const fieldSummary = makeFieldSummary(event.fields || []);
    if (fieldSummary) card.append(fieldSummary);

    row.append(date, card);
    timeline.append(row);
  }

  function renderPlaceholderPlayer(eventCount) {
    timeline.innerHTML = "";
    const placeholder = document.createElement("div");
    placeholder.className = "empty-state placeholder-player";

    const title = document.createElement("strong");
    title.textContent = playerData.label + " player placeholder";

    const description = document.createElement("span");
    description.textContent = playerData.description || "Player placeholder.";

    const count = document.createElement("span");
    count.textContent = eventCount + " event" + (eventCount === 1 ? "" : "s") + " loaded.";

    placeholder.append(title, description, count);
    timeline.append(placeholder);
  }

  function sortEvents(events) {
    return [...events].sort((a, b) => {
      const aTimestamp = timestampSortValue(a.timestamp);
      const bTimestamp = timestampSortValue(b.timestamp);
      const timestampCompare = aTimestamp.localeCompare(bTimestamp);
      if (timestampCompare !== 0) return timestampCompare;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }

  function timestampSortValue(timestamp) {
    const safeTimestamp = timestamp || {};
    return String(safeTimestamp.date || "") + "T" + String(safeTimestamp.time || "00:00") + " " + String(safeTimestamp.tz || "");
  }

  function formatDisplayTimestamp(timestamp) {
    const safeTimestamp = timestamp || {};
    const date = safeTimestamp.date || "";
    if (!date) return "No date";
    const parsed = new Date(date + "T00:00:00");
    const dateText = Number.isNaN(parsed.getTime())
      ? date
      : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    return dateText + " " + (safeTimestamp.time || "00:00") + " " + (safeTimestamp.tz || "");
  }

  function makeImageLink(url) {
    if (!isSafeHttpUrl(url)) return null;
    const link = document.createElement("a");
    link.className = "small";
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Image link";
    return link;
  }

  function resolveEventImage(event) {
    if (event.imageId && mediaById.has(event.imageId)) return mediaById.get(event.imageId);
    return event.image || null;
  }

  function canRenderImageMedia(media) {
    return media
      && media.kind === "image"
      && media.mimeType === "image/jpeg"
      && String(media.dataUrl || "").startsWith("data:image/jpeg;base64,");
  }

  function makeFieldSummary(fields) {
    const populatedFields = fields.filter((field) => field && field.value);
    if (populatedFields.length === 0) return null;

    const list = document.createElement("dl");
    list.className = "field-summary";

    for (const field of populatedFields) {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      term.textContent = field.label || field.key || "Field";
      value.textContent = field.value;
      row.append(term, value);
      list.append(row);
    }

    return list;
  }

  function isSafeHttpUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }
})();
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

function slugify(value) {
  return String(value || "timeline")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "timeline";
}
