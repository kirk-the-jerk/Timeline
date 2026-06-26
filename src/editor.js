import { clearActiveTimeline, loadActiveTimeline, saveActiveTimeline } from "./db.js";
import { createTimelineLoadController, showDialog } from "./fileLoad.js";
import { downloadStandaloneHtml } from "./htmlExport.js";
import {
  canRenderImageMedia,
  createCustomField,
  createEmptyTimeline,
  createEvent,
  createImageMedia,
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
  resolveEventImage,
  sortEvents
} from "./timeline.js";

const form = document.querySelector("#timeline-form");
const formTitle = document.querySelector("#event-form-title");
const titleDisplay = document.querySelector("#title-display");
const titleText = document.querySelector("#timeline-title-text");
const editTitleTrigger = document.querySelector("#edit-title-trigger");
const titleInput = document.querySelector("#timeline-title");
const titleEditControls = document.querySelector("#title-edit-controls");
const saveTitleButton = document.querySelector("#save-title");
const cancelTitleButton = document.querySelector("#cancel-title");
const topbar = document.querySelector(".topbar");
const headerActions = document.querySelector("#header-actions");
const openSaveDialogButton = document.querySelector("#open-save-dialog");
const saveDialog = document.querySelector("#save-dialog");
const closeSaveDialogButton = document.querySelector("#close-save-dialog");
const saveDialogStatus = document.querySelector("#save-dialog-status");
const openLoadFileButton = document.querySelector("#open-load-file");
const loadFileInput = document.querySelector("#load-file");
const loadDialog = document.querySelector("#load-dialog");
const closeLoadDialogButton = document.querySelector("#close-load-dialog");
const loadProgressBar = document.querySelector("#load-progress-bar");
const loadLog = document.querySelector("#load-log");
const clearTimelineButton = document.querySelector("#clear-timeline");
const typeInput = document.querySelector("#event-type");
const eventTitleInput = document.querySelector("#event-title");
const dateInput = document.querySelector("#event-date");
const datetimeOptions = document.querySelector("#datetime-options");
const datetimeSummary = document.querySelector("#datetime-summary");
const timeInput = document.querySelector("#event-time");
const tzInput = document.querySelector("#event-tz");
const locationOptions = document.querySelector("#location-options");
const locationSummary = document.querySelector("#location-summary");
const locationInput = document.querySelector("#event-location");
const imageOptions = document.querySelector("#image-options");
const imageSummary = document.querySelector("#image-summary");
const imageLinkInput = document.querySelector("#event-image-link");
const imageFileInput = document.querySelector("#event-image-file");
const imageDropZone = document.querySelector("#image-drop-zone");
const imagePreview = document.querySelector("#image-preview");
const fieldsOptions = document.querySelector("#fields-options");
const fieldsSummary = document.querySelector("#fields-summary");
const fieldPresetInput = document.querySelector("#field-preset");
const addPresetFieldButton = document.querySelector("#add-preset-field");
const customFieldLabelInput = document.querySelector("#custom-field-label");
const addCustomFieldButton = document.querySelector("#add-custom-field");
const customFields = document.querySelector("#custom-fields");
const submitEventButton = document.querySelector("#submit-event");
const cancelEditButton = document.querySelector("#cancel-edit");
const addDummyButton = document.querySelector("#add-dummy");
const eventList = document.querySelector("#event-list");
const status = document.querySelector("#status");

let timeline = createEmptyTimeline();
let draftFields = [];
let draftImage = null;
let lastTimeZone = getBrowserTimeZone();
let editingEventId = null;
let isEditingTitle = false;

init();

