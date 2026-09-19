import { clearActiveTimeline, loadActiveTimeline, saveActiveTimeline } from "./db.js";
import { createTimelineLoadController, LoadCancelledError, showDialog } from "./fileLoad.js";
import { downloadStandaloneHtml } from "./htmlExport.js";
import { createCoordinatesField } from "./coordinatesField.js";
import { initNav } from "./nav.js";
import { getPlayerType, PLAYER_TYPES } from "./players.js";
import {
  canRenderImageMedia,
  createCollection,
  createCustomField,
  createCustomEventType,
  createEmptyTimeline,
  createEvent,
  createImageMedia,
  DEFAULT_EVENT_TYPE,
  downloadTimeline,
  EVENT_TYPES,
  FIELD_PRESETS,
  formatDisplayDate,
  getAvailableTimeZones,
  getBrowserTimeZone,
  getCollections,
  getEventCollections,
  getEventTimeZone,
  getEventTitle,
  getEventTypeEmoji,
  getEventTypeLabel,
  getEventTypes,
  getHiddenEventTypes,
  isEndBeforeStart,
  makeFieldFromPreset,
  normalizeTimeline,
  resolveEventImages,
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
const saveForm = document.querySelector("#save-form");
const closeSaveDialogButton = document.querySelector("#close-save-dialog");
const saveDialogStatus = document.querySelector("#save-dialog-status");
const exportTimelineTitleInput = document.querySelector("#export-timeline-title");
const htmlPlayerField = document.querySelector("#html-player-field");
const htmlPlayerTypeInput = document.querySelector("#html-player-type");
const exportScopeInput = document.querySelector("#export-scope");
const exportCollectionsOptions = document.querySelector("#export-collections-options");
const exportCollectionsSummary = document.querySelector("#export-collections-summary");
const exportCollections = document.querySelector("#export-collections");
const exportEventsOptions = document.querySelector("#export-events-options");
const exportEventsSummary = document.querySelector("#export-events-summary");
const exportEventTypes = document.querySelector("#export-event-types");
const selectAllExportCollectionsButton = document.querySelector("#select-all-export-collections");
const clearExportCollectionsButton = document.querySelector("#clear-export-collections");
const selectAllExportEventsButton = document.querySelector("#select-all-export-events");
const clearExportEventsButton = document.querySelector("#clear-export-events");
const saveSubmitButton = document.querySelector("#save-submit");
const openLoadFileButton = document.querySelector("#open-load-file");
const loadFileInput = document.querySelector("#load-file");
const loadDialog = document.querySelector("#load-dialog");
const closeLoadDialogButton = document.querySelector("#close-load-dialog");
const loadProgressBar = document.querySelector("#load-progress-bar");
const loadLog = document.querySelector("#load-log");
const clearTimelineButton = document.querySelector("#clear-timeline");
const typeInput = document.querySelector("#event-type");
const eventTypeOptions = document.querySelector("#event-type-options");
const eventTypeSummary = document.querySelector("#event-type-summary");
const customEventTypeEmojiInput = document.querySelector("#custom-event-type-emoji");
const customEventTypeLabelInput = document.querySelector("#custom-event-type-label");
const addCustomEventTypeButton = document.querySelector("#add-custom-event-type");
const hideEventTypeButton = document.querySelector("#hide-event-type");
const showHiddenEventTypesButton = document.querySelector("#show-hidden-event-types");
const hideEventTypeNote = document.querySelector("#hide-event-type-note");
const exportLinkWarning = document.querySelector("#export-link-warning");
const eventTitleInput = document.querySelector("#event-title");
const dateInput = document.querySelector("#event-date");
const endDateInput = document.querySelector("#event-end-date");
const datetimeOptions = document.querySelector("#datetime-options");
const datetimeSummary = document.querySelector("#datetime-summary");
const timeInput = document.querySelector("#event-time");
const endTimeInput = document.querySelector("#event-end-time");
const tzInput = document.querySelector("#event-tz");
const locationOptions = document.querySelector("#location-options");
const locationSummary = document.querySelector("#location-summary");
const locationInput = document.querySelector("#event-location");
const coordinatesField = createCoordinatesField({ onChange: () => renderOptionalSummaries() });
const collectionOptions = document.querySelector("#collection-options");
const collectionSummary = document.querySelector("#collection-summary");
const collectionInput = document.querySelector("#event-collection");
const collectionSuggestions = document.querySelector("#collection-suggestions");
const imageOptions = document.querySelector("#image-options");
const imageSummary = document.querySelector("#image-summary");
const imageLinkInput = document.querySelector("#event-image-link");
const addImageLinkButton = document.querySelector("#add-image-link");
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
const floatingAddEventButton = document.querySelector("#floating-add-event");
const appShell = document.querySelector(".app-shell");
const eventEditorShell = document.querySelector("#event-editor-shell");
const eventEditorPanel = document.querySelector(".event-editor-panel");
const eventEditorBackdrop = document.querySelector("#event-editor-backdrop");
const closeEventEditorButton = document.querySelector("#close-event-editor");
const eventList = document.querySelector("#event-list");
const toastRegion = document.querySelector("#toast-region");

let timeline = createEmptyTimeline();
let draftFields = [];
let draftImages = [];
let lastTimeZone = getBrowserTimeZone();
let editingEventId = null;
let isEditingTitle = false;
let exportEventTypeSelection = new Set();
let exportCollectionSelection = new Set();
let eventEditorReturnFocus = null;

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
  onTimelineLoaded: async (timelineDocument, { file, diagnostics }) => {
    if (hasDraftContent() && !window.confirm(
      `Opening ${file.name || "this file"} will replace your current draft `
      + `(${describeDraftContent()}). This can't be undone. Continue?`
    )) {
      throw new LoadCancelledError("Open cancelled. Your current draft was kept.");
    }
    timeline = timelineDocument;
    lastTimeZone = getLastEventTimeZone(timeline) || lastTimeZone;
    setTitleEditing(false, { focus: false });
    resetEventForm();
    const importStatus = loadedImportStatus(file, diagnostics);
    await persist(importStatus.message, importStatus.level);
  },
  onStatus: setStatus
});

