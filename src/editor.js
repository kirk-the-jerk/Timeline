import { clearActiveTimeline, loadActiveTimeline, saveActiveTimeline } from "./db.js";
import { createEmptyTimeline, createEvent, downloadTimeline, formatDisplayDate, normalizeTimeline, readTimelineFile, sortEvents } from "./timeline.js";

const form = document.querySelector("#timeline-form");
const titleInput = document.querySelector("#timeline-title");
const dateInput = document.querySelector("#event-date");
const nameInput = document.querySelector("#event-name");
const addDummyButton = document.querySelector("#add-dummy");
const saveJsonButton = document.querySelector("#save-json");
const loadJsonInput = document.querySelector("#load-json");
const resetButton = document.querySelector("#reset-timeline");
const eventList = document.querySelector("#event-list");
const status = document.querySelector("#status");

let timeline = createEmptyTimeline();

init();

async function init() {
  try {
    timeline = await loadActiveTimeline();
    setDefaultDate();
    render();
    setStatus("Loaded local draft from IndexedDB.");
  } catch (error) {
    setStatus(`Could not load local draft: ${error.message}`);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  timeline.events = sortEvents([
    ...timeline.events,
    createEvent({
      date: dateInput.value,
      name: nameInput.value
    })
  ]);
  nameInput.value = "";
  await persist("Event added.");
  nameInput.focus();
});

titleInput.addEventListener("change", async () => {
  timeline.title = titleInput.value.trim() || "Untitled timeline";
  await persist("Title saved.");
});

addDummyButton.addEventListener("click", async () => {
  const number = timeline.events.length + 1;
  timeline.events = sortEvents([
    ...timeline.events,
    createEvent({
      date: randomDate(),
      name: `Dummy event ${number}`
    })
  ]);
  await persist("Dummy event added.");
});

saveJsonButton.addEventListener("click", () => {
  timeline.title = titleInput.value.trim() || "Untitled timeline";
  downloadTimeline(timeline);
  setStatus("JSON export started.");
});

loadJsonInput.addEventListener("change", async () => {
  const file = loadJsonInput.files?.[0];
  if (!file) return;

  try {
    timeline = await readTimelineFile(file);
    await persist(`Loaded ${file.name}.`);
  } catch (error) {
    setStatus(`Import failed: ${error.message}`);
  } finally {
    loadJsonInput.value = "";
  }
});

resetButton.addEventListener("click", async () => {
  timeline = createEmptyTimeline();
  await clearActiveTimeline();
  await persist("Local draft reset.");
});

eventList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-id]");
  if (!button) return;
  timeline.events = timeline.events.filter((item) => item.id !== button.dataset.deleteId);
  await persist("Event deleted.");
});

async function persist(message) {
  timeline.title = titleInput.value.trim() || timeline.title || "Untitled timeline";
  timeline = normalizeTimeline(await saveActiveTimeline(timeline));
  render();
  setStatus(message);
}

function render() {
  titleInput.value = timeline.title;
  eventList.innerHTML = "";

  if (timeline.events.length === 0) {
    eventList.innerHTML = `<div class="empty-state">No events yet. Add one manually or create a dummy event.</div>`;
    return;
  }

  for (const event of sortEvents(timeline.events)) {
    const row = document.createElement("article");
    row.className = "event-item";
    row.innerHTML = `
      <div class="event-date">${escapeHtml(formatDisplayDate(event.date))}</div>
      <div class="event-name">${escapeHtml(event.name)}</div>
      <button type="button" data-delete-id="${escapeHtml(event.id)}">Delete</button>
    `;
    eventList.append(row);
  }
}

function setStatus(message) {
  status.textContent = message;
}

function setDefaultDate() {
  dateInput.value = new Date().toISOString().slice(0, 10);
}

function randomDate() {
  const year = 2018 + Math.floor(Math.random() * 9);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
