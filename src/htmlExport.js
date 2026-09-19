import { formatTimelineDownloadBaseName, normalizeTimeline } from "./timeline.js";
import { bundleModules } from "./exportBundle.js";
import { getPlayerType, normalizePlayerType } from "./players.js";

export const EXPORT_RUNTIME_URL = new URL("./exportRuntime.js", import.meta.url).href;
export const TIMELINE_PLAYER_CSS_URL = new URL("./timelinePlayer.css", import.meta.url).href;

export async function downloadStandaloneHtml(timeline, playerType = "simple") {
  const safeTimeline = normalizeTimeline({
    ...timeline,
    updatedAt: new Date().toISOString()
  });
  const safePlayerType = normalizePlayerType(playerType);
  const runtime = await bundleModules(EXPORT_RUNTIME_URL, fetchText);
  const playerCss = await fetchText(TIMELINE_PLAYER_CSS_URL);
  const html = buildStandaloneHtml(safeTimeline, safePlayerType, runtime, playerCss);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${formatTimelineDownloadBaseName(safeTimeline.title)}.timeline.html`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
  return response.text();
}

export function buildStandaloneHtml(timeline, playerType, runtime, playerCss = "") {
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
    <style>${standaloneCss()}${playerCss}</style>
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
    <script>${runtime}</script>
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
  left: 197px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--line);
}
.timeline-event {
  position: relative;
  display: grid;
  grid-template-columns: 184px minmax(0, 1fr);
  gap: 28px;
  align-items: start;
}
.timeline-event::before {
  content: "";
  position: absolute;
  /* ::before ignores the * box-sizing rule: 14px dot + 3px ring each side = 20px, centred on the 198px line. */
  left: 188px;
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
  text-align: right;
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
.event-gallery {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.event-gallery.image-count-1 {
  grid-template-columns: 1fr;
}
.gallery-item {
  position: relative;
  min-width: 0;
  margin: 0;
}
.gallery-item img {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.gallery-item figcaption {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  color: var(--muted);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}
.source-icon,
.gallery-overflow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fbfaf7;
  color: #245650;
  padding: 2px 8px;
  font-size: 0.72rem;
  font-weight: 800;
}
.source-icon {
  position: absolute;
  left: 8px;
  top: 8px;
  width: 28px;
  height: 28px;
  padding: 0;
  background: rgba(255, 255, 255, 0.92);
}
.source-icon .icon {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}
.gallery-overflow {
  position: absolute;
  right: 8px;
  top: 8px;
  background: rgba(255, 255, 255, 0.92);
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
  .timeline-event {
    gap: 6px;
  }
  .event-date {
    text-align: left;
  }
}
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