async function init() {
  initNav();
  populateEventTypes();
  populateTimeZones();
  populateFieldPresets();
  populateHtmlPlayerTypes();

  try {
    timeline = await loadActiveTimeline();
    lastTimeZone = getLastEventTimeZone(timeline) || lastTimeZone;
    resetEventForm();
    render();
    setStatus("Loaded local draft from IndexedDB.");
  } catch (error) {
    setStatus(`Could not load local draft: ${error.message}`, "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  // A place that was just typed may still be on its way to coordinates.
  submitEventButton.disabled = true;
  try {
    await coordinatesField.settled();
  } finally {
    submitEventButton.disabled = false;
  }
  syncDraftFieldValues();
  syncDraftImageDetails();

  const previousEvent = editingEventId
    ? timeline.events.find((item) => item.id === editingEventId)
    : null;
  if (editingEventId && !previousEvent) {
    resetEventForm();
    render();
    setStatus("Could not update because the event no longer exists.", "error");
    return;
  }

  if (!coordinatesField.commit()) {
    locationOptions.open = true;
    document.querySelector("#event-coordinates").focus();
    return;
  }

  for (const image of draftImages) {
    if (image.kind !== "embedded" || !image.media) continue;
    if (!timeline.media.some((item) => item.id === image.media.id)) {
      timeline.media = [...timeline.media, image.media];
    }
  }

  const collectionIds = resolveCollectionIds(collectionInput.value);

  const start = { date: dateInput.value, time: timeInput.value || "00:00", tz: tzInput.value || lastTimeZone };
  if (endDateInput.value && isEndBeforeStart(start, { date: endDateInput.value, time: endTimeInput.value || "00:00", tz: start.tz })) {
    setStatus("The end must not be earlier than the start.", "error");
    endDateInput.focus();
    return;
  }

  const savedEvent = createEvent({
    type: typeInput.value,
    title: eventTitleInput.value,
    date: dateInput.value,
    time: timeInput.value || "00:00",
    tz: tzInput.value || lastTimeZone,
    endDate: endDateInput.value,
    endTime: endTimeInput.value || "00:00",
    location: locationInput.value,
    geo: coordinatesField.getGeo(),
    images: draftImages.map(toEventImage),
    fields: draftFields,
    collectionIds,
    collections: getCollections(timeline),
    eventTypes: getEventTypes(timeline)
  });

  const nextEvent = previousEvent
    ? {
      ...previousEvent,
      ...savedEvent,
      id: previousEvent.id
    }
    : savedEvent;
  if (!savedEvent.endTimestamp) delete nextEvent.endTimestamp;
  if (!savedEvent.geo) delete nextEvent.geo;

  lastTimeZone = getEventTimeZone(nextEvent) || lastTimeZone;
  timeline.events = previousEvent
    ? sortEvents(timeline.events.map((item) => item.id === previousEvent.id ? nextEvent : item))
    : sortEvents([...timeline.events, nextEvent]);
  if (previousEvent) removeUnusedMediaForEvent(previousEvent);
  resetEventForm({ preserveEvent: previousEvent ? null : nextEvent });
  await persist(previousEvent ? "Event updated." : "Event added.");
  if (previousEvent) {
    closeEventEditor({ reset: false, restoreFocus: false });
    return;
  }
  openEventEditor({ focus: false });
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
  prepareSaveDialog();
  showDialog(saveDialog);
});

closeSaveDialogButton.addEventListener("click", () => {
  saveDialog.close();
});

saveDialog.addEventListener("click", (event) => {
  if (event.target === saveDialog) saveDialog.close();
});

saveForm.addEventListener("change", () => {
  updateSaveFormatControls();
  updateExportControls();
});

exportEventTypes.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-export-event-type]");
  if (!checkbox) return;
  if (checkbox.checked) {
    exportEventTypeSelection.add(checkbox.value);
  } else {
    exportEventTypeSelection.delete(checkbox.value);
  }
  renderExportEventTypeControls();
});

exportCollections.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-export-collection]");
  if (!checkbox) return;
  if (checkbox.checked) {
    exportCollectionSelection.add(checkbox.value);
  } else {
    exportCollectionSelection.delete(checkbox.value);
  }
  renderExportCollectionControls();
});

selectAllExportCollectionsButton.addEventListener("click", () => {
  exportCollectionSelection = new Set(getExportableCollections().map((collection) => collection.id));
  renderExportCollectionControls();
});

clearExportCollectionsButton.addEventListener("click", () => {
  exportCollectionSelection = new Set();
  renderExportCollectionControls();
});

selectAllExportEventsButton.addEventListener("click", () => {
  exportEventTypeSelection = new Set(getExportableEventTypes().map((eventType) => eventType.value));
  renderExportEventTypeControls();
});

clearExportEventsButton.addEventListener("click", () => {
  exportEventTypeSelection = new Set();
  renderExportEventTypeControls();
});

saveForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const selectedFormat = getSelectedSaveFormat();
  if (!selectedFormat) return;
  saveTimelineAs(selectedFormat);
});

clearTimelineButton.addEventListener("click", async () => {
  if (hasDraftContent() && !window.confirm(
    `Clear the whole draft (${describeDraftContent()})? This can't be undone.`
  )) {
    return;
  }
  await clearTimelineDraft();
});

floatingAddEventButton.addEventListener("click", () => {
  startAddingEvent();
});

closeEventEditorButton.addEventListener("click", () => {
  closeEventEditor();
});

eventEditorBackdrop.addEventListener("click", () => {
  closeEventEditor();
});

