import { clearActiveTimeline, loadActiveTimeline, saveActiveTimeline } from "./db.js";
import { downloadStandaloneHtml } from "./htmlExport.js";
import {
  createCustomField,
  createEmptyTimeline,
  createEvent,
  downloadTimeline,
  EVENT_TYPES,
  FIELD_PRESETS,
  formatDisplayTimestamp,
  getAvailableTimeZones,
  getBrowserTimeZone,
  getEventTimeZone,
  getEventTitle,
  getEventTypeLabel,
  makeFieldFromPreset,
  normalizeTimeline,
  readTimelineFile,
  sortEvents
} from "./timeline.js";

const form = document.querySelector("#timeline-form");
const titleInput = document.querySelector("#timeline-title");
const typeInput = document.querySelector("#event-type");
const eventTitleInput = document.querySelector("#event-title");
const dateInput = document.querySelector("#event-date");
const timeInput = document.querySelector("#event-time");
const tzInput = document.querySelector("#event-tz");
const locationInput = document.querySelector("#event-location");
const imageLinkInput = document.querySelector("#event-image-link");
const imageFileInput = document.querySelector("#event-image-file");
const imageDropZone = document.querySelector("#image-drop-zone");
const imagePreview = document.querySelector("#image-preview");
const fieldPresetInput = document.querySelector("#field-preset");
const addPresetFieldButton = document.querySelector("#add-preset-field");
const customFieldLabelInput = document.querySelector("#custom-field-label");
const addCustomFieldButton = document.querySelector("#add-custom-field");
const customFields = document.querySelector("#custom-fields");
const addDummyButton = document.querySelector("#add-dummy");
const saveJsonButton = document.querySelector("#save-json");
const saveHtmlButton = document.querySelector("#save-html");
const loadJsonInput = document.querySelector("#load-json");
const resetButton = document.querySelector("#reset-timeline");
const eventList = document.querySelector("#event-list");
const status = document.querySelector("#status");

let timeline = createEmptyTimeline();
let draftFields = [];
let draftImage = null;
let lastTimeZone = getBrowserTimeZone();

init();

async function init() {
  populateEventTypes();
  populateTimeZones();
  populateFieldPresets();

  try {
    timeline = await loadActiveTimeline();
    lastTimeZone = getLastEventTimeZone(timeline) || lastTimeZone;
    resetEventForm();
    render();
    setStatus("Loaded local draft from IndexedDB.");
  } catch (error) {
    setStatus(`Could not load local draft: ${error.message}`);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncDraftFieldValues();

  const newEvent = createEvent({
    type: typeInput.value,
    title: eventTitleInput.value,
    date: dateInput.value,
    time: timeInput.value || "00:00",
    tz: tzInput.value || lastTimeZone,
    location: locationInput.value,
    image: draftImage,
    imageLink: imageLinkInput.value,
    fields: draftFields
  });

  lastTimeZone = getEventTimeZone(newEvent) || lastTimeZone;
  timeline.events = sortEvents([...timeline.events, newEvent]);
  resetEventForm();
  await persist("Event added.");
  eventTitleInput.focus();
});

titleInput.addEventListener("change", async () => {
  timeline.title = titleInput.value.trim() || "Untitled timeline";
  await persist("Title saved.");
});

addPresetFieldButton.addEventListener("click", () => {
  const field = makeFieldFromPreset(fieldPresetInput.value);
  if (!field) return;
  draftFields = [...draftFields, field];
  renderDraftFields();
});

addCustomFieldButton.addEventListener("click", () => {
  const field = createCustomField(customFieldLabelInput.value);
  draftFields = [...draftFields, field];
  customFieldLabelInput.value = "";
  renderDraftFields();
});

customFields.addEventListener("input", (event) => {
  const input = event.target.closest("[data-field-value]");
  if (!input) return;
  const field = draftFields.find((item) => item.id === input.dataset.fieldValue);
  if (field) field.value = input.value;
});

customFields.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-field]");
  if (!button) return;
  draftFields = draftFields.filter((field) => field.id !== button.dataset.removeField);
  renderDraftFields();
});

