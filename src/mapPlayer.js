import { escapeHtml } from "./eventCard.js";
import { formatDisplayDate, formatDisplayRange, getEventTitle } from "./timeline.js";
import {
  FIT_MAX_ZOOM,
  buildPaths,
  buildScopes,
  buildSegments,
  describeMapEvent,
  dotLabel,
  effectiveArrows,
  effectiveNumbers,
  findScope,
  fitTarget,
  getLocatedEvents,
  getMapColor,
  groupDots,
  MAP_COLORS,
  normalizeMapSettings,
  numberEvents,
  screenAngle,
  showsArrow,
  stepIndex,
  summarizeMap
} from "./mapModel.js";
import { TILE_SOURCES, getTileSource } from "./mapTiles.js";

const MAP_SETTINGS_KEY = "timeline-map-settings";
const MAP_NARROW_QUERY = "(max-width: 759px)";
const MAP_FIT_PADDING_TOP_LEFT = [40, 40];
const MAP_FIT_PADDING_BOTTOM_RIGHT = [40, 84];

// A map of the events that have a location. The container holds a launcher
// panel (how many events can be shown, an Open map button). Open map builds the
// stage: a full-viewport overlay with a Leaflet map, a left flyout (scope,
// event list, settings), a right flyout (the selected event and its photos) and
// Previous / Next. The behavior is specified in docs/players/map.md. Returns
// { destroy } because the stage lives on <body> and owns listeners and the map.
export function renderMapPlayer({ container, timeline, events }) {
  const located = getLocatedEvents(events);
  const scopes = buildScopes(timeline, located);
  const summary = summarizeMap(timeline, events);
  const settings = readMapSettings();
  const narrowQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(MAP_NARROW_QUERY)
    : null;

  let stage = null;
  let map = null;
  let tileLayer = null;
  let lineLayer = null;
  let arrowLayer = null;
  let dotLayer = null;
  let tilesLoaded = false;
  let resizeObserver = null;
  let reducedMotion = false;
  let destroyed = false;

  let scope = scopes[0];
  let selected = null;
  let selectedDot = null;
  let dots = [];
  let dotByEvent = new Map();
  let markerByDot = new Map();
  let numbers = new Map();
  let arrowSegments = [];
  let showNumbers = false;
  const panelOpen = { left: false, right: false };
  let lightbox = null;

  container.classList.add("map-mode");
  container.innerHTML = renderMapLauncherMarkup(summary);
  const openButton = container.querySelector('[data-action="open"]');
  openButton?.addEventListener("click", openStage);

  return { destroy };

  function destroy() {
    destroyed = true;
    closeStage();
    container.classList.remove("map-mode");
  }

  // ---- opening and closing the stage --------------------------------------

  function openStage() {
    if (stage || destroyed || located.length === 0) return;
    reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const el = document.createElement("div");
    el.className = "mp-stage";
    el.tabIndex = -1;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Map");

    const Leaflet = globalThis.L;
    const hasLeaflet = Boolean(Leaflet) && typeof Leaflet.map === "function";
    el.innerHTML = hasLeaflet ? renderMapStageMarkup(scopes) : renderMapMissingMarkup();
    stage = {
      el,
      mapEl: el.querySelector(".mp-map"),
      tilesNoteEl: el.querySelector(".mp-tiles-note"),
      panels: { left: el.querySelector(".mp-left"), right: el.querySelector(".mp-right") },
      tabs: { left: el.querySelector(".mp-tab-left"), right: el.querySelector(".mp-tab-right") },
      scopesEl: el.querySelector(".mp-scopes"),
      listTitleEl: el.querySelector(".mp-list-title"),
      listEl: el.querySelector(".mp-list"),
      detailsEl: el.querySelector(".mp-details"),
      countEl: el.querySelector(".mp-count"),
      prevEl: el.querySelector('[data-action="prev"]'),
      nextEl: el.querySelector('[data-action="next"]'),
      fullscreenEl: el.querySelector('[data-action="fullscreen"]'),
      lightboxEl: el.querySelector(".mp-lightbox"),
      announceEl: el.querySelector(".mp-announce")
    };

    applyColor(el);
    el.addEventListener("click", onStageClick);
    el.addEventListener("change", onSettingChange);
    document.body.append(el);
    document.documentElement.classList.add("mp-lock");
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", updateFullscreenButton);
    el.focus();

    if (!hasLeaflet) return;
    narrowQuery?.addEventListener?.("change", applyPanels);

    scope = scopes[0];
    selected = null;
    selectedDot = null;
    panelOpen.left = settings.leftPinned && !isNarrow();
    panelOpen.right = settings.rightPinned && !isNarrow();

    map = Leaflet.map(stage.mapEl, {
      keyboard: false,
      zoomControl: true,
      worldCopyJump: false,
      minZoom: 1,
      maxZoom: getTileSource(settings.tileSource).maxZoom,
      zoomAnimation: !reducedMotion,
      fadeAnimation: !reducedMotion,
      markerZoomAnimation: !reducedMotion
    });
    map.setView([0, 0], 2, { animate: false });
    lineLayer = Leaflet.layerGroup().addTo(map);
    arrowLayer = Leaflet.layerGroup().addTo(map);
    dotLayer = Leaflet.layerGroup().addTo(map);
    map.on("zoomend", drawArrows);
    map.on("click", () => {
      if (closeUnpinnedPanels()) applyPanels();
    });
    applyTileSource();

    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(() => map?.invalidateSize({ animate: false }));
      resizeObserver.observe(stage.mapEl);
    }

    paintScopes();
    syncSettingsUi();
    applyPanels();
    redraw();
    paintList();
    paintDetails();
    syncTransport();
    fitScope(false);
  }

  function closeStage() {
    if (!stage) return;
    closeLightbox(false);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("fullscreenchange", updateFullscreenButton);
    narrowQuery?.removeEventListener?.("change", applyPanels);
    resizeObserver?.disconnect();
    resizeObserver = null;
    exitFullscreen();
    map?.remove();
    map = null;
    tileLayer = lineLayer = arrowLayer = dotLayer = null;
    stage.el.remove();
    document.documentElement.classList.remove("mp-lock");
    stage = null;
    markerByDot = new Map();
    if (!destroyed) openButton?.focus?.();
  }

  function isNarrow() {
    return Boolean(narrowQuery?.matches);
  }

  // ---- settings -----------------------------------------------------------

  function saveSettings() {
    writeMapSettings(settings);
  }

  function onSettingChange(event) {
    const input = event.target.closest?.("[data-setting]");
    if (!input) return;
    const key = input.dataset.setting;
    if (key === "tileSource") {
      settings.tileSource = input.value;
      applyTileSource();
    } else if (key === "lines") {
      settings.lines = input.value;
      redraw();
    } else if (key === "arrows" || key === "numbers") {
      settings[key] = input.checked;
      redraw();
    } else if (key === "openDetails") {
      settings.openDetails = input.checked;
    }
    settings.tileSource = normalizeMapSettings(settings).tileSource;
    saveSettings();
    syncSettingsUi();
  }

  function syncSettingsUi() {
    if (!stage?.el) return;
    const root = stage.el;
    const tileSelect = root.querySelector('[data-setting="tileSource"]');
    if (tileSelect) tileSelect.value = settings.tileSource;
    const linesSelect = root.querySelector('[data-setting="lines"]');
    if (linesSelect) {
      linesSelect.value = settings.lines === "collection" && scopes.length < 2 ? "off" : settings.lines;
      linesSelect.disabled = scope.id !== null;
      linesSelect.querySelector('option[value="collection"]').disabled = scopes.length < 2;
    }
    root.querySelector(".mp-lines-hint").hidden = scope.id === null;
    for (const swatch of root.querySelectorAll(".mp-swatch")) {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.color === settings.color));
    }
    root.querySelector('[data-setting="arrows"]').checked = effectiveArrows(settings);
    root.querySelector('[data-setting="numbers"]').checked = effectiveNumbers(settings, scope);
    root.querySelector('[data-setting="openDetails"]').checked = settings.openDetails;
  }

  function applyColor(el = stage?.el) {
    if (!el) return;
    const color = getMapColor(settings.color);
    el.style.setProperty("--mp-color", color.value);
    el.style.setProperty("--mp-ink", color.ink);
    el.style.setProperty("--mp-edge", color.edge);
    el.style.setProperty("--mp-strong", color.strong);
  }

  // ---- tiles --------------------------------------------------------------

  function applyTileSource() {
    const Leaflet = globalThis.L;
    tileLayer?.remove();
    const source = getTileSource(settings.tileSource);
    tilesLoaded = false;
    stage.tilesNoteEl.hidden = true;
    map.setMaxZoom(source.maxZoom);
    tileLayer = Leaflet.tileLayer(source.url, {
      attribution: source.attribution,
      maxZoom: source.maxZoom,
      maxNativeZoom: source.maxNativeZoom,
      subdomains: source.subdomains || "abc",
      tileSize: source.tileSize || 256,
      zoomOffset: source.zoomOffset || 0
    });
    // A failed tile is never an error dialog. Only when none has loaded is the
    // whole source called unavailable, so one missing tile doesn't raise it.
    tileLayer.on("tileload", () => {
      tilesLoaded = true;
      stage.tilesNoteEl.hidden = true;
    });
    tileLayer.on("tileerror", () => {
      if (!tilesLoaded) stage.tilesNoteEl.hidden = false;
    });
    tileLayer.addTo(map);
  }

  // ---- drawing ------------------------------------------------------------

  function redraw() {
    if (!map) return;
    const Leaflet = globalThis.L;
    lineLayer.clearLayers();
    dotLayer.clearLayers();
    markerByDot = new Map();

    const paths = buildPaths(scopes, scope, settings.lines);
    numbers = numberEvents(paths, scope);
    showNumbers = effectiveNumbers(settings, scope);
    dots = groupDots(scope.events);
    dotByEvent = new Map();
    for (const dot of dots) {
      for (const event of dot.events) dotByEvent.set(event, dot);
    }
    selectedDot = selected ? dotByEvent.get(selected) ?? null : null;

    const color = getMapColor(settings.color);
    arrowSegments = [];
    for (const path of paths) {
      const segments = buildSegments(path.events);
      arrowSegments.push(...segments);
      if (segments.length === 0) continue;
      const points = [[segments[0].from.lat, segments[0].from.lng]];
      for (const segment of segments) points.push([segment.to.lat, segment.to.lng]);
      // An outline keeps the dashes readable over any background.
      Leaflet.polyline(points, { color: color.edge, weight: 8, opacity: 0.6, interactive: false }).addTo(lineLayer);
      Leaflet.polyline(points, { color: color.value, weight: 4.5, opacity: 0.9, dashArray: "11 9", interactive: false }).addTo(lineLayer);
    }

    for (const dot of dots) {
      const marker = Leaflet.marker([dot.lat, dot.lng], {
        icon: makeDotIcon(dot),
        keyboard: false,
        riseOnHover: true
      });
      marker.bindTooltip(makeTooltipElement(dot), { direction: "top", offset: [0, -12], opacity: 1 });
      marker.on("click", () => selectEvent(dot.events.includes(selected) ? selected : dot.events[0]));
      marker.setZIndexOffset(dot === selectedDot ? 1000 : 0);
      marker.addTo(dotLayer);
      markerByDot.set(dot, marker);
    }
    drawArrows();
  }

  // Arrowheads sit at each segment's midpoint and point along its direction on
  // screen, so they are placed again whenever the zoom changes.
  function drawArrows() {
    if (!map) return;
    const Leaflet = globalThis.L;
    arrowLayer.clearLayers();
    if (!effectiveArrows(settings)) return;
    for (const segment of arrowSegments) {
      const a = map.latLngToContainerPoint([segment.from.lat, segment.from.lng]);
      const b = map.latLngToContainerPoint([segment.to.lat, segment.to.lng]);
      if (!showsArrow(a, b)) continue;
      const middle = map.containerPointToLatLng(Leaflet.point((a.x + b.x) / 2, (a.y + b.y) / 2));
      const angle = screenAngle(a, b);
      Leaflet.marker(middle, {
        icon: Leaflet.divIcon({
          className: "mp-arrow-box",
          html: `<span class="mp-arrow" style="transform: rotate(${angle.toFixed(1)}deg)"></span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: -500
      }).addTo(arrowLayer);
    }
  }

  function makeDotIcon(dot) {
    const label = showNumbers ? dotLabel(dot, numbers) : "";
    const isSelected = dot === selectedDot;
    const classes = ["mp-dot"];
    if (isSelected) classes.push("is-selected");
    if (label) classes.push("has-label");
    return globalThis.L.divIcon({
      className: "mp-dot-box",
      html: `<span class="${classes.join(" ")}">${escapeHtml(label)}${dot.events.length > 1 ? `<span class="mp-badge">${dot.events.length}</span>` : ""}</span>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
  }

  function makeTooltipElement(dot) {
    const span = document.createElement("span");
    const more = dot.events.length > 1 ? ` (+${dot.events.length - 1} more)` : "";
    span.textContent = `${getEventTitle(dot.events[0])}${more}`;
    return span;
  }

  function refreshDotIcon(dot) {
    const marker = dot ? markerByDot.get(dot) : null;
    if (!marker) return;
    marker.setIcon(makeDotIcon(dot));
    marker.setZIndexOffset(dot === selectedDot ? 1000 : 0);
  }

  // ---- camera -------------------------------------------------------------

  function fitScope(animate) {
    if (!map) return;
    const target = fitTarget(scope.events.map((event) => event.geo));
    if (!target) return;
    const animated = animate && !reducedMotion;
    if (target.kind === "point") {
      if (animated) map.flyTo([target.lat, target.lng], target.zoom, { duration: 1 });
      else map.setView([target.lat, target.lng], target.zoom, { animate: false });
      return;
    }
    const bounds = [[target.south, target.west], [target.north, target.east]];
    const options = {
      paddingTopLeft: MAP_FIT_PADDING_TOP_LEFT,
      paddingBottomRight: MAP_FIT_PADDING_BOTTOM_RIGHT,
      maxZoom: FIT_MAX_ZOOM
    };
    if (animated) map.flyToBounds(bounds, { ...options, duration: 1 });
    else map.fitBounds(bounds, { ...options, animate: false });
  }

  // flyTo keeps the current zoom, and zooms out and back in on its own when the
  // target is far away.
  function flyToEvent(event) {
    if (!map) return;
    const target = [event.geo.lat, event.geo.lng];
    if (reducedMotion) map.setView(target, map.getZoom(), { animate: false });
    else map.flyTo(target, map.getZoom(), { duration: 1 });
  }

  // ---- scope and selection ------------------------------------------------

  function setScope(id) {
    const next = findScope(scopes, id);
    if (next === scope) return;
    scope = next;
    if (selected && !scope.events.includes(selected)) selected = null;
    redraw();
    paintScopes();
    paintList();
    paintDetails();
    syncTransport();
    syncSettingsUi();
    fitScope(true);
  }

  function selectEvent(event, { fly = true } = {}) {
    if (!stage || !event) return;
    const previousDot = selectedDot;
    selected = event;
    selectedDot = dotByEvent.get(event) ?? null;
    if (previousDot !== selectedDot) refreshDotIcon(previousDot);
    refreshDotIcon(selectedDot);
    syncList();
    paintDetails();
    syncTransport();
    stage.announceEl.textContent = getEventTitle(event);
    if (settings.openDetails) openPanel("right");
    if (fly) flyToEvent(event);
  }

  function step(direction) {
    const next = stepIndex(selected ? scope.events.indexOf(selected) : -1, scope.events.length, direction, false);
    if (next !== null) selectEvent(scope.events[next]);
  }

  // ---- panels -------------------------------------------------------------

  function openPanel(side) {
    if (!stage || panelOpen[side]) return;
    panelOpen[side] = true;
    // A narrow screen has room for one sheet at a time.
    if (isNarrow()) panelOpen[side === "left" ? "right" : "left"] = false;
    applyPanels();
  }

  function togglePanel(side) {
    if (panelOpen[side]) panelOpen[side] = false;
    else {
      panelOpen[side] = true;
      if (isNarrow()) panelOpen[side === "left" ? "right" : "left"] = false;
    }
    applyPanels();
  }

  function isPinned(side) {
    return !isNarrow() && settings[`${side}Pinned`];
  }

  function togglePin(side) {
    settings[`${side}Pinned`] = !settings[`${side}Pinned`];
    saveSettings();
    if (settings[`${side}Pinned`]) panelOpen[side] = true;
    applyPanels();
  }

  // Closes flyouts that are open but not pinned. Returns whether it closed any.
  function closeUnpinnedPanels() {
    let closed = false;
    for (const side of ["left", "right"]) {
      if (panelOpen[side] && !isPinned(side)) {
        panelOpen[side] = false;
        closed = true;
      }
    }
    return closed;
  }

  function applyPanels() {
    if (!stage) return;
    if (isNarrow() && panelOpen.left && panelOpen.right) panelOpen.left = false;
    for (const side of ["left", "right"]) {
      const open = panelOpen[side];
      const pinned = isPinned(side);
      const panel = stage.panels[side];
      panel.classList.toggle("is-open", open);
      panel.classList.toggle("is-docked", open && pinned);
      const pinButton = panel.querySelector('[data-action="pin"]');
      pinButton.setAttribute("aria-pressed", String(settings[`${side}Pinned`]));
      pinButton.hidden = isNarrow();
      stage.tabs[side].hidden = open;
      stage.tabs[side].setAttribute("aria-expanded", String(open));
    }
    // The map narrows or widens to fit; it keeps its centre and zoom.
    map?.invalidateSize({ animate: false });
  }

  // ---- left panel ---------------------------------------------------------

  function paintScopes() {
    stage.scopesEl.innerHTML = scopes.map((item) => `
      <button class="mp-scope" type="button" data-scope="${item.id === null ? "" : escapeHtml(item.id)}" aria-pressed="${item === scope}">
        <span>${escapeHtml(item.title)}</span><span class="mp-scope-count">${item.events.length}</span>
      </button>
    `).join("");
  }

  function paintList() {
    stage.listTitleEl.textContent = scope.id === null ? "All events" : scope.title;
    stage.listEl.innerHTML = scope.events.map((event, index) => `
      <li><button class="mp-row" type="button" data-index="${index}">
        <span class="mp-row-date">${escapeHtml(formatDisplayRange(event.timestamp, event.endTimestamp))}</span>
        <span class="mp-row-title">${escapeHtml(getEventTitle(event))}</span>
      </button></li>
    `).join("");
    syncList();
  }

  function syncList() {
    const rows = stage.listEl.querySelectorAll(".mp-row");
    rows.forEach((row, index) => {
      const isSelected = scope.events[index] === selected;
      row.classList.toggle("is-selected", isSelected);
      if (isSelected) {
        row.setAttribute("aria-current", "true");
        row.scrollIntoView?.({ block: "nearest" });
      } else {
        row.removeAttribute("aria-current");
      }
    });
  }

  // ---- right panel --------------------------------------------------------

  function paintDetails() {
    if (!selected) {
      stage.detailsEl.innerHTML = `<p class="mp-empty">Select an event</p>`;
      return;
    }
    const info = describeMapEvent(timeline, selected);
    const siblings = dotByEvent.get(selected)?.events ?? [selected];
    const rows = [
      ["Date", info.date],
      ["Location", info.location],
      ["Coordinates", info.coordinates],
      ["Type", info.type],
      ["Collections", info.collections.join(", ")],
      ...info.fields.map((field) => [field.label, field.value])
    ].filter(([, value]) => value);

    stage.detailsEl.innerHTML = `
      ${siblings.length > 1 ? `
        <div class="mp-shared">
          <div class="mp-shared-title">${siblings.length} events at this place</div>
          ${siblings.map((event) => `
            <button class="mp-shared-row${event === selected ? " is-selected" : ""}" type="button" data-index="${scope.events.indexOf(event)}">
              <span>${escapeHtml(getEventTitle(event))}</span>
              <span class="mp-row-date">${escapeHtml(formatDisplayRange(event.timestamp, event.endTimestamp))}</span>
            </button>
          `).join("")}
        </div>
      ` : ""}
      <h3 class="mp-event-title">${escapeHtml(info.title)}</h3>
      <dl class="mp-fields">
        ${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
      </dl>
      ${info.photos.length > 0 ? `
        <div class="mp-photos">
          ${info.photos.map((photo, index) => `
            <button class="mp-photo" type="button" data-photo="${index}" aria-label="${escapeHtml(photo.caption || `Photo ${index + 1}`)}">
              <img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.caption)}" loading="lazy">
            </button>
          `).join("")}
        </div>
      ` : ""}
    `;
  }

  // ---- transport ----------------------------------------------------------

  function syncTransport() {
    if (!stage) return;
    const count = scope.events.length;
    const index = selected ? scope.events.indexOf(selected) : -1;
    stage.countEl.textContent = index >= 0 ? `${index + 1} / ${count}` : `${count} event${count === 1 ? "" : "s"}`;
    stage.prevEl.disabled = stepIndex(index, count, -1) === null;
    stage.nextEl.disabled = stepIndex(index, count, 1) === null;
  }

  // ---- lightbox -----------------------------------------------------------

  function openLightbox(index, opener) {
    if (!selected) return;
    const photos = describeMapEvent(timeline, selected).photos;
    if (!photos[index]) return;
    lightbox = { photos, index, opener };
    paintLightbox();
    stage.lightboxEl.hidden = false;
    stage.lightboxEl.querySelector('[data-action="lightbox-close"]').focus();
  }

  function paintLightbox() {
    const { photos, index } = lightbox;
    const photo = photos[index];
    const image = stage.lightboxEl.querySelector(".mp-lightbox-image");
    image.src = photo.src;
    image.alt = photo.caption;
    stage.lightboxEl.querySelector(".mp-lightbox-caption").textContent = photo.caption;
    stage.lightboxEl.querySelector(".mp-lightbox-count").textContent = photos.length > 1 ? `${index + 1} / ${photos.length}` : "";
    for (const action of ["lightbox-prev", "lightbox-next"]) {
      const button = stage.lightboxEl.querySelector(`[data-action="${action}"]`);
      button.hidden = photos.length < 2;
      button.disabled = action === "lightbox-prev" ? index === 0 : index === photos.length - 1;
    }
  }

  function stepLightbox(direction) {
    const next = stepIndex(lightbox.index, lightbox.photos.length, direction, false);
    if (next === null) return;
    lightbox.index = next;
    paintLightbox();
  }

  function closeLightbox(restoreFocus = true) {
    if (!lightbox) return;
    const { opener } = lightbox;
    lightbox = null;
    if (stage) {
      stage.lightboxEl.hidden = true;
      stage.lightboxEl.querySelector(".mp-lightbox-image").removeAttribute("src");
    }
    if (restoreFocus && opener?.isConnected) opener.focus();
  }

  // ---- clicks and keys ----------------------------------------------------

  function onStageClick(event) {
    const target = event.target;
    if (lightbox && target === stage.lightboxEl) {
      closeLightbox();
      return;
    }
    const scopeButton = target.closest(".mp-scope");
    if (scopeButton) {
      setScope(scopeButton.dataset.scope === "" ? null : scopeButton.dataset.scope);
      return;
    }
    const rowButton = target.closest(".mp-row, .mp-shared-row");
    if (rowButton) {
      selectEvent(scope.events[Number(rowButton.dataset.index)]);
      return;
    }
    const photoButton = target.closest(".mp-photo");
    if (photoButton) {
      openLightbox(Number(photoButton.dataset.photo), photoButton);
      return;
    }
    const swatch = target.closest(".mp-swatch");
    if (swatch) {
      settings.color = swatch.dataset.color;
      saveSettings();
      applyColor();
      syncSettingsUi();
      redraw();
      return;
    }
    const button = target.closest("[data-action]");
    if (button && !button.disabled) runAction(button.dataset.action, button);
  }

  function runAction(action, button) {
    const side = button.closest(".mp-left, .mp-tab-left") ? "left" : "right";
    if (action === "prev") step(-1);
    else if (action === "next") step(1);
    else if (action === "tab") togglePanel(button.dataset.side);
    else if (action === "close-panel") togglePanel(side);
    else if (action === "pin") togglePin(side);
    else if (action === "fullscreen") toggleFullscreen();
    else if (action === "exit") closeStage();
    else if (action === "lightbox-close") closeLightbox();
    else if (action === "lightbox-prev") stepLightbox(-1);
    else if (action === "lightbox-next") stepLightbox(1);
  }

  function onKeyDown(event) {
    if (!stage || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target.closest?.("input, textarea, select")) return;
    const key = event.key;

    if (lightbox) {
      if (key === "Escape") {
        event.preventDefault();
        closeLightbox();
      } else if (key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        stepLightbox(key === "ArrowRight" ? 1 : -1);
      }
      return;
    }

    if (!map) {
      if (key === "Escape") closeStage();
      return;
    }
    if (key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (key === "l" || key === "L") {
      togglePanel("left");
    } else if (key === "d" || key === "D") {
      togglePanel("right");
    } else if (key === "f" || key === "F") {
      toggleFullscreen();
    } else if (key === "Escape") {
      // Unpinned flyouts first, then full screen, then the stage itself.
      if (closeUnpinnedPanels()) applyPanels();
      else if (document.fullscreenElement) exitFullscreen();
      else closeStage();
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) exitFullscreen();
    else requestFullscreen();
  }

  function requestFullscreen() {
    if (!stage?.el.requestFullscreen) return;
    try {
      stage.el.requestFullscreen()?.catch?.(() => {});
    } catch {
      // Full screen is a nicety; the stage still fills the window without it.
    }
  }

  function exitFullscreen() {
    if (!document.fullscreenElement || !document.exitFullscreen) return;
    try {
      document.exitFullscreen()?.catch?.(() => {});
    } catch {
      // Nothing to do if the browser refuses.
    }
  }

  function updateFullscreenButton() {
    stage?.fullscreenEl?.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
  }
}

function readMapSettings() {
  try {
    return normalizeMapSettings(JSON.parse(localStorage.getItem(MAP_SETTINGS_KEY)));
  } catch {
    return normalizeMapSettings(null);
  }
}

function writeMapSettings(settings) {
  try {
    localStorage.setItem(MAP_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings just won't be remembered.
  }
}

function mapPlural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatMapSpan(span) {
  const start = formatDisplayDate(span.startDate);
  const end = formatDisplayDate(span.endDate);
  return start === end ? start : `${start} – ${end}`;
}

// The timeline's title isn't repeated here: both hosts already show it in their header.
function renderMapLauncherMarkup(summary) {
  const hasPlaces = summary.locatedCount > 0;
  const lead = hasPlaces
    ? `${summary.locatedCount} of ${mapPlural(summary.totalCount, "event")} ${summary.locatedCount === 1 ? "has" : "have"} a location`
    : "No events have a location";
  const detail = hasPlaces
    ? [summary.collectionCount > 0 ? mapPlural(summary.collectionCount, "collection") : "", summary.span ? formatMapSpan(summary.span) : ""].filter(Boolean).join(" · ")
    : "Add coordinates to events in the editor to see them here.";
  const skipped = hasPlaces && summary.locatedCount < summary.totalCount
    ? `<p class="mp-setup-note">The other ${summary.totalCount - summary.locatedCount} won't appear on the map.</p>`
    : "";

  return `
    <section class="mp-setup" aria-label="Map">
      <p class="mp-setup-lead">${escapeHtml(lead)}</p>
      ${detail ? `<p class="mp-setup-detail">${escapeHtml(detail)}</p>` : ""}
      ${skipped}
      <button class="mp-open" type="button" data-action="open"${hasPlaces ? "" : " disabled"}>
        ${renderMapIcon("map")} Open map
      </button>
      <p class="mp-hint">← → step · L list · D details · F full screen · Esc exit</p>
    </section>
  `;
}

function renderMapMissingMarkup() {
  return `
    <div class="mp-missing">
      <p>The map library didn't load.</p>
      <button class="mp-open" type="button" data-action="exit">Close</button>
    </div>
  `;
}

function renderMapStageMarkup(scopes) {
  const tileOptions = TILE_SOURCES.map((source) => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.label)}</option>`).join("");
  return `
    <div class="mp-body">
      <aside class="mp-panel mp-left" aria-label="Events and settings">
        <header class="mp-panel-head">
          <h2>Events</h2>
          <span class="mp-head-actions">
            <button class="mp-icon-btn" type="button" data-action="pin" aria-pressed="false" aria-label="Pin panel" title="Pin panel">${renderMapIcon("pin")}</button>
            <button class="mp-icon-btn" type="button" data-action="close-panel" aria-label="Close panel (L)" title="Close panel (L)">${renderMapIcon("close")}</button>
          </span>
        </header>
        <div class="mp-panel-body">
          <div class="mp-scopes" role="group" aria-label="Show"></div>
          <details class="mp-settings">
            <summary>Settings</summary>
            <label class="mp-field">Map <select data-setting="tileSource">${tileOptions}</select></label>
            <div class="mp-field">Color
              <span class="mp-swatches" role="group" aria-label="Color of dots and lines">
                ${MAP_COLORS.map((color) => `<button class="mp-swatch" type="button" data-color="${color.id}" style="background: ${color.value}" aria-pressed="false" aria-label="${color.label}" title="${color.label}"></button>`).join("")}
              </span>
            </div>
            <label class="mp-field">Lines
              <select data-setting="lines">
                <option value="off">Off</option>
                <option value="collection">Per collection</option>
                <option value="all">All in date order</option>
              </select>
            </label>
            <p class="mp-lines-hint" hidden>Applies to All events. A collection is always connected.</p>
            <label class="mp-check"><input type="checkbox" data-setting="arrows"> Arrows</label>
            <label class="mp-check"><input type="checkbox" data-setting="numbers"> Numbers</label>
            <label class="mp-check"><input type="checkbox" data-setting="openDetails"> Open details on select</label>
          </details>
          <h3 class="mp-list-title"></h3>
          <ol class="mp-list"></ol>
        </div>
      </aside>

      <div class="mp-mapwrap">
        <div class="mp-map"></div>
        <div class="mp-tiles-note" hidden>Map tiles unavailable</div>
        <button class="mp-tab mp-tab-left" type="button" data-action="tab" data-side="left" aria-expanded="false" aria-label="Show events (L)" title="Events (L)">${renderMapIcon("list")}</button>
        <button class="mp-tab mp-tab-right" type="button" data-action="tab" data-side="right" aria-expanded="false" aria-label="Show details (D)" title="Details (D)">${renderMapIcon("info")}</button>
        <div class="mp-toolbar">
          <button class="mp-icon-btn" type="button" data-action="fullscreen" aria-pressed="false" aria-label="Full screen (F)" title="Full screen (F)">${renderMapIcon("fullscreen")}</button>
          <button class="mp-icon-btn" type="button" data-action="exit" aria-label="Exit map (Esc)" title="Exit map (Esc)">${renderMapIcon("close")}</button>
        </div>
        <div class="mp-transport">
          <button class="mp-step" type="button" data-action="prev" aria-label="Previous event" title="Previous event (←)">${renderMapIcon("back")}</button>
          <span class="mp-count" aria-hidden="true"></span>
          <button class="mp-step" type="button" data-action="next" aria-label="Next event" title="Next event (→)">${renderMapIcon("forward")}</button>
        </div>
      </div>

      <aside class="mp-panel mp-right" aria-label="Selected event">
        <header class="mp-panel-head">
          <h2>Details</h2>
          <span class="mp-head-actions">
            <button class="mp-icon-btn" type="button" data-action="pin" aria-pressed="false" aria-label="Pin panel" title="Pin panel">${renderMapIcon("pin")}</button>
            <button class="mp-icon-btn" type="button" data-action="close-panel" aria-label="Close panel (D)" title="Close panel (D)">${renderMapIcon("close")}</button>
          </span>
        </header>
        <div class="mp-panel-body mp-details"></div>
      </aside>
    </div>
    <div class="mp-announce" aria-live="polite"></div>
    <div class="mp-lightbox" role="dialog" aria-modal="true" aria-label="Photo" hidden>
      <button class="mp-lightbox-btn mp-lightbox-close" type="button" data-action="lightbox-close" aria-label="Close photo (Esc)">${renderMapIcon("close")}</button>
      <button class="mp-lightbox-btn mp-lightbox-prev" type="button" data-action="lightbox-prev" aria-label="Previous photo">${renderMapIcon("back")}</button>
      <figure class="mp-lightbox-figure">
        <img class="mp-lightbox-image" alt="">
        <figcaption><span class="mp-lightbox-caption"></span> <span class="mp-lightbox-count"></span></figcaption>
      </figure>
      <button class="mp-lightbox-btn mp-lightbox-next" type="button" data-action="lightbox-next" aria-label="Next photo">${renderMapIcon("forward")}</button>
    </div>
  `;
}

const MAP_ICONS = {
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"></path><path d="M9 4v14"></path><path d="M15 6v14"></path>',
  pin: '<path d="M12 17v5"></path><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"></path>',
  close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  fullscreen: '<path d="M4 9V4h5"></path><path d="M20 9V4h-5"></path><path d="M4 15v5h5"></path><path d="M20 15v5h-5"></path>',
  list: '<path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6h.01"></path><path d="M3 12h.01"></path><path d="M3 18h.01"></path>',
  info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path>',
  back: '<path d="m15 18-6-6 6-6"></path>',
  forward: '<path d="m9 18 6-6-6-6"></path>'
};

function renderMapIcon(name) {
  return `<svg class="mp-icon" viewBox="0 0 24 24" aria-hidden="true">${MAP_ICONS[name]}</svg>`;
}
