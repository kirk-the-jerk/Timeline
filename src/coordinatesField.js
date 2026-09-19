// The "Coordinates" row under Location in the event editor: lookup, typed
// coordinates, the consent notice and the status line. It holds the draft
// `geo` for the event being edited; the editor reads it back with getGeo().
//
// Coordinates are set here, at authoring time, and stored in the file. The
// online lookup only fills them in, and nothing is sent until the person has
// allowed it (docs/players/map.md, section 1.2).

import { canAutoReplaceGeo, formatCoordinates, normalizeGeo, parseCoordinates, sameGeo } from "./coords.js";
import { NOMINATIM, PHOTON, createGeocoder, createLookupGuard, createLookupPermission } from "./geocode.js";

const CONSENT_TEXT = `Look up places online? The location text you enter, and your IP address, are sent to ${NOMINATIM.host} (OpenStreetMap) to find coordinates. If that service is unavailable they are sent to ${PHOTON.host} (Komoot) instead. Coordinates are saved in your timeline; nothing else leaves this browser.`;
const INVALID_TEXT = "Enter coordinates like 30.7235, -95.5508 (latitude, then longitude).";
const NOT_FOUND_TEXT = "Couldn't find that place. Enter coordinates instead.";
const FAILED_TEXT = "Couldn't reach the place lookup. Enter coordinates instead.";