imageFileInput.addEventListener("change", async () => {
  const file = imageFileInput.files?.[0];
  if (!file) return;
  await setDraftImageFromFile(file);
  imageFileInput.value = "";
});

imageDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  imageDropZone.classList.add("dragging");
});

imageDropZone.addEventListener("dragleave", () => {
  imageDropZone.classList.remove("dragging");
});

imageDropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  imageDropZone.classList.remove("dragging");
  const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/"));
  if (!file) {
    setStatus("Drop did not include an image file.");
    return;
  }
  await setDraftImageFromFile(file);
});

document.addEventListener("paste", async (event) => {
  const file = getImageFileFromClipboard(event.clipboardData);
  if (!file) return;
  await setDraftImageFromFile(file);
});

addDummyButton.addEventListener("click", async () => {
  const number = timeline.events.length + 1;
  const type = EVENT_TYPES[number % EVENT_TYPES.length].value;
  const dummyEvent = createEvent({
    type,
    date: randomDate(),
    time: number % 2 === 0 ? "09:30" : "",
    tz: lastTimeZone,
    title: `Dummy ${getEventTypeLabel(type).toLowerCase()} event ${number}`,
    location: number % 2 === 0 ? "Sample City" : "",
    imageLink: number % 3 === 0 ? "https://example.com/sample-image.jpg" : "",
    fields: [
      {
        key: "summary",
        label: "Summary",
        type: "text",
        value: "Placeholder detail for schema testing."
      }
    ]
  });

  lastTimeZone = getEventTimeZone(dummyEvent) || lastTimeZone;
  timeline.events = sortEvents([...timeline.events, dummyEvent]);
  await persist("Dummy event added.");
});

saveJsonButton.addEventListener("click", () => {
  timeline.title = titleInput.value.trim() || "Untitled timeline";
  downloadTimeline(timeline);
  setStatus("JSON export started.");
});

saveHtmlButton.addEventListener("click", () => {
  timeline.title = titleInput.value.trim() || "Untitled timeline";
  downloadStandaloneHtml(timeline);
  setStatus("Standalone HTML export started.");
});

loadJsonInput.addEventListener("change", async () => {
  const file = loadJsonInput.files?.[0];
  if (!file) return;

  try {
    timeline = await readTimelineFile(file);
    lastTimeZone = getLastEventTimeZone(timeline) || lastTimeZone;
    resetEventForm();
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
  lastTimeZone = getBrowserTimeZone();
  resetEventForm();
  await persist("Local draft reset.");
});

eventList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-id]");
  if (!button) return;
  timeline.events = timeline.events.filter((item) => item.id !== button.dataset.deleteId);
  lastTimeZone = getLastEventTimeZone(timeline) || lastTimeZone;
  await persist("Event deleted.");
});

async function persist(message) {
  timeline.title = titleInput.value.trim() || timeline.title || "Untitled timeline";
  timeline = normalizeTimeline(await saveActiveTimeline(timeline));
  render();
  setStatus(message);
}

function populateEventTypes() {
  typeInput.innerHTML = EVENT_TYPES
    .map((type) => `<option value="${escapeHtml(type.value)}">${escapeHtml(type.label)}</option>`)
    .join("");
}

function populateTimeZones() {
  tzInput.innerHTML = getAvailableTimeZones()
    .map((zone) => `<option value="${escapeHtml(zone)}">${escapeHtml(zone)}</option>`)
    .join("");
}

