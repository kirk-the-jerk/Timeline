import { createTimelineLoadController } from "./fileLoad.js";
import { renderPlayer } from "./playerRenderers.js";
import { getPlayerType, normalizePlayerType } from "./players.js";
import { normalizeTimeline, sortEvents } from "./timeline.js";

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
  renderPlayer({
    container: timelineEl,
    timeline: timelineDocument,
    events,
    player: selectedPlayer
  });
}

function getRequestedPlayerType() {
  const params = new URLSearchParams(window.location.search);
  return normalizePlayerType(params.get("player"));
}

function setStatus(message) {
  status.textContent = message;
}