addCustomEventTypeButton.addEventListener("click", async () => {
  await addCustomEventTypeToTimeline();
});

customEventTypeLabelInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  await addCustomEventTypeToTimeline();
});

hideEventTypeButton.addEventListener("click", async () => {
  await hideSelectedEventType();
});

showHiddenEventTypesButton.addEventListener("click", async () => {
  await showHiddenEventTypes();
});

typeInput.addEventListener("change", updateHideEventTypeControls);

timeInput.addEventListener("input", renderOptionalSummaries);
endTimeInput.addEventListener("input", renderOptionalSummaries);
dateInput.addEventListener("input", syncEndDateMin);
endDateInput.addEventListener("input", renderOptionalSummaries);
tzInput.addEventListener("change", renderOptionalSummaries);
locationInput.addEventListener("input", renderOptionalSummaries);
collectionInput.addEventListener("input", renderOptionalSummaries);
imageLinkInput.addEventListener("input", renderOptionalSummaries);
imageLinkInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addDraftImageLink();
});
addImageLinkButton.addEventListener("click", () => addDraftImageLink());

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
  const files = [...(imageFileInput.files || [])].filter((file) => file.type.startsWith("image/"));
  if (files.length === 0) return;
  await addDraftImagesFromFiles(files);
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
  const files = [...event.dataTransfer.files].filter((item) => item.type.startsWith("image/"));
  if (files.length === 0) {
    setStatus("Drop did not include an image file.", "warning");
    return;
  }
  await addDraftImagesFromFiles(files);
});

imagePreview.addEventListener("input", (event) => {
  const captionInput = event.target.closest("[data-image-caption]");
  if (!captionInput) return;
  const image = draftImages.find((item) => item.id === captionInput.dataset.imageCaption);
  if (image) image.caption = captionInput.value;
});

imagePreview.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-image]");
  if (removeButton) {
    draftImages = draftImages.filter((image) => image.id !== removeButton.dataset.removeImage);
    renderImagePreview();
    setStatus("Image removed from gallery.");
    return;
  }

  const moveButton = event.target.closest("[data-move-image]");
  if (!moveButton) return;
  const index = draftImages.findIndex((image) => image.id === moveButton.dataset.moveImage);
  const direction = moveButton.dataset.direction === "up" ? -1 : 1;
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= draftImages.length) return;
  const nextImages = [...draftImages];
  [nextImages[index], nextImages[nextIndex]] = [nextImages[nextIndex], nextImages[index]];
  draftImages = nextImages;
  renderImagePreview();
  setStatus("Image order updated.");
});

document.addEventListener("paste", async (event) => {
  if (!isEventEditorOpen()) return;

  const file = getImageFileFromClipboard(event.clipboardData);
  if (file) {
    await addDraftImagesFromFiles([file]);
    return;
  }

  const text = event.clipboardData?.getData("text/plain") || "";
  if (isSafeHttpUrl(text)) addDraftImageLink(text);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !isEventEditorOpen()) return;
  event.preventDefault();
  closeEventEditor();
});

function hasDraftContent() {
  return timeline.events.length > 0 || timeline.media.length > 0;
}

function describeDraftContent() {
  const count = timeline.events.length;
  return `${count} event${count === 1 ? "" : "s"}`;
}

async function clearTimelineDraft() {
  timeline = createEmptyTimeline();
  await clearActiveTimeline();
  lastTimeZone = getBrowserTimeZone();
  setTitleEditing(false);
  resetEventForm();
  await persist("Local draft reset.");
}

async function addCustomEventTypeToTimeline() {
  const label = customEventTypeLabelInput.value.trim();
  if (!label) {
    setStatus("Custom event type needs a name.", "warning");
    customEventTypeLabelInput.focus();
    return;
  }

  const eventType = createCustomEventType({
    label,
    emoji: customEventTypeEmojiInput.value
  });
  const existingTypes = getEventTypes(timeline);
  const existingMatch = existingTypes.find((type) => type.value === eventType.value);
  if (existingMatch) {
    typeInput.value = existingMatch.value;
    customEventTypeEmojiInput.value = "";
    customEventTypeLabelInput.value = "";
    eventTypeOptions.open = false;
    renderOptionalSummaries();
    setStatus(`${existingMatch.label} is already available.`);
    return;
  }

  timeline.eventTypes = [...existingTypes, eventType];
  typeInput.value = eventType.value;
  customEventTypeEmojiInput.value = "";
  customEventTypeLabelInput.value = "";
  eventTypeOptions.open = false;
  await persist("Event type added.");
  typeInput.value = eventType.value;
  populateEventTypes(eventType.value);
}

function canHideEventType(value) {
  return value !== DEFAULT_EVENT_TYPE
    && EVENT_TYPES.some((eventType) => eventType.value === value)
    && !timeline.events.some((event) => event.type === value);
}

function updateHideEventTypeControls() {
  const value = typeInput.value;
  const isBuiltIn = EVENT_TYPES.some((eventType) => eventType.value === value);
  hideEventTypeButton.disabled = !canHideEventType(value);
  hideEventTypeNote.textContent = !isBuiltIn || value === DEFAULT_EVENT_TYPE
    ? "Only built-in types other than Misc can be hidden."
    : canHideEventType(value) ? "" : "Events still use this type.";
  const hiddenCount = timeline.hiddenEventTypes?.length || 0;
  showHiddenEventTypesButton.hidden = hiddenCount === 0;
  showHiddenEventTypesButton.textContent = `Show hidden types (${hiddenCount})`;
}

async function hideSelectedEventType() {
  const value = typeInput.value;
  if (!canHideEventType(value)) return;
  const label = getEventTypeLabel(value, timeline);
  timeline.eventTypes = getEventTypes(timeline).filter((eventType) => eventType.value !== value);
  timeline.hiddenEventTypes = [...(timeline.hiddenEventTypes || []), value];
  await persist(`${label} type hidden.`);
  populateEventTypes(DEFAULT_EVENT_TYPE);
}