createTimelineLoadController({
  dialog: loadDialog,
  closeButton: closeLoadDialogButton,
  openButton: openLoadFileButton,
  fileInput: loadFileInput,
  dropTargets: [topbar],
  dragClassTarget: headerActions,
  progressBar: loadProgressBar,
  log: loadLog,
  onTimelineLoaded: async (timelineDocument, { file, warnings }) => {
    timeline = timelineDocument;
    lastTimeZone = getLastEventTimeZone(timeline) || lastTimeZone;
    setTitleEditing(false, { focus: false });
    resetEventForm();
    await persist(warnings.length > 0
      ? `Loaded ${file.name} with ${warnings.length} schema warning${warnings.length === 1 ? "" : "s"}.`
      : `Loaded ${file.name}.`);
  },
  onStatus: setStatus
});

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

  const previousEvent = editingEventId
    ? timeline.events.find((item) => item.id === editingEventId)
    : null;
  if (editingEventId && !previousEvent) {
    resetEventForm();
    render();
    setStatus("Could not update because the event no longer exists.");
    return;
  }

  const imageId = draftImage?.id || "";
  if (draftImage && !timeline.media.some((item) => item.id === draftImage.id)) {
    timeline.media = [...timeline.media, draftImage];
  }

  const savedEvent = createEvent({
    type: typeInput.value,
    title: eventTitleInput.value,
    date: dateInput.value,
    time: timeInput.value || "00:00",
    tz: tzInput.value || lastTimeZone,
    location: locationInput.value,
    imageId,
    imageLink: imageLinkInput.value,
    fields: draftFields
  });

  const nextEvent = previousEvent
    ? {
      ...previousEvent,
      ...savedEvent,
      id: previousEvent.id
    }
    : savedEvent;

  lastTimeZone = getEventTimeZone(nextEvent) || lastTimeZone;
  timeline.events = previousEvent
    ? sortEvents(timeline.events.map((item) => item.id === previousEvent.id ? nextEvent : item))
    : sortEvents([...timeline.events, nextEvent]);
  if (previousEvent) removeUnusedMediaForEvent(previousEvent);
  resetEventForm();
  await persist(previousEvent ? "Event updated." : "Event added.");
  eventTitleInput.focus();
});

editTitleTrigger.addEventListener("click", () => {
  setTitleEditing(true);
});

saveTitleButton.addEventListener("click", async () => {
  await commitTimelineTitle();
});

cancelTitleButton.addEventListener("click", () => {
  setTitleEditing(false);
  setStatus("Title edit canceled.");
});

titleInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    await commitTimelineTitle();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    setTitleEditing(false);
    setStatus("Title edit canceled.");
  }
});

openSaveDialogButton.addEventListener("click", () => {
  saveDialogStatus.textContent = "";
  showDialog(saveDialog);
});

closeSaveDialogButton.addEventListener("click", () => {
  saveDialog.close();
});

saveDialog.addEventListener("click", (event) => {
  if (event.target === saveDialog) saveDialog.close();
});

saveDialog.addEventListener("click", (event) => {
  if (event.target.closest(".info-button")) return;
  const option = event.target.closest("[data-save-format]");
  if (!option) return;
  saveTimelineAs(option.dataset.saveFormat);
});

clearTimelineButton.addEventListener("click", async () => {
  await clearTimelineDraft();
});

timeInput.addEventListener("input", renderOptionalSummaries);
tzInput.addEventListener("change", renderOptionalSummaries);
locationInput.addEventListener("input", renderOptionalSummaries);
imageLinkInput.addEventListener("input", renderOptionalSummaries);

addPresetFieldButton.addEventListener("click", () => {
  const field = makeFieldFromPreset(fieldPresetInput.value);
  if (!field) return;
  draftFields = [...draftFields, field];
  fieldsOptions.open = true;
  renderDraftFields();
});

addCustomFieldButton.addEventListener("click", () => {
  const field = createCustomField(customFieldLabelInput.value);
  draftFields = [...draftFields, field];
  customFieldLabelInput.value = "";
  fieldsOptions.open = true;
  renderDraftFields();
});

customFields.addEventListener("input", (event) => {
  const input = event.target.closest("[data-field-value]");
  if (!input) return;
  const field = draftFields.find((item) => item.id === input.dataset.fieldValue);
  if (field) field.value = input.value;
  renderOptionalSummaries();
});

customFields.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-field]");
  if (!button) return;
  draftFields = draftFields.filter((field) => field.id !== button.dataset.removeField);
  renderDraftFields();
});

