// "Pick on map": the editor dialog for setting an event's coordinates by
// placing a pin (docs/players/map.md, section 1.3). It uses the vendored
// Leaflet (the global `L`) and the player's tile list.
//
//   const picker = createMapPicker({ geocoder, permission });
//   const outcome = await picker.open({ geo, location });
//   // null (cancelled), { action: "use", geo: { lat, lng } } or { action: "clear" }
//
// The geocoder and permission are the editor's shared ones, so a search here
// goes through the same queue and needs the same consent as the Location row.

import { formatCoordinates, isValidCoordinatePair, normalizeGeo, roundCoordinate } from "./coords.js";
import { showDialog } from "./fileLoad.js";
import { LOOKUP_CONSENT_TEXT, NOMINATIM_ATTRIBUTION, createLookupGuard } from "./geocode.js";
import { DEFAULT_TILE_SOURCE_ID, TILE_SOURCES, getTileSource, normalizeTileSourceId } from "./mapTiles.js";

export const PICKER_VIEW_KEY = "timeline.mappicker.view.v1";
const START_ZOOM = 12;
const SEARCH_ZOOM = 12;
const WORLD_VIEW = { lat: 20, lng: 0, zoom: 2 };

export function createMapPicker({ geocoder, permission, storage = getStorage() }) {
  const guard = createLookupGuard();
  let dialog = null;
  let els = null;
  let map = null;
  let marker = null;
  let tileLayer = null;
  let tilesLoaded = false;
  let currentSourceId = null;
  let pin = null;
  let hadGeo = false;
  let outcome = null;
  let settle = null;
  let pendingSearch = null;

  return { open };

  function open({ geo = null, location = "" } = {}) {
    if (!dialog) build();
    outcome = null;
    const start = normalizeGeo(geo);
    hadGeo = Boolean(start);
    pendingSearch = null;
    guard.cancel();

    els.search.value = location;
    els.results.replaceChildren();
    els.results.hidden = true;
    els.consent.hidden = true;
    setStatus("");
    els.clear.hidden = !hadGeo;
    els.clear.disabled = false;

    showDialog(dialog);
    if (map) startView(start, location);
    else setPin(null);
    els.search.focus?.();
    if (!map) els.close.focus();

    return new Promise((resolve) => { settle = resolve; });
  }

  // ---- building -----------------------------------------------------------

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "modal mpick-dialog";
    dialog.setAttribute("aria-labelledby", "mpick-title");

    const Leaflet = globalThis.L;
    const hasLeaflet = Boolean(Leaflet) && typeof Leaflet.map === "function";

    dialog.innerHTML = `
      <div class="modal-panel mpick-panel">
        <header class="modal-header">
          <h2 id="mpick-title">Pick on map</h2>
          <button class="icon-button" type="button" data-mpick="close" aria-label="Close map dialog">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </header>
        ${hasLeaflet ? `
        <div class="lookup-consent" data-mpick="consent" role="group" aria-label="Look up places online" hidden>
          <p data-mpick="consent-text"></p>
          <div class="lookup-consent-actions">
            <button class="primary" type="button" data-mpick="allow">Allow</button>
            <button type="button" data-mpick="later">Not now</button>
          </div>
        </div>
        <form class="mpick-search" data-mpick="search-form" role="search">
          <label class="sr-only" for="mpick-search">Search for a place</label>
          <input id="mpick-search" type="text" data-mpick="search" placeholder="Search for a place" autocomplete="off" spellcheck="false">
          <button type="submit" data-mpick="search-button">Search</button>
        </form>
        <ul class="mpick-results" data-mpick="results" hidden></ul>
        <div class="mpick-map-wrap">
          <div class="mpick-map" data-mpick="map"></div>
          <div class="mpick-tiles-note" data-mpick="tiles-note" hidden>Map tiles unavailable. You can still search, or type coordinates in the event form.</div>
        </div>
        <div class="mpick-bar">
          <label class="mpick-source">
            <span class="sr-only">Map style</span>
            <select data-mpick="source">${TILE_SOURCES.map((source) => `<option value="${source.id}">${source.label}</option>`).join("")}</select>
          </label>
          <output class="mpick-readout" data-mpick="readout" aria-live="polite"></output>
        </div>
        <div class="geo-status" data-mpick="status" role="status" aria-live="polite" hidden></div>
        <div class="mpick-actions">
          <button class="primary" type="button" data-mpick="use" disabled>Use this location</button>
          <button type="button" data-mpick="clear" hidden>Clear coordinates</button>
          <button type="button" data-mpick="cancel">Cancel</button>
        </div>
        <p class="lookup-attribution">${NOMINATIM_ATTRIBUTION}</p>` : `
        <p class="mpick-missing">The map library did not load, so the map can't be shown. Type the coordinates in the event form instead.</p>
        <div class="mpick-actions"><button type="button" data-mpick="cancel">Close</button></div>`}
      </div>`;

    const pick = (name) => dialog.querySelector(`[data-mpick="${name}"]`);
    els = {
      close: pick("close"),
      cancel: pick("cancel"),
      search: pick("search") || { value: "", focus() {} },
      searchForm: pick("search-form"),
      results: pick("results") || document.createElement("ul"),
      consent: pick("consent") || document.createElement("div"),
      consentText: pick("consent-text"),
      mapEl: pick("map"),
      tilesNote: pick("tiles-note"),
      source: pick("source"),
      readout: pick("readout"),
      status: pick("status") || document.createElement("div"),
      use: pick("use") || document.createElement("button"),
      clear: pick("clear") || document.createElement("button")
    };

    els.close.addEventListener("click", () => closeWith(null));
    els.cancel.addEventListener("click", () => closeWith(null));
    dialog.addEventListener("cancel", () => { outcome = null; });
    dialog.addEventListener("close", onClosed);
    // Clicking the dimmed area outside the panel cancels, like the other dialogs.
    dialog.addEventListener("click", (event) => { if (event.target === dialog) closeWith(null); });
    document.body.append(dialog);

    if (!hasLeaflet) return;

    els.consentText.textContent = LOOKUP_CONSENT_TEXT;
    els.use.addEventListener("click", () => {
      if (pin) closeWith({ action: "use", geo: { lat: pin.lat, lng: pin.lng } });
    });
    els.clear.addEventListener("click", () => closeWith({ action: "clear" }));
    els.searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      search(els.search.value, { explicit: true });
    });
    pick("allow").addEventListener("click", () => {
      permission.allow();
      els.consent.hidden = true;
      if (pendingSearch) search(pendingSearch, { explicit: true });
    });
    pick("later").addEventListener("click", () => {
      permission.defer();
      els.consent.hidden = true;
      pendingSearch = null;
      setStatus("Search is off for now. You can still click the map to place the pin.");
    });
    els.source.addEventListener("change", () => {
      applyTiles(els.source.value);
      saveState({ tile: normalizeTileSourceId(els.source.value) });
    });

    map = Leaflet.map(els.mapEl, { minZoom: 1, worldCopyJump: true });
    map.on("click", (event) => placePin(event.latlng));
    els.source.value = normalizeTileSourceId(loadState().tile);
    applyTiles(els.source.value);
  }

  // The map has to be sized before it can be given a view, so this runs after
  // the dialog is showing.
  function startView(start, location) {
    map.invalidateSize({ animate: false });
    els.source.value = normalizeTileSourceId(loadState().tile);
    if (els.source.value !== currentSourceId) applyTiles(els.source.value);

    if (start) {
      setPin(start);
      map.setView([start.lat, start.lng], START_ZOOM, { animate: false });
      return;
    }
    setPin(null);
    const last = loadState().view;
    const view = last || WORLD_VIEW;
    map.setView([view.lat, view.lng], view.zoom, { animate: false });
    // The person hasn't pinned anything: a place name can pick the area, but
    // only when lookups are already allowed. Opening a dialog is not consent.
    if (location.trim() && permission.isAllowed()) search(location, { explicit: false });
  }

  // ---- tiles --------------------------------------------------------------

  function applyTiles(id) {
    const Leaflet = globalThis.L;
    const source = getTileSource(id);
    currentSourceId = source.id;
    tileLayer?.remove();
    tilesLoaded = false;
    els.tilesNote.hidden = true;
    map.setMaxZoom(source.maxZoom);
    tileLayer = Leaflet.tileLayer(source.url, {
      attribution: source.attribution,
      maxZoom: source.maxZoom,
      maxNativeZoom: source.maxNativeZoom,
      subdomains: source.subdomains || "abc",
      tileSize: source.tileSize || 256,
      zoomOffset: source.zoomOffset || 0
    });
    tileLayer.on("tileload", () => {
      tilesLoaded = true;
      els.tilesNote.hidden = true;
    });
    tileLayer.on("tileerror", () => {
      if (!tilesLoaded) els.tilesNote.hidden = false;
    });
    tileLayer.addTo(map);
  }

  // ---- the pin ------------------------------------------------------------

  function placePin(latlng) {
    const wrapped = latlng.wrap();
    setPin({ lat: roundCoordinate(wrapped.lat), lng: roundCoordinate(wrapped.lng) });
    // A placed pin outranks a search answer that is still on its way.
    guard.cancel();
  }

  function setPin(point) {
    pin = point && isValidCoordinatePair(point.lat, point.lng) ? { lat: point.lat, lng: point.lng } : null;
    els.use.disabled = !pin;
    els.readout.textContent = pin ? formatCoordinates(pin) : "No pin yet. Click the map to place one.";
    if (!map) return;

    if (!pin) {
      marker?.remove();
      marker = null;
      return;
    }
    if (marker) {
      marker.setLatLng([pin.lat, pin.lng]);
      return;
    }
    const Leaflet = globalThis.L;
    marker = Leaflet.marker([pin.lat, pin.lng], {
      draggable: true,
      title: "Drag to move the pin",
      icon: Leaflet.divIcon({
        className: "mpick-pin",
        html: "<span></span>",
        iconSize: [28, 36],
        iconAnchor: [14, 36]
      })
    }).addTo(map);
    marker.on("drag", (event) => {
      const wrapped = event.target.getLatLng().wrap();
      els.readout.textContent = formatCoordinates({ lat: wrapped.lat, lng: wrapped.lng });
    });
    marker.on("dragend", (event) => placePin(event.target.getLatLng()));
  }

  // ---- search -------------------------------------------------------------

  async function search(text, { explicit }) {
    const query = String(text || "").trim();
    if (!query) {
      setStatus("Type a place to search for.");
      return;
    }
    if (!permission.isAllowed()) {
      if (explicit || !permission.isDeferred()) {
        pendingSearch = query;
        setStatus("");
        els.consent.hidden = false;
      }
      return;
    }

    const token = guard.begin();
    els.results.replaceChildren();
    els.results.hidden = true;
    setStatus("Searching…");
    let results;
    try {
      results = await geocoder.geocode(query);
    } catch {
      if (guard.isCurrent(token)) setStatus("Couldn't reach the place lookup. Click the map to place the pin.", "error");
      return;
    }
    // The pin was placed or the dialog was reopened while this was on its way.
    if (!guard.isCurrent(token)) return;

    if (results.length === 0) {
      setStatus("Couldn't find that place. Click the map to place the pin.", "error");
      return;
    }
    setStatus(explicit ? "Choose a match, or click the map." : `Showing ${results[0].label}. Click the map to place the pin.`);
    map.setView([results[0].lat, results[0].lng], SEARCH_ZOOM, { animate: false });
    renderResults(results);
  }

  function renderResults(results) {
    els.results.replaceChildren();
    for (const result of results) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = result.label;
      button.addEventListener("click", () => {
        setPin(result);
        guard.cancel();
        map.setView([result.lat, result.lng], SEARCH_ZOOM, { animate: false });
        els.results.hidden = true;
        setStatus(`Pin placed at ${result.label}. Drag it or click elsewhere to adjust.`);
      });
      item.append(button);
      els.results.append(item);
    }
    els.results.hidden = results.length === 0;
  }

  // ---- closing ------------------------------------------------------------

  function closeWith(result) {
    outcome = result;
    if (dialog.open) dialog.close();
    else onClosed();
  }

  function onClosed() {
    guard.cancel();
    if (map) {
      const center = map.getCenter().wrap();
      saveState({ view: { lat: roundCoordinate(center.lat), lng: roundCoordinate(center.lng), zoom: map.getZoom() } });
    }
    const done = settle;
    settle = null;
    done?.(outcome);
  }

  function setStatus(message, level = "info") {
    els.status.textContent = message;
    els.status.classList.toggle("error", level === "error");
    els.status.hidden = !message;
  }

  // ---- remembered view and tile source -------------------------------------

  function loadState() {
    try {
      const saved = JSON.parse(storage?.getItem(PICKER_VIEW_KEY) ?? "null");
      const view = saved?.view;
      const validView = view && isValidCoordinatePair(view.lat, view.lng) && Number.isFinite(view.zoom)
        ? { lat: view.lat, lng: view.lng, zoom: Math.min(Math.max(Math.round(view.zoom), 1), 19) }
        : null;
      return { view: validView, tile: normalizeTileSourceId(saved?.tile ?? DEFAULT_TILE_SOURCE_ID) };
    } catch {
      return { view: null, tile: DEFAULT_TILE_SOURCE_ID };
    }
  }

  function saveState(patch) {
    try {
      storage?.setItem(PICKER_VIEW_KEY, JSON.stringify({ ...loadState(), ...patch }));
    } catch {
      // Storage blocked or full: the next open just starts from the world.
    }
  }
}

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