async function showHiddenEventTypes() {
  delete timeline.hiddenEventTypes;
  timeline.eventTypes = getEventTypes(timeline);
  await persist("Hidden event types restored.");
  populateEventTypes();
}

async function saveTimelineAs(format) {
  const exportTimeline = getExportTimeline();
  if (!exportTimeline) return;

  if (format === "json") {
    downloadTimeline(exportTimeline);
    saveDialog.close();
    setStatus("JSON export started.");
    return;
  }

  if (format === "html-single") {
    const player = getPlayerType(htmlPlayerTypeInput.value);
    try {
      await downloadStandaloneHtml(exportTimeline, player.value);
    } catch (error) {
      setStatus(`HTML export failed: ${error.message}`);
      return;
    }
    saveDialog.close();
    setStatus(`${player.label} HTML export started.`);
  }
}

function prepareSaveDialog() {
  exportTimelineTitleInput.value = getTimelineTitleValue();
  exportScopeInput.value = "all";
  exportEventsOptions.open = false;
  exportCollectionsOptions.open = false;
  exportEventTypeSelection = new Set(getExportableEventTypes().map((eventType) => eventType.value));
  exportCollectionSelection = new Set(getExportableCollections().map((collection) => collection.id));
  renderExportEventTypeControls();
  renderExportCollectionControls();
  updateSaveFormatControls();
  updateExportControls();
}

function getExportTimelineTitleValue() {
  return exportTimelineTitleInput.value.trim() || "Untitled timeline";
}

function getSelectedSaveFormat() {
  return saveForm.querySelector('input[name="save-format"]:checked')?.value || "";
}

function updateSaveFormatControls() {
  htmlPlayerField.hidden = !isHtmlSaveFormat(getSelectedSaveFormat());
  updateLinkedImageWarning();
}

// Events the current scope selection would export, without validating it.
function getScopedExportEvents() {
  const scope = getSelectedExportScope();
  if (scope === "collection") {
    const collectionIds = getSelectedExportCollections();
    return timeline.events.filter((event) => event.collectionIds?.some((id) => collectionIds.has(id)));
  }
  if (scope === "event-types") {
    const types = getSelectedExportEventTypes();
    return timeline.events.filter((event) => types.has(event.type));
  }
  return timeline.events;
}

function updateLinkedImageWarning() {
  const linkedHosts = new Set();
  let linkedCount = 0;
  if (isHtmlSaveFormat(getSelectedSaveFormat())) {
    for (const event of getScopedExportEvents()) {
      for (const image of event.images || []) {
        if (image.kind !== "link") continue;
        linkedCount += 1;
        try {
          linkedHosts.add(new URL(image.url).hostname);
        } catch {
          // Unparseable URLs are dropped by normalization; nothing to name.
        }
      }
    }
  }

  exportLinkWarning.hidden = linkedCount === 0;
  if (linkedCount === 0) {
    exportLinkWarning.textContent = "";
    return;
  }
  const hosts = [...linkedHosts].join(", ");
  exportLinkWarning.textContent = `${linkedCount} linked image${linkedCount === 1 ? "" : "s"} (${hosts}) are not embedded. `
    + "Whoever opens the saved file will load them from those sites, which can see the request. "
    + "Re-add them as uploaded images to embed them.";
}

function updateExportControls() {
  const scope = getSelectedExportScope();
  exportEventsOptions.hidden = scope !== "event-types";
  exportCollectionsOptions.hidden = scope !== "collection";

  if (scope === "event-types") {
    renderExportEventTypeControls();
    return;
  }

  if (scope === "collection") {
    renderExportCollectionControls();
    return;
  }

  exportEventsSummary.textContent = "All events";
  exportCollectionsSummary.textContent = "All collections";
  saveDialogStatus.textContent = "";
  saveSubmitButton.disabled = false;
  updateLinkedImageWarning();
}

function isHtmlSaveFormat(format) {
  return format === "html-single";
}

function getSelectedExportScope() {
  return exportScopeInput.value || "all";
}

function getExportTimeline() {
  const scope = getSelectedExportScope();

  if (scope === "all") {
    return {
      ...timeline,
      title: getExportTimelineTitleValue()
    };
  }

  if (scope === "collection") {
    const selectedCollectionIds = getSelectedExportCollections();
    if (selectedCollectionIds.size === 0) {
      saveDialogStatus.textContent = "Select at least one collection to export.";
      setStatus("Select at least one collection to export.", "warning");
      return null;
    }

    const events = timeline.events
      .filter((event) => event.collectionIds?.some((id) => selectedCollectionIds.has(id)))
      .map((event) => ({
        ...event,
        collectionIds: (event.collectionIds || []).filter((id) => selectedCollectionIds.has(id))
      }));
    const usedTypes = new Set(events.map((event) => event.type));
    const eventTypes = getEventTypes(timeline).filter((eventType) => usedTypes.has(eventType.value));
    return {
      ...timeline,
      title: getExportTimelineTitleValue(),
      eventTypes,
      hiddenEventTypes: getHiddenEventTypes(eventTypes),
      collections: getCollections(timeline).filter((collection) => selectedCollectionIds.has(collection.id)),
      events
    };
  }

  const selectedTypes = getSelectedExportEventTypes();
  if (selectedTypes.size === 0) {
    saveDialogStatus.textContent = "Select at least one event type to export.";
    setStatus("Select at least one event type to export.", "warning");
    return null;
  }

  const events = timeline.events.filter((event) => selectedTypes.has(event.type));
  const eventTypes = getEventTypes(timeline).filter((eventType) => selectedTypes.has(eventType.value));
  return {
    ...timeline,
    title: getExportTimelineTitleValue(),
    eventTypes,
    hiddenEventTypes: getHiddenEventTypes(eventTypes),
    events
  };
}