cancelEditButton.addEventListener("click", () => {
  resetEventForm();
  render();
  setStatus("Edit canceled.");
  eventTitleInput.focus();
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

async function clearTimelineDraft() {
  timeline = createEmptyTimeline();
  await clearActiveTimeline();
  lastTimeZone = getBrowserTimeZone();
  setTitleEditing(false);
  resetEventForm();
  await persist("Local draft reset.");
}

async function saveTimelineAs(format) {
  timeline.title = getTimelineTitleValue();

  if (format === "json") {
    downloadTimeline(timeline);
    saveDialog.close();
    setStatus("JSON export started.");
    return;
  }

  if (format === "html-single") {
    downloadStandaloneHtml(timeline);
    saveDialog.close();
    setStatus("Standalone HTML export started.");
    return;
  }

  if (format === "zip") {
    saveDialogStatus.textContent = "ZIP export is not implemented yet.";
    setStatus("ZIP export is not implemented yet.");
    return;
  }

  if (format === "html-images") {
    saveDialogStatus.textContent = "HTML + images export is not implemented yet.";
    setStatus("HTML + images export is not implemented yet.");
  }
}

eventList.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-id]");
  if (editButton) {
    startEditingEvent(editButton.dataset.editId);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-id]");
  if (!deleteButton) return;
  const deletedEvent = timeline.events.find((item) => item.id === deleteButton.dataset.deleteId);
  timeline.events = timeline.events.filter((item) => item.id !== deleteButton.dataset.deleteId);
  removeUnusedMediaForEvent(deletedEvent);
  if (editingEventId === deletedEvent?.id) resetEventForm();
  lastTimeZone = getLastEventTimeZone(timeline) || lastTimeZone;
  await persist("Event deleted.");
});

async function persist(message) {
  timeline.title = getTimelineTitleValue();
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
  renderTimelineTitle();
  eventList.innerHTML = "";

  if (timeline.events.length === 0) {
    eventList.innerHTML = `<div class="empty-state">No events yet. Add one manually or create a dummy event.</div>`;
    return;
  }

  for (const event of sortEvents(timeline.events)) {
    const row = document.createElement("article");
    row.className = event.id === editingEventId ? "event-item editing" : "event-item";
    row.innerHTML = `
      <div class="event-date">${escapeHtml(formatDisplayTimestamp(event.timestamp))}</div>
      <div class="event-summary">
        ${renderEventImage(event)}
        <div class="event-name">${escapeHtml(getEventTitle(event))}</div>
        <div class="small">${escapeHtml(getEventTypeLabel(event.type))}${event.location ? ` / ${escapeHtml(event.location)}` : ""}</div>
        ${renderImageLink(event.imageLink)}
        ${renderFieldSummary(event.fields)}
      </div>
      <div class="event-actions">
        <button type="button" data-edit-id="${escapeHtml(event.id)}">Edit</button>
        <button type="button" data-delete-id="${escapeHtml(event.id)}">Delete</button>
      </div>
    `;
    eventList.append(row);
  }
}

function renderTimelineTitle() {
  const title = timeline.title || "Untitled timeline";
  titleText.textContent = title;
  if (!isEditingTitle) titleInput.value = title;
}

function renderEventImage(event) {
  const image = resolveEventImage(timeline, event);
  if (!canRenderImageMedia(image)) return "";
  return `<img class="event-thumb" src="${escapeHtml(image.dataUrl)}" alt="">`;
}

function renderImageLink(imageLink) {
  if (!imageLink) return "";
  return `<a class="small" href="${escapeHtml(imageLink)}" target="_blank" rel="noreferrer">Image link</a>`;
}

