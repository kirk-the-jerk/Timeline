import { createTimelineLoadController } from "./fileLoad.js";
import { initNav } from "./nav.js";
import { renderPlayer } from "./playerRenderers.js";
import { DEFAULT_PLAYER_TYPE, getPlayerType, normalizePlayerType } from "./players.js";
import { normalizeTimeline, sortEvents } from "./timeline.js";

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

const defaultDocumentTitle = document.title;
let timelineDocument = null;
let currentView = null;
let selectedPlayer = getPlayerType(getRequestedPlayerType());
const nav = initNav({ selectedPlayer: selectedPlayer.value, onSelectPlayer: switchPlayer });

createTimelineLoadController({
  dialog: loadDialog,
  closeButton: closeLoadDialogButton,
  openButton: loadButton,
  fileInput: loadFileInput,
  dropTargets: [document.body],
  dragClassTarget: document.body,
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

function destroyCurrentView() {
  currentView?.destroy();
  currentView = null;
}

function renderEmptyState() {
  destroyCurrentView();
  document.title = defaultDocumentTitle;
  titleText.textContent = "No timeline loaded";
  summary.textContent = `Using the ${selectedPlayer.label} player. Use the load button in the header or drop a timeline file anywhere on this page.`;
  timelineEl.innerHTML = `<div class="empty-state">No timeline loaded.</div>`;
  loadButton.classList.add("attention");
}

function renderTimeline(loadedTimeline) {
  timelineDocument = loadedTimeline;
  const events = sortEvents(timelineDocument.events);
  document.title = timelineDocument.title;
  titleText.textContent = timelineDocument.title;
  summary.textContent = `${selectedPlayer.label} player / ${events.length} event${events.length === 1 ? "" : "s"} in this timeline.`;
  destroyCurrentView();
  timelineEl.innerHTML = "";
  loadButton.classList.remove("attention");
  currentView = renderPlayer({
    container: timelineEl,
    timeline: timelineDocument,
    events,
    player: selectedPlayer
  });
}

// Switches in place so a timeline loaded from a file isn't lost, and keeps the
// URL in step so a reload or a copied link opens the same player.
function switchPlayer(playerValue) {
  selectedPlayer = getPlayerType(playerValue);
  nav.setSelectedPlayer(selectedPlayer.value);

  const url = new URL(window.location.href);
  if (selectedPlayer.value === DEFAULT_PLAYER_TYPE) {
    url.searchParams.delete("player");
  } else {
    url.searchParams.set("player", selectedPlayer.value);
  }
  window.history.replaceState(null, "", url);

  if (timelineDocument) {
    renderTimeline(timelineDocument);
  } else {
    renderEmptyState();
  }
}

function getRequestedPlayerType() {
  const params = new URLSearchParams(window.location.search);
  return normalizePlayerType(params.get("player"));
}

function setStatus(message) {
  status.textContent = message;
}