function renderExportEventTypeControls() {
  const eventTypes = getExportableEventTypes();
  const counts = getEventTypeCounts();
  exportEventTypes.innerHTML = eventTypes.map((eventType) => `
    <label class="export-event-type">
      <input type="checkbox" value="${escapeHtml(eventType.value)}" data-export-event-type ${exportEventTypeSelection.has(eventType.value) ? "checked" : ""}>
      <span class="event-type-swatch" aria-hidden="true">${escapeHtml(eventType.emoji || "")}</span>
      <span>${escapeHtml(eventType.label)}</span>
      <span class="small">${counts.get(eventType.value) || 0} event${counts.get(eventType.value) === 1 ? "" : "s"}</span>
    </label>
  `).join("");
  updateExportEventsSummary(eventTypes);
}

function renderExportCollectionControls() {
  const collections = getExportableCollections();
  exportCollections.innerHTML = collections.map((collection) => {
    const count = getCollectionEventCount(collection.id);
    return `
      <label class="export-collection">
        <input type="checkbox" value="${escapeHtml(collection.id)}" data-export-collection ${exportCollectionSelection.has(collection.id) ? "checked" : ""}>
        <span>${escapeHtml(collection.title)}</span>
        <span class="small">${count} event${count === 1 ? "" : "s"}</span>
      </label>
    `;
  }).join("");
  updateExportCollectionsSummary(collections);
}

function updateExportEventsSummary(eventTypes = getExportableEventTypes()) {
  const selectedCount = getSelectedExportEventTypes().size;
  if (selectedCount === eventTypes.length) {
    exportEventsSummary.textContent = "All event types";
  } else if (selectedCount === 0) {
    exportEventsSummary.textContent = "No event types selected";
  } else {
    exportEventsSummary.textContent = `${selectedCount} of ${eventTypes.length} event types`;
  }
  saveDialogStatus.textContent = selectedCount === 0 ? "Select at least one event type to export." : "";
  saveSubmitButton.disabled = selectedCount === 0;
  updateLinkedImageWarning();
}

function getSelectedExportEventTypes() {
  const eventTypeValues = new Set(getExportableEventTypes().map((eventType) => eventType.value));
  return new Set([...exportEventTypeSelection].filter((value) => eventTypeValues.has(value)));
}

function updateExportCollectionsSummary(collections = getExportableCollections()) {
  const selectedCount = getSelectedExportCollections().size;
  if (collections.length === 0) {
    exportCollectionsSummary.textContent = "No collections";
    saveDialogStatus.textContent = "No collections are available to export.";
    saveSubmitButton.disabled = true;
  } else if (selectedCount === collections.length) {
    exportCollectionsSummary.textContent = "All collections";
    saveDialogStatus.textContent = "";
    saveSubmitButton.disabled = false;
  } else if (selectedCount === 0) {
    exportCollectionsSummary.textContent = "No collections selected";
    saveDialogStatus.textContent = "Select at least one collection to export.";
    saveSubmitButton.disabled = true;
  } else {
    exportCollectionsSummary.textContent = `${selectedCount} of ${collections.length} collections`;
    saveDialogStatus.textContent = "";
    saveSubmitButton.disabled = false;
  }
  updateLinkedImageWarning();
}

function getSelectedExportCollections() {
  const collectionIds = new Set(getExportableCollections().map((collection) => collection.id));
  return new Set([...exportCollectionSelection].filter((value) => collectionIds.has(value)));
}

function getExportableEventTypes() {
  return getEventTypes(timeline);
}

function getEventTypeCounts() {
  const counts = new Map();
  for (const event of timeline.events) {
    counts.set(event.type, (counts.get(event.type) || 0) + 1);
  }
  return counts;
}

function getExportableCollections() {
  return getCollections(timeline).filter((collection) => getCollectionEventCount(collection.id) > 0);
}

function getCollectionEventCount(collectionId) {
  return timeline.events.filter((event) => event.collectionIds?.includes(collectionId)).length;
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
  if (!deletedEvent) return;
  if (!window.confirm(`Delete "${getEventTitle(deletedEvent)}"? This can't be undone.`)) return;
  timeline.events = timeline.events.filter((item) => item.id !== deleteButton.dataset.deleteId);
  removeUnusedMediaForEvent(deletedEvent);
  if (editingEventId === deletedEvent?.id) {
    resetEventForm();
    closeEventEditor({ reset: false, restoreFocus: false });
  }
  lastTimeZone = getLastEventTimeZone(timeline) || lastTimeZone;
  await persist("Event deleted.");
});

function startAddingEvent() {
  resetEventForm();
  render();
  openEventEditor();
}

function openEventEditor({ focus = true } = {}) {
  if (!isEventEditorOpen()) {
    eventEditorReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }
  eventEditorShell.hidden = false;
  setPageBehindEditorInert(true);
  document.body.classList.add("event-editor-open");
  floatingAddEventButton.setAttribute("aria-expanded", "true");
  eventEditorPanel.scrollTop = 0;
  if (focus) eventTitleInput.focus();
}

function closeEventEditor({ reset = true, restoreFocus = true } = {}) {
  if (reset) {
    resetEventForm();
    render();
  }
  eventEditorShell.hidden = true;
  setPageBehindEditorInert(false);
  document.body.classList.remove("event-editor-open");
  floatingAddEventButton.setAttribute("aria-expanded", "false");
  if (restoreFocus && eventEditorReturnFocus && document.contains(eventEditorReturnFocus)) {
    eventEditorReturnFocus.focus();
  }
  eventEditorReturnFocus = null;
}

// Stands in for a focus trap: inert content can't be tabbed to or clicked, and
// is hidden from assistive tech, so the editor behaves like a modal dialog.
function setPageBehindEditorInert(inert) {
  appShell.inert = inert;
  floatingAddEventButton.inert = inert;
}