function populateFieldPresets() {
  fieldPresetInput.innerHTML = FIELD_PRESETS
    .map((field) => `<option value="${escapeHtml(field.key)}">${escapeHtml(field.label)}</option>`)
    .join("");
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
      <div class="event-date">${escapeHtml(formatDisplayTimestamp(event.timestamp))}</div>
      <div class="event-summary">
        ${renderEventImage(event)}
        <div class="event-name">${escapeHtml(getEventTitle(event))}</div>
        <div class="small">${escapeHtml(getEventTypeLabel(event.type))}${event.location ? ` / ${escapeHtml(event.location)}` : ""}</div>
        ${renderImageLink(event.imageLink)}
        ${renderFieldSummary(event.fields)}
      </div>
      <button type="button" data-delete-id="${escapeHtml(event.id)}">Delete</button>
    `;
    eventList.append(row);
  }
}

function renderEventImage(event) {
  if (!event.image?.dataUrl) return "";
  return `<img class="event-thumb" src="${escapeHtml(event.image.dataUrl)}" alt="">`;
}

function renderImageLink(imageLink) {
  if (!imageLink) return "";
  return `<a class="small" href="${escapeHtml(imageLink)}" target="_blank" rel="noreferrer">Image link</a>`;
}

function renderDraftFields() {
  customFields.innerHTML = "";

  if (draftFields.length === 0) {
    customFields.innerHTML = `<div class="empty-state compact">No extra fields on this draft event.</div>`;
    return;
  }

  for (const field of draftFields) {
    const row = document.createElement("div");
    row.className = "custom-field-row";
    row.innerHTML = `
      <label for="field-${escapeHtml(field.id)}">${escapeHtml(field.label)}</label>
      <input id="field-${escapeHtml(field.id)}" type="${field.type === "url" ? "url" : "text"}" value="${escapeHtml(field.value)}" data-field-value="${escapeHtml(field.id)}">
      <button type="button" data-remove-field="${escapeHtml(field.id)}">Remove</button>
    `;
    customFields.append(row);
  }
}

function renderImagePreview() {
  imagePreview.innerHTML = "";

  if (!draftImage) {
    imagePreview.innerHTML = `<div class="empty-state compact">No image attached to this draft event.</div>`;
    return;
  }

  imagePreview.innerHTML = `
    <div class="attached-image">
      <img src="${escapeHtml(draftImage.dataUrl)}" alt="">
      <div>
        <strong>${escapeHtml(draftImage.originalName || "Attached image")}</strong>
        <div class="small">${draftImage.width} x ${draftImage.height} JPEG</div>
      </div>
      <button type="button" id="remove-image">Remove</button>
    </div>
  `;

  imagePreview.querySelector("#remove-image").addEventListener("click", () => {
    draftImage = null;
    renderImagePreview();
    setStatus("Image removed from draft event.");
  });
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

function resetEventForm() {
  typeInput.value = "life";
  eventTitleInput.value = "";
  dateInput.value = new Date().toISOString().slice(0, 10);
  timeInput.value = "";
  tzInput.value = lastTimeZone;
  locationInput.value = "";
  imageLinkInput.value = "";
  imageFileInput.value = "";
  draftImage = null;
  draftFields = [];
  renderImagePreview();
  renderDraftFields();
}

async function setDraftImageFromFile(file) {
  try {
    setStatus("Encoding image...");
    draftImage = await encodeImageFile(file);
    renderImagePreview();
    setStatus("Image attached as resized JPEG with metadata removed.");
  } catch (error) {
    setStatus(`Image failed: ${error.message}`);
  }
}

async function encodeImageFile(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Selected file is not an image.");
  }

  const image = await loadImage(file);
  const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, 960);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return {
    id: crypto.randomUUID(),
    mimeType: "image/jpeg",
    dataUrl: canvas.toDataURL("image/jpeg", 0.72),
    width,
    height,
    originalName: file.name || "pasted-image",
    encodedAt: new Date().toISOString()
  };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Browser could not decode that image."));
    };
    image.src = url;
  });
}

function fitWithin(sourceWidth, sourceHeight, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
}

function getImageFileFromClipboard(clipboardData) {
  const file = [...(clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));
  if (file) return file;

  const imageItem = [...(clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
  return imageItem?.getAsFile() || null;
}

function syncDraftFieldValues() {
  for (const input of customFields.querySelectorAll("[data-field-value]")) {
    const field = draftFields.find((item) => item.id === input.dataset.fieldValue);
    if (field) field.value = input.value;
  }
}

function getLastEventTimeZone(document) {
  const sortedEvents = sortEvents(document.events || []);
  return getEventTimeZone(sortedEvents.at(-1));
}

function setStatus(message) {
  status.textContent = message;
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