export function createCoordinatesField({ onChange = () => {}, storage = getStorage() } = {}) {
  const locationInput = document.querySelector("#event-location");
  const coordinatesInput = document.querySelector("#event-coordinates");
  const lookupButton = document.querySelector("#lookup-location");
  const statusLine = document.querySelector("#geo-status");
  const matches = document.querySelector("#geo-matches");
  const matchesSummary = document.querySelector("#geo-matches-summary");
  const matchList = document.querySelector("#geo-match-list");
  const consent = document.querySelector("#lookup-consent");
  const consentText = document.querySelector("#lookup-consent-text");
  const consentAllowButton = document.querySelector("#lookup-consent-allow");
  const consentLaterButton = document.querySelector("#lookup-consent-later");
  const settingText = document.querySelector("#lookup-setting-text");
  const settingToggle = document.querySelector("#lookup-setting-toggle");

  const geocoder = createGeocoder({
    fetch: (...args) => window.fetch(...args),
    storage
  });
  const guard = createLookupGuard();
  const permission = createLookupPermission(storage);

  let geo = null;
  // The location text the coordinates were last matched against, so that only
  // a real change to the label counts as "the location changed".
  let anchorText = "";
  // The lookup in flight, so that saving right after typing a place waits for
  // its coordinates instead of dropping them.
  let pendingLookup = Promise.resolve();

  consentText.textContent = CONSENT_TEXT;

  coordinatesInput.addEventListener("input", () => {
    coordinatesInput.removeAttribute("aria-invalid");
    const text = coordinatesInput.value.trim();
    if (text && !parseCoordinates(text)) coordinatesInput.setAttribute("aria-invalid", "true");
  });
  coordinatesInput.addEventListener("change", () => commit());

  locationInput.addEventListener("change", () => onLocationCommitted());
  // Enter in the Location field would save the whole event. When the text has
  // changed, it looks the place up instead; unchanged, it saves as before.
  locationInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    const text = locationInput.value.trim();
    if (!text || text === anchorText) return;
    event.preventDefault();
    onLocationCommitted();
  });

  lookupButton.addEventListener("click", () => {
    const text = locationInput.value.trim();
    if (!text) {
      showStatus("Enter a location first, or type coordinates.");
      locationInput.focus();
      return;
    }
    anchorText = text;
    runLookup(text, { explicit: true });
  });

  consentAllowButton.addEventListener("click", () => {
    permission.allow();
    consent.hidden = true;
    renderSetting();
    const text = locationInput.value.trim();
    if (text) {
      anchorText = text;
      runLookup(text, { explicit: true });
    }
  });
  consentLaterButton.addEventListener("click", () => {
    permission.defer();
    consent.hidden = true;
    renderSetting();
    showStatus("Lookup is off for now. Use Look up to try again, or enter coordinates.");
  });
  settingToggle.addEventListener("click", () => {
    if (permission.isAllowed()) {
      permission.forget();
      consent.hidden = true;
    } else {
      consent.hidden = false;
    }
    renderSetting();
  });

  renderSetting();

  return {
    // The form now shows another event (or a blank one): take its coordinates
    // and drop anything still in flight for the old one.
    load({ location = "", geo: nextGeo = null } = {}) {
      guard.cancel();
      geo = normalizeGeo(nextGeo);
      anchorText = String(location || "").trim();
      renderCoordinates();
      clearStatus();
      consent.hidden = true;
      renderSetting();
    },

    // Resolves when no lookup is running. It never rejects.
    settled: () => pendingLookup,

    getGeo: () => geo ? { ...geo } : null,

    // Reads the typed coordinates. False when they are not valid, in which
    // case nothing is changed and the field is flagged, so the editor can
    // refuse to save with a value that would be lost.
    commit,

    // For the pin-on-map dialog and other callers that set a point directly.
    setGeo(nextGeo) {
      guard.cancel();
      geo = normalizeGeo(nextGeo);
      renderCoordinates();
      onChange();
    }
  };

  function commit() {
    const text = coordinatesInput.value.trim();
    if (!text) {
      if (geo) {
        guard.cancel();
        geo = null;
        showStatus("Coordinates cleared.");
        onChange();
      }
      renderCoordinates();
      return true;
    }

    const parsed = parseCoordinates(text);
    if (!parsed) {
      coordinatesInput.setAttribute("aria-invalid", "true");
      showStatus(INVALID_TEXT, "error");
      return false;
    }
    if (!sameGeo(parsed, geo)) {
      guard.cancel();
      geo = { ...parsed, source: "manual" };
      clearMatches();
      showStatus("Coordinates set.");
      onChange();
    }
    renderCoordinates();
    return true;
  }

  function onLocationCommitted() {
    const text = locationInput.value.trim();
    if (text === anchorText) return;
    // An answer still on its way was for the old text.
    guard.cancel();
    anchorText = text;
    if (!text) return;
    if (canAutoReplaceGeo(geo)) {
      runLookup(text, { explicit: false });
      return;
    }
    // Hand-made coordinates are never replaced because a label was edited.
    showStatus("Location changed. Look up again?");
  }

  async function runLookup(text, { explicit }) {
    if (!permission.isAllowed()) {
      if (explicit || !permission.isDeferred()) {
        clearStatus();
        consent.hidden = false;
      } else {
        showStatus("Lookup is off for now. Use Look up to try again, or enter coordinates.");
      }
      return;
    }

    pendingLookup = lookUpAndApply(text);
    return pendingLookup;
  }

  async function lookUpAndApply(text) {
    const token = guard.begin();
    clearMatches();
    showStatus("Looking up…");
    let results;
    try {
      results = await geocoder.geocode(text);
    } catch {
      if (guard.isCurrent(token)) showStatus(FAILED_TEXT, "error");
      return;
    }
    // The location or the coordinates changed while this was on its way.
    if (!guard.isCurrent(token)) return;

    if (results.length === 0) {
      showStatus(NOT_FOUND_TEXT, "error");
      return;
    }
    applyMatch(results[0]);
    renderMatches(results.slice(1));
  }

  function applyMatch(result) {
    geo = { lat: result.lat, lng: result.lng, source: "search" };
    renderCoordinates();
    showStatus(`Matched: ${result.label}`);
    onChange();
  }

  function renderMatches(others) {
    matchList.replaceChildren();
    matches.hidden = others.length === 0;
    matches.open = false;
    if (others.length === 0) return;
    matchesSummary.textContent = `${others.length} other match${others.length === 1 ? "" : "es"}`;
    for (const result of others) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = result.label;
      button.addEventListener("click", () => {
        guard.cancel();
        applyMatch(result);
        matches.open = false;
      });
      item.append(button);
      matchList.append(item);
    }
  }

  function clearMatches() {
    matchList.replaceChildren();
    matches.hidden = true;
    matches.open = false;
  }

  function renderCoordinates() {
    coordinatesInput.value = formatCoordinates(geo);
    coordinatesInput.removeAttribute("aria-invalid");
  }

  function showStatus(message, level = "info") {
    statusLine.textContent = message;
    statusLine.classList.toggle("error", level === "error");
    statusLine.hidden = false;
  }

  function clearStatus() {
    statusLine.textContent = "";
    statusLine.classList.remove("error");
    statusLine.hidden = true;
    clearMatches();
  }

  function renderSetting() {
    const allowed = permission.isAllowed();
    settingText.textContent = allowed
      ? `Online lookup is on (${NOMINATIM.host}).`
      : "Online lookup is off.";
    settingToggle.textContent = allowed ? "Turn off" : "Turn on";
  }
}

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
