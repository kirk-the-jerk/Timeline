// Entry point of the standalone HTML export. htmlExport.js bundles this file and
// everything it imports into the exported page, so it runs as a classic script
// there and as a normal module here (where it is only syntax-checked and bundled).
import { renderPlayer } from "./playerRenderers.js";
import { getPlayerType } from "./players.js";
import { normalizeTimeline, sortEvents } from "./timeline.js";

function startStandaloneTimeline() {
  const titleEl = document.getElementById("timeline-title");
  const summaryEl = document.getElementById("timeline-summary");
  const timelineEl = document.getElementById("timeline");

  try {
    const timeline = normalizeTimeline(JSON.parse(document.getElementById("timeline-data").textContent));
    const player = getPlayerType(JSON.parse(document.getElementById("player-data").textContent).value);
    const events = sortEvents(timeline.events);

    // The page already carries this title from export time; setting it here keeps
    // the tab in step with what the page shows, whichever way the file was made.
    document.title = timeline.title;
    titleEl.textContent = timeline.title;
    summaryEl.textContent = `${player.label} player / ${events.length} event${events.length === 1 ? "" : "s"}`;
    renderPlayer({ container: timelineEl, timeline, events, player });
  } catch (error) {
    titleEl.textContent = "Could not show this timeline";
    summaryEl.textContent = error.message;
  }
}

startStandaloneTimeline();