function isEventEditorOpen() {
  return !eventEditorShell.hidden;
}

async function persist(message, level = "info") {
  timeline.title = getTimelineTitleValue();
  timeline = normalizeTimeline(await saveActiveTimeline(timeline));
  render();
  setStatus(message, level);
}

function loadedImportStatus(file, diagnostics) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.level === "error").length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.level === "warning").length;
  const details = [
    errors > 0 ? `${errors} schema error${errors === 1 ? "" : "s"}` : "",
    warnings > 0 ? `${warnings} schema warning${warnings === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  const message = details.length > 0
    ? `Loaded ${file.name} with ${details.join(" and ")}.`
    : `Loaded ${file.name}.`;
  const level = errors > 0 ? "error" : warnings > 0 ? "warning" : "info";
  return { message, level };
}

function populateEventTypes(selectedValue = typeInput.value || DEFAULT_EVENT_TYPE) {
  const eventTypes = getEventTypes(timeline);
  typeInput.innerHTML = eventTypes
    .map((type) => `<option value="${escapeHtml(type.value)}">${escapeHtml(formatEventTypeOption(type))}</option>`)
    .join("");
  typeInput.value = eventTypes.some((type) => type.value === selectedValue)
    ? selectedValue
    : DEFAULT_EVENT_TYPE;
  eventTypeSummary.textContent = `${eventTypes.length} type${eventTypes.length === 1 ? "" : "s"}`;
  updateHideEventTypeControls();
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

function populateHtmlPlayerTypes() {
  htmlPlayerTypeInput.innerHTML = PLAYER_TYPES
    .map((player) => player.available
      ? `<option value="${escapeHtml(player.value)}">${escapeHtml(player.label)} - ${escapeHtml(player.description)}</option>`
      : `<option value="${escapeHtml(player.value)}" disabled>${escapeHtml(player.label)} - coming soon</option>`)
    .join("");
}

function renderCollectionSuggestions() {
  collectionSuggestions.innerHTML = getCollections(timeline)
    .map((collection) => `<option value="${escapeHtml(collection.title)}"></option>`)
    .join("");
}

function formatEventTypeOption(eventType) {
  return eventType.emoji ? `${eventType.emoji} ${eventType.label}` : eventType.label;
}

function resolveCollectionIds(value) {
  const titles = uniqueText(value.split(",").map((title) => title.trim()));
  if (titles.length === 0) return [];

  const collections = [...getCollections(timeline)];
  const ids = [];
  for (const title of titles) {
    const existing = collections.find((collection) => collection.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const collection = createCollection({ title });
    collections.push(collection);
    ids.push(collection.id);
  }
  timeline.collections = collections;
  return ids;
}

function render() {
  renderTimelineTitle();
  populateEventTypes();
  renderCollectionSuggestions();
  eventList.innerHTML = "";

  if (timeline.events.length === 0) {
    eventList.innerHTML = `<div class="empty-state">No events yet. Add one manually.</div>`;
    return;
  }

  for (const event of sortEvents(timeline.events)) {
    const row = document.createElement("article");
    row.className = event.id === editingEventId ? "event-item editing" : "event-item";
    const eventTypeLabel = getEventTypeLabel(event.type, timeline);
    const eventTypeTooltip = `${eventTypeLabel.toLowerCase()} event`;
    row.innerHTML = `
      <div class="event-type-emoji" role="img" aria-label="${escapeHtml(eventTypeTooltip)}" title="${escapeHtml(eventTypeTooltip)}">${escapeHtml(getEventTypeEmoji(event.type, timeline))}</div>
      <div class="event-summary">
        <div class="event-date">${escapeHtml(formatEditorEventTimestamp(event.timestamp, event.endTimestamp))}</div>
        <div class="event-name">${escapeHtml(getEventTitle(event))}</div>
        ${renderEventCollections(event)}
      </div>
      ${renderEventThumbnail(event)}
      <div class="event-actions">
        <button class="icon-button" type="button" data-edit-id="${escapeHtml(event.id)}" aria-label="Edit event" title="Edit">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
          </svg>
        </button>
        <button class="icon-button danger" type="button" data-delete-id="${escapeHtml(event.id)}" aria-label="Delete event" title="Delete">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 6h18"></path>
            <path d="M8 6V4h8v2"></path>
            <path d="m19 6-1 14H6L5 6"></path>
            <path d="M10 11v5"></path>
            <path d="M14 11v5"></path>
          </svg>
        </button>
      </div>
    `;
    eventList.append(row);
  }
}

function renderEventCollections(event) {
  const collections = getEventCollections(timeline, event);
  if (collections.length === 0) return "";
  return `
    <div class="event-collections">
      ${collections.map((collection) => `<span class="collection-pill">${escapeHtml(collection.title)}</span>`).join("")}
    </div>
  `;
}

function formatEditorEventTimestamp(timestamp, endTimestamp) {
  if (!timestamp?.date) return "No date";
  const start = formatEditorDateTime(timestamp);
  if (!endTimestamp?.date) return start;
  const end = formatEditorDateTime(endTimestamp);
  return end === start ? start : `${start} – ${end}`;
}

function formatEditorDateTime(timestamp) {
  const timeText = timestamp.time && timestamp.time !== "00:00" ? ` ${timestamp.time}` : "";
  return `${formatDisplayDate(timestamp.date)}${timeText}`;
}

function syncEndDateMin() {
  endDateInput.min = dateInput.value;
  renderOptionalSummaries();
}

function renderTimelineTitle() {
  const title = timeline.title || "Untitled timeline";
  titleText.textContent = title;
  if (!isEditingTitle) titleInput.value = title;
}

function renderEventThumbnail(event) {
  const images = resolveEventImages(timeline, event);
  const image = images.find((item) => item.kind === "link" || canRenderImageMedia(item.media));
  if (!image) return `<div class="event-thumb-placeholder" aria-hidden="true"></div>`;
  const src = image.kind === "embedded" ? image.media.dataUrl : image.url;
  const extraCount = images.length - 1;
  return `
    <div class="event-thumb-wrap">
      <img class="event-thumb" src="${escapeHtml(src)}" alt="${escapeHtml(image.caption || "")}">
      ${renderImageSourceIcon(image.kind)}
      ${extraCount > 0 ? `<span class="gallery-count">+${extraCount}</span>` : ""}
    </div>
  `;
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

  if (draftImages.length === 0) {
    imagePreview.innerHTML = `<div class="empty-state compact">No images in this event gallery.</div>`;
    renderOptionalSummaries();
    return;
  }

  imagePreview.innerHTML = draftImages.map((image, index) => renderDraftImage(image, index)).join("");
  renderOptionalSummaries();
}

function renderDraftImage(image, index) {
  const src = image.kind === "embedded" ? image.media?.dataUrl : image.url;

  return `
    <article class="gallery-editor-item">
      <figure class="gallery-editor-media">
        <img src="${escapeHtml(src || "")}" alt="${escapeHtml(image.caption || "")}">
        ${renderImageSourceIcon(image.kind)}
      </figure>
      <div class="gallery-editor-body">
        <label>
          <span>Caption</span>
          <input type="text" value="${escapeHtml(image.caption || "")}" data-image-caption="${escapeHtml(image.id)}" autocomplete="off">
        </label>
        <div class="gallery-editor-actions">
          <button class="icon-button gallery-action-button" type="button" data-move-image="${escapeHtml(image.id)}" data-direction="up" aria-label="Move image up" title="Move up" ${index === 0 ? "disabled" : ""}>
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m18 15-6-6-6 6"></path>
            </svg>
          </button>
          <button class="icon-button gallery-action-button" type="button" data-move-image="${escapeHtml(image.id)}" data-direction="down" aria-label="Move image down" title="Move down" ${index === draftImages.length - 1 ? "disabled" : ""}>
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 9 6 6 6-6"></path>
            </svg>
          </button>
          <button class="icon-button gallery-action-button danger" type="button" data-remove-image="${escapeHtml(image.id)}" aria-label="Remove image" title="Remove">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h18"></path>
              <path d="M8 6V4h8v2"></path>
              <path d="m19 6-1 14H6L5 6"></path>
              <path d="M10 11v5"></path>
              <path d="M14 11v5"></path>
            </svg>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderImageSourceIcon(kind) {
  const label = kind === "embedded" ? "Embedded image" : "Linked image";
  const icon = kind === "embedded"
    ? `
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path>
      <path d="M14 2v6h6"></path>
    `
    : `
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
    `;
  return `
    <span class="source-icon" role="img" aria-label="${label}" title="${label}">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
    </span>
  `;
}

function renderOptionalSummaries() {
  const time = timeInput.value;
  const endTime = endTimeInput.value;
  const location = locationInput.value.trim();
  const collection = collectionInput.value.trim();
  const imageLink = imageLinkInput.value.trim();
  const populatedFieldCount = draftFields.filter((field) => field.value).length;

  datetimeSummary.textContent = time || endTime
    ? `${time || "00:00"}${endTime ? ` – ${endTime}` : ""} ${tzInput.value}`
    : "No time set";
  locationSummary.textContent = location || (coordinatesField.getGeo() ? "Coordinates set" : "No location");
  collectionSummary.textContent = collection || "No collection";
  imageSummary.textContent = draftImages.length > 0
    ? `${draftImages.length} image${draftImages.length === 1 ? "" : "s"}`
    : imageLink
      ? "URL ready to add"
      : "No images";
  fieldsSummary.textContent = draftFields.length === 0
    ? "No extra fields"
    : `${draftFields.length} field${draftFields.length === 1 ? "" : "s"}${populatedFieldCount > 0 ? `, ${populatedFieldCount} filled` : ""}`;
}

function resetEventForm({ preserveEvent = null } = {}) {
  editingEventId = null;
  formTitle.textContent = "Add event";
  submitEventButton.textContent = "Add event";
  cancelEditButton.hidden = true;
  populateEventTypes(preserveEvent?.type || DEFAULT_EVENT_TYPE);
  eventTitleInput.value = "";
  dateInput.value = preserveEvent?.timestamp?.date || new Date().toISOString().slice(0, 10);
  timeInput.value = preserveEvent?.timestamp?.time === "00:00" ? "" : preserveEvent?.timestamp?.time || "";
  endDateInput.value = preserveEvent?.endTimestamp?.date || "";
  endTimeInput.value = preserveEvent?.endTimestamp?.time === "00:00" ? "" : preserveEvent?.endTimestamp?.time || "";
  syncEndDateMin();
  tzInput.value = getEventTimeZone(preserveEvent) || lastTimeZone;
  locationInput.value = preserveEvent?.location || "";
  coordinatesField.load({ location: locationInput.value, geo: preserveEvent?.geo });
  collectionInput.value = preserveEvent
    ? getEventCollections(timeline, preserveEvent).map((collection) => collection.title).join(", ")
    : "";
  imageLinkInput.value = "";
  imageFileInput.value = "";
  draftImages = [];
  draftFields = [];
  closeOptionalSections();
  openPopulatedOptionalSections();
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
  eventTypeOptions.open = false;
  datetimeOptions.open = false;
  locationOptions.open = false;
  collectionOptions.open = false;
  imageOptions.open = false;
  fieldsOptions.open = false;
}

function openPopulatedOptionalSections() {
  datetimeOptions.open = Boolean(timeInput.value || endTimeInput.value);
  locationOptions.open = Boolean(locationInput.value.trim() || coordinatesField.getGeo());
  collectionOptions.open = Boolean(collectionInput.value.trim());
  imageOptions.open = Boolean(imageLinkInput.value.trim() || draftImages.length > 0);
  fieldsOptions.open = draftFields.length > 0;
}

function startEditingEvent(eventId) {
  const event = timeline.events.find((item) => item.id === eventId);
  if (!event) {
    setStatus("Could not edit because the event no longer exists.", "error");
    return;
  }

  editingEventId = event.id;
  formTitle.textContent = "Edit event";
  submitEventButton.textContent = "Save changes";
  cancelEditButton.hidden = false;

  populateEventTypes(event.type);
  eventTitleInput.value = getEventTitle(event);
  dateInput.value = event.timestamp?.date || new Date().toISOString().slice(0, 10);
  timeInput.value = event.timestamp?.time === "00:00" ? "" : event.timestamp?.time || "";
  endDateInput.value = event.endTimestamp?.date || "";
  endTimeInput.value = event.endTimestamp?.time === "00:00" ? "" : event.endTimestamp?.time || "";
  syncEndDateMin();
  tzInput.value = getEventTimeZone(event) || lastTimeZone;
  locationInput.value = event.location || "";
  coordinatesField.load({ location: locationInput.value, geo: event.geo });
  collectionInput.value = getEventCollections(timeline, event).map((collection) => collection.title).join(", ");
  imageLinkInput.value = "";
  imageFileInput.value = "";
  draftImages = resolveEventImages(timeline, event).map(toDraftImage);
  draftFields = Array.isArray(event.fields)
    ? event.fields.map((field) => ({ ...field }))
    : [];
  renderImagePreview();
  renderDraftFields();
  openPopulatedOptionalSections();
  render();
  openEventEditor({ focus: false });
  eventTitleInput.focus();
  setStatus("Editing event. Save changes or cancel to return to adding events.");
}

async function addDraftImagesFromFiles(files) {
  try {
    setStatus(`Encoding ${files.length} image${files.length === 1 ? "" : "s"}...`);
    const nextImages = [];
    for (const file of files) {
      const media = createImageMedia(await encodeImageFile(file));
      if (!media) {
        throw new Error("Encoded image did not pass schema checks.");
      }
      nextImages.push({
        id: crypto.randomUUID(),
        kind: "embedded",
        mediaId: media.id,
        caption: "",
        media
      });
    }
    draftImages = [...draftImages, ...nextImages];
    imageOptions.open = true;
    renderImagePreview();
    setStatus(`${nextImages.length} image${nextImages.length === 1 ? "" : "s"} added as resized JPEG${nextImages.length === 1 ? "" : "s"} with metadata removed.`);
  } catch (error) {
    setStatus(`Image failed: ${error.message}`, "error");
  }
}

function addDraftImageLink(url = imageLinkInput.value) {
  const safeUrl = String(url || "").trim();
  if (!isSafeHttpUrl(safeUrl)) {
    setStatus("Image URL must start with http:// or https://.", "warning");
    return;
  }

  draftImages = [
    ...draftImages,
    {
      id: crypto.randomUUID(),
      kind: "link",
      url: safeUrl,
      caption: ""
    }
  ];
  imageLinkInput.value = "";
  imageOptions.open = true;
  renderImagePreview();
  setStatus("Linked image added to gallery.");
}

function toEventImage(image) {
  if (image.kind === "embedded") {
    return {
      id: image.id,
      kind: "embedded",
      mediaId: image.mediaId,
      caption: image.caption || ""
    };
  }

  return {
    id: image.id,
    kind: "link",
    url: image.url,
    caption: image.caption || ""
  };
}

function toDraftImage(image) {
  if (image.kind === "embedded") {
    return {
      id: image.id,
      kind: "embedded",
      mediaId: image.mediaId,
      caption: image.caption || "",
      media: image.media
    };
  }

  return {
    id: image.id,
    kind: "link",
    url: image.url,
    caption: image.caption || ""
  };
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

function syncDraftImageDetails() {
  for (const input of imagePreview.querySelectorAll("[data-image-caption]")) {
    const image = draftImages.find((item) => item.id === input.dataset.imageCaption);
    if (image) image.caption = input.value;
  }
}

function getLastEventTimeZone(document) {
  const sortedEvents = sortEvents(document.events || []);
  return getEventTimeZone(sortedEvents.at(-1));
}

function removeUnusedMediaForEvent(deletedEvent) {
  const deletedMediaIds = new Set((deletedEvent?.images || [])
    .filter((image) => image.kind === "embedded")
    .map((image) => image.mediaId));
  if (deletedMediaIds.size === 0) return;
  const usedMediaIds = new Set((timeline.events || [])
    .flatMap((event) => event.images || [])
    .filter((image) => image.kind === "embedded")
    .map((image) => image.mediaId));
  timeline.media = timeline.media.filter((item) => !deletedMediaIds.has(item.id) || usedMediaIds.has(item.id));
}

function setStatus(message, level = inferStatusLevel(message)) {
  if (!message) return;
  const toast = document.createElement("div");
  const safeLevel = ["info", "warning", "error"].includes(level) ? level : "info";
  toast.className = `toast ${safeLevel}`;
  toast.textContent = message;
  if (safeLevel === "error") toast.setAttribute("role", "alert");

  toastRegion.append(toast);
  while (toastRegion.children.length > 4) {
    toastRegion.firstElementChild.remove();
  }
  window.setTimeout(() => {
    toast.remove();
  }, safeLevel === "error" ? 7000 : 4500);
}

function inferStatusLevel(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("could not") || text.includes("failed") || text.includes("error")) return "error";
  if (text.includes("warning") || text.includes("not implemented") || text.includes("must") || text.includes("did not")) return "warning";
  return "info";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isSafeHttpUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function uniqueText(values) {
  const used = new Set();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!key || used.has(key)) return false;
    used.add(key);
    return true;
  });
}