function renderDraftFields() {
  customFields.innerHTML = "";

  if (draftFields.length === 0) {
    customFields.innerHTML = `<div class="empty-state compact">No extra fields on this draft event.</div>`;
    renderOptionalSummaries();
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
  renderOptionalSummaries();
}

function renderImagePreview() {
  imagePreview.innerHTML = "";

  if (!draftImage) {
    imagePreview.innerHTML = `<div class="empty-state compact">No image attached to this draft event.</div>`;
    renderOptionalSummaries();
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
  renderOptionalSummaries();
}

function renderOptionalSummaries() {
  const time = timeInput.value;
  const location = locationInput.value.trim();
  const imageLink = imageLinkInput.value.trim();
  const populatedFieldCount = draftFields.filter((field) => field.value).length;

  datetimeSummary.textContent = time ? `${time} ${tzInput.value}` : "No time set";
  locationSummary.textContent = location || "No location";
  imageSummary.textContent = draftImage
    ? "Image attached"
    : imageLink
      ? "Image link set"
      : "No image";
  fieldsSummary.textContent = draftFields.length === 0
    ? "No extra fields"
    : `${draftFields.length} field${draftFields.length === 1 ? "" : "s"}${populatedFieldCount > 0 ? `, ${populatedFieldCount} filled` : ""}`;
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
  editingEventId = null;
  formTitle.textContent = "Add event";
  submitEventButton.textContent = "Add event";
  cancelEditButton.hidden = true;
  addDummyButton.hidden = false;
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
  closeOptionalSections();
  renderImagePreview();
  renderDraftFields();
}

async function commitTimelineTitle() {
  timeline.title = titleInput.value.trim() || "Untitled timeline";
  setTitleEditing(false);
  await persist("Title saved.");
}

function setTitleEditing(isEditing, { focus = true } = {}) {
  isEditingTitle = isEditing;
  titleDisplay.hidden = isEditing;
  editTitleTrigger.hidden = isEditing;
  titleEditControls.hidden = !isEditing;
  renderTimelineTitle();
  if (!focus) return;
  if (isEditing) {
    titleInput.focus();
    titleInput.select();
  } else {
    editTitleTrigger.focus();
  }
}

function getTimelineTitleValue() {
  const title = isEditingTitle ? titleInput.value : timeline.title;
  return String(title || "").trim() || "Untitled timeline";
}

function closeOptionalSections() {
  datetimeOptions.open = false;
  locationOptions.open = false;
  imageOptions.open = false;
  fieldsOptions.open = false;
}

function openPopulatedOptionalSections() {
  datetimeOptions.open = Boolean(timeInput.value);
  locationOptions.open = Boolean(locationInput.value.trim());
  imageOptions.open = Boolean(imageLinkInput.value.trim() || draftImage);
  fieldsOptions.open = draftFields.length > 0;
}

function startEditingEvent(eventId) {
  const event = timeline.events.find((item) => item.id === eventId);
  if (!event) {
    setStatus("Could not edit because the event no longer exists.");
    return;
  }

  editingEventId = event.id;
  formTitle.textContent = "Edit event";
  submitEventButton.textContent = "Save changes";
  cancelEditButton.hidden = false;
  addDummyButton.hidden = true;

  typeInput.value = event.type;
  eventTitleInput.value = getEventTitle(event);
  dateInput.value = event.timestamp?.date || new Date().toISOString().slice(0, 10);
  timeInput.value = event.timestamp?.time === "00:00" ? "" : event.timestamp?.time || "";
  tzInput.value = getEventTimeZone(event) || lastTimeZone;
  locationInput.value = event.location || "";
  imageLinkInput.value = event.imageLink || "";
  imageFileInput.value = "";
  draftImage = resolveEventImage(timeline, event) || null;
  draftFields = Array.isArray(event.fields)
    ? event.fields.map((field) => ({ ...field }))
    : [];
  renderImagePreview();
  renderDraftFields();
  openPopulatedOptionalSections();
  eventTitleInput.focus();
  setStatus("Editing event. Save changes or cancel to return to adding events.");
}

async function setDraftImageFromFile(file) {
  try {
    setStatus("Encoding image...");
    const media = createImageMedia(await encodeImageFile(file));
    if (!media) {
      throw new Error("Encoded image did not pass schema checks.");
    }
    draftImage = media;
    imageOptions.open = true;
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

function removeUnusedMediaForEvent(deletedEvent) {
  const imageId = deletedEvent?.imageId;
  if (!imageId) return;
  const stillUsed = timeline.events.some((event) => event.imageId === imageId);
  if (!stillUsed) {
    timeline.media = timeline.media.filter((item) => item.id !== imageId);
  }
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
