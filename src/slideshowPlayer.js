import { escapeHtml } from "./eventCard.js";
import { formatDisplayDate } from "./timeline.js";
import { createChromeState } from "./slideshowChrome.js";
import {
  MAX_DELAY_SECONDS,
  MIN_DELAY_SECONDS,
  buildSlides,
  clampDelay,
  describeEvent,
  normalizeSlideshowSettings,
  summarizeSlides
} from "./slideshowModel.js";

const SETTINGS_KEY = "timeline-slideshow-settings";
const FADE_MS = 300;
const DETAILS_MS = 4000;
const SWIPE_PX = 50;
const TAP_PX = 10;

// A photo slideshow. The container holds a setup panel (what will play, the
// settings, a Play button). Play opens the stage: a full-viewport overlay with no
// header, a fade between slides and a playback bar that stays out of the way.
// The behavior is specified in docs/players/slideshow.md. Returns { destroy }
// because the stage lives outside the container (on <body>) and owns timers and
// document listeners.
export function renderSlideshowPlayer({ container, timeline, events }) {
  const allSlides = buildSlides(timeline, events);
  const summary = summarizeSlides(allSlides);
  const settings = readSlideshowSettings();
  const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fadeMs = reducedMotion ? 0 : FADE_MS;
  const chrome = createChromeState();
  const timers = new Set();

  let stage = null;
  let slides = [];
  let index = -1;
  let paused = false;
  let ready = false;
  let detailsExpired = false;
  let destroyed = false;
  let navToken = 0;
  let advanceTimer = null;
  let detailsTimer = null;
  let chromeTimer = null;
  let preloaded = null;
  let mouseIsPointer = false;

  container.classList.add("slideshow-mode");
  container.innerHTML = renderSetupMarkup(summary, allSlides.length > 0);
  const setupRoot = container.querySelector(".ss-setup");
  const playButton = setupRoot.querySelector('[data-action="play"]');

  setupRoot.addEventListener("change", onSettingChange);
  playButton?.addEventListener("click", openStage);
  document.addEventListener("keydown", onKeyDown);
  syncControls();

  return { destroy };

  function destroy() {
    destroyed = true;
    navToken += 1;
    closeStage();
    document.removeEventListener("keydown", onKeyDown);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    container.classList.remove("slideshow-mode");
  }

  // ---- timers -------------------------------------------------------------

  function later(callback, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      callback();
    }, ms);
    timers.add(id);
    return id;
  }

  function cancel(id) {
    if (id === null) return;
    clearTimeout(id);
    timers.delete(id);
  }

  function sleep(ms) {
    return ms <= 0 ? Promise.resolve() : new Promise((resolve) => later(resolve, ms));
  }

  // ---- settings -----------------------------------------------------------

  function onSettingChange(event) {
    const input = event.target.closest?.("[data-setting]");
    if (!input) return;
    const key = input.dataset.setting;
    if (key === "delay") settings.delay = clampDelay(input.value);
    else settings[key] = input.checked;
    writeSlideshowSettings(settings);
    syncControls();

    if (stage) {
      if (key === "autoAdvance") syncRunState();
      if (key === "delay") armAdvance();
      if (key === "details") refreshOverlays();
      if (input.type === "number") {
        input.blur();
        stage.el.focus();
      }
    }
  }

  function syncControls() {
    for (const root of [setupRoot, stage?.barEl]) {
      if (!root) continue;
      for (const input of root.querySelectorAll("[data-setting]")) {
        const key = input.dataset.setting;
        if (key === "delay") {
          input.value = settings.delay;
          input.disabled = !settings.autoAdvance;
        } else {
          input.checked = settings[key];
        }
      }
    }
  }

  // ---- opening and closing the stage --------------------------------------

  function openStage() {
    if (stage || destroyed || allSlides.length === 0) return;
    slides = allSlides.slice();
    index = -1;
    paused = false;
    ready = false;
    detailsExpired = false;

    const el = document.createElement("div");
    el.className = "ss-stage";
    el.tabIndex = -1;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Slideshow");
    el.innerHTML = renderStageMarkup();
    stage = {
      el,
      slideEl: el.querySelector(".ss-slide"),
      backdropEl: el.querySelector(".ss-backdrop"),
      imageEl: el.querySelector(".ss-image"),
      collectionEl: el.querySelector(".ss-collection"),
      detailsEl: el.querySelector(".ss-details"),
      detailsTitleEl: el.querySelector(".ss-details-title"),
      detailsMetaEl: el.querySelector(".ss-details-meta"),
      captionEl: el.querySelector(".ss-caption"),
      announceEl: el.querySelector(".ss-announce"),
      flashEl: el.querySelector(".ss-flash"),
      revealEl: el.querySelector(".ss-reveal"),
      barEl: el.querySelector(".ss-bar"),
      playPauseEl: el.querySelector('[data-action="playpause"]'),
      fullscreenEl: el.querySelector('[data-action="fullscreen"]'),
      countEl: el.querySelector(".ss-count")
    };
    wireStage();

    document.body.append(el);
    document.documentElement.classList.add("ss-lock");
    document.addEventListener("fullscreenchange", updateFullscreenButton);
    // Full screen must be asked for inside the click or key press that got us here.
    if (settings.fullscreen) requestFullscreen();

    syncControls();
    syncRunState();
    el.focus();
    showSlide(0, 1, true);
  }

  function closeStage() {
    if (!stage) return;
    navToken += 1;
    cancel(advanceTimer);
    cancel(detailsTimer);
    cancel(chromeTimer);
    advanceTimer = detailsTimer = chromeTimer = null;
    document.removeEventListener("fullscreenchange", updateFullscreenButton);
    exitFullscreen();
    stage.el.remove();
    document.documentElement.classList.remove("ss-lock");
    stage = null;
    ready = false;
    preloaded = null;
    mouseIsPointer = false;
    syncControls();
    if (!destroyed) playButton?.focus?.();
  }

  function wireStage() {
    const { el, revealEl, barEl } = stage;

    // :hover sticks after a touch, so it is only trusted while a mouse or pen is the pointer.
    for (const type of ["pointerover", "pointermove", "pointerdown"]) {
      el.addEventListener(type, (event) => {
        mouseIsPointer = event.pointerType !== "touch";
      }, true);
    }

    el.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      chrome.pointerMoved();
      // A mouse that is somewhere else has left the bar, even if the browser never
      // sent the bar a mouseleave (it opened under a pointer that was standing still).
      // The reveal button counts as the bar: it sits inside the bar's area.
      if (!event.target.closest(".ss-bar, .ss-reveal")) chrome.barLeft();
      applyChrome();
    });

    for (const type of ["mouseenter", "click"]) {
      revealEl.addEventListener(type, () => {
        chrome.openBar({ pointerInside: mouseIsPointer });
        applyChrome();
      });
    }
    barEl.addEventListener("mouseenter", () => {
      chrome.barEntered();
      applyChrome();
    });
    barEl.addEventListener("mouseleave", () => {
      chrome.barLeft();
      applyChrome();
    });
    barEl.addEventListener("focusout", () => {
      chrome.barLeft();
      applyChrome();
    });
    // Clicking a control must not take keyboard focus from the stage, or Space
    // would then also "click" that control. The delay field is the exception.
    barEl.addEventListener("mousedown", (event) => {
      if (!event.target.closest('input[type="number"]')) event.preventDefault();
    });
    barEl.addEventListener("change", onSettingChange);
    barEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (button && !button.disabled) runAction(button.dataset.action);
    });

    // A mouse click steps: the left third of the screen goes back, the rest goes
    // forward. Touch has its own tap and swipe handling below, and its synthesized
    // click is ignored here.
    // A press that began on the reveal button or bar is never a step, even when the
    // bar swaps in under the button and the browser reports the click on the stage.
    let pressedOnControls = false;
    el.addEventListener("pointerdown", (event) => {
      pressedOnControls = Boolean(event.target.closest(".ss-bar, .ss-reveal"));
    }, true);
    el.addEventListener("click", (event) => {
      if (!mouseIsPointer || pressedOnControls || event.target.closest(".ss-bar, .ss-reveal")) return;
      const { left, width } = el.getBoundingClientRect();
      if (event.clientX - left < width / 3) stepBack();
      else stepForward();
    });

    let touchStart = null;
    el.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" || event.target.closest(".ss-bar, .ss-reveal")) return;
      touchStart = { x: event.clientX, y: event.clientY };
    });
    el.addEventListener("pointerup", (event) => {
      if (!touchStart) return;
      const dx = event.clientX - touchStart.x;
      const dy = event.clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) stepForward();
        else stepBack();
      } else if (Math.abs(dx) < TAP_PX && Math.abs(dy) < TAP_PX) {
        chrome.toggleBar();
        applyChrome();
      }
    });
    el.addEventListener("pointercancel", () => {
      touchStart = null;
    });
  }

  function runAction(action) {
    if (action === "start") goTo(0, 1);
    else if (action === "back") stepBack();
    else if (action === "playpause") togglePlay();
    else if (action === "forward") stepForward();
    else if (action === "end") goTo(slides.length - 1, -1);
    else if (action === "fullscreen") toggleFullscreen();
    else if (action === "exit") closeStage();
  }

  // ---- keyboard -----------------------------------------------------------

  function onKeyDown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;

    if (!stage) {
      // Setup panel: Space or Enter start the show, unless they belong to a control
      // or dialog that has focus.
      if ((event.key === " " || event.key === "Enter") && container.isConnected
        && !target.closest?.("button, a, input, select, textarea, dialog, summary")) {
        event.preventDefault();
        openStage();
      }
      return;
    }

    if (target.closest?.('input[type="number"], textarea, select')) return;
    const key = event.key;

    if (key === " ") {
      event.preventDefault();
      if (event.repeat) return;
      if (settings.autoAdvance) togglePlay(true);
      else stepForward();
    } else if (key === "ArrowRight") {
      event.preventDefault();
      stepForward();
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      stepBack();
    } else if (key === "Home") {
      event.preventDefault();
      goTo(0, 1);
    } else if (key === "End") {
      event.preventDefault();
      goTo(slides.length - 1, -1);
    } else if (key === "f" || key === "F") {
      toggleFullscreen();
    } else if (key === "h" || key === "H") {
      settings.details = !settings.details;
      writeSlideshowSettings(settings);
      syncControls();
      refreshOverlays();
    } else if (key === "Escape") {
      // While in full screen the browser uses Escape to leave it.
      if (!document.fullscreenElement) closeStage();
    }
  }

  // ---- navigation ---------------------------------------------------------

  function isRunning() {
    return Boolean(stage) && settings.autoAdvance && !paused;
  }

  function goTo(target, direction) {
    if (!stage || slides.length === 0) return;
    if (target === index && ready) return;
    showSlide(target, direction);
  }

  function stepForward(auto = false) {
    if (!stage || slides.length === 0) return;
    if (index < slides.length - 1) {
      showSlide(index + 1, 1);
    } else if (settings.loop) {
      showSlide(0, 1);
    } else if (auto) {
      paused = true;
      syncRunState();
    }
  }

  function stepBack() {
    if (!stage || slides.length === 0) return;
    if (index > 0) showSlide(index - 1, -1);
    else if (settings.loop) showSlide(slides.length - 1, -1);
  }

  // `flash` shows the new state briefly in the middle of the screen (for the key,
  // where nothing else on screen would say what happened).
  function togglePlay(flash = false) {
    if (!settings.autoAdvance || !stage) return;
    if (paused && index === slides.length - 1) {
      // The show stopped on the last slide: playing again starts it over.
      paused = false;
      showSlide(0, 1);
    } else {
      paused = !paused;
    }
    syncRunState();
    if (flash) flashPlayState();
  }

  // Restarting the CSS animation needs the class removed and a reflow before it
  // goes back on.
  function flashPlayState() {
    const { flashEl } = stage;
    flashEl.innerHTML = renderIcon(isRunning() ? "play" : "pause");
    flashEl.classList.remove("is-flashing");
    void flashEl.offsetWidth;
    flashEl.classList.add("is-flashing");
  }

  function stale(token) {
    return token !== navToken || !stage;
  }

  // Fades the current slide out, swaps in slide `target` once its image has
  // loaded, and fades it in. A newer call cancels an older one still in flight.
  // `direction` is where to go next if the image can't load; `initial` skips the
  // fade-out because nothing is showing yet.
  async function showSlide(target, direction, initial = false) {
    const token = ++navToken;
    ready = false;
    cancel(advanceTimer);
    cancel(detailsTimer);
    advanceTimer = detailsTimer = null;
    refreshOverlays();

    if (!initial) {
      stage.slideEl.classList.add("is-hidden");
      await sleep(fadeMs);
      if (stale(token)) return;
    }

    const slide = slides[target];
    if (slide.kind === "image") {
      const loaded = await loadImage(stage.imageEl, slide.src);
      if (stale(token)) return;
      if (!loaded) {
        skipBrokenSlide(target, direction);
        return;
      }
      stage.backdropEl.src = slide.src;
    }

    index = target;
    detailsExpired = false;
    paintSlide(slide);
    updateCount();
    stage.slideEl.classList.remove("is-hidden");
    await sleep(fadeMs);
    if (stale(token)) return;

    ready = true;
    refreshOverlays();
    detailsTimer = later(() => {
      detailsExpired = true;
      refreshOverlays();
    }, DETAILS_MS);
    armAdvance();
    preloadNext();
  }

  // A linked image that won't load is dropped, and playback carries on in the
  // direction it was going.
  function skipBrokenSlide(target, direction) {
    slides.splice(target, 1);
    if (slides.length === 0) {
      index = -1;
      paintMessage("None of the photos could be loaded.");
      return;
    }
    const next = direction >= 0 ? Math.min(target, slides.length - 1) : Math.max(target - 1, 0);
    showSlide(next, direction, true);
  }

  function paintMessage(text) {
    stage.slideEl.classList.add("is-collection");
    stage.collectionEl.textContent = text;
    stage.slideEl.classList.remove("is-hidden");
    updateCount();
    syncRunState();
  }

  function paintSlide(slide) {
    const isCollection = slide.kind === "collection";
    stage.slideEl.classList.toggle("is-collection", isCollection);
    if (isCollection) {
      stage.collectionEl.textContent = slide.collection.title;
      stage.announceEl.textContent = slide.collection.title;
      return;
    }
    const info = describeEvent(slide.event);
    stage.imageEl.alt = slide.caption || info.title;
    stage.detailsTitleEl.textContent = info.title;
    stage.detailsMetaEl.textContent = [info.date, info.location].filter(Boolean).join(" · ");
    stage.captionEl.textContent = slide.caption;
    stage.announceEl.textContent = [info.title, slide.caption].filter(Boolean).join(". ");
  }

  function updateCount() {
    stage.countEl.textContent = slides.length > 0 && index >= 0 ? `${index + 1} / ${slides.length}` : "";
  }

  // Details show on an event's first image and fade out after a few seconds while
  // the show runs; the caption stays for the whole slide. Paused (or manual), both
  // stay up so they can be read. Neither shows during a transition.
  function refreshOverlays() {
    if (!stage) return;
    const slide = slides[index];
    const visible = settings.details && ready && slide?.kind === "image";
    stage.detailsEl.classList.toggle("is-shown", visible && slide.first && (!isRunning() || !detailsExpired));
    stage.captionEl.classList.toggle("is-shown", visible && Boolean(slide.caption));
  }

  function armAdvance() {
    cancel(advanceTimer);
    advanceTimer = null;
    if (!isRunning() || !ready) return;
    advanceTimer = later(() => stepForward(true), settings.delay * 1000);
  }

  function syncRunState() {
    if (!stage) return;
    const running = isRunning();
    chrome.setPaused(!running);
    stage.playPauseEl.disabled = !settings.autoAdvance;
    stage.playPauseEl.innerHTML = renderIcon(running ? "pause" : "play");
    const label = running ? "Pause" : "Play";
    stage.playPauseEl.setAttribute("aria-label", label);
    stage.playPauseEl.title = label;
    if (running) armAdvance();
    else {
      cancel(advanceTimer);
      advanceTimer = null;
    }
    refreshOverlays();
    applyChrome();
  }

  function preloadNext() {
    const next = slides.slice(index + 1).find((slide) => slide.kind === "image");
    if (!next) return;
    preloaded = new Image();
    preloaded.src = next.src;
  }

  // ---- controls -----------------------------------------------------------

  function applyChrome() {
    if (!stage) return;
    cancel(chromeTimer);
    chromeTimer = null;
    // A pointer can already be over the bar when it opens under it, without a
    // mouseenter having fired. Editing the delay also counts as being in the bar.
    const editing = stage.barEl.contains(document.activeElement) && document.activeElement?.type === "number";
    if (editing || (mouseIsPointer && stage.barEl.matches(":hover"))) chrome.barEntered();

    const state = chrome.update();
    stage.revealEl.classList.toggle("is-visible", state.buttonVisible);
    stage.barEl.classList.toggle("is-open", state.barOpen);
    stage.el.classList.toggle("is-cursor-hidden", state.cursorHidden);

    const wait = chrome.nextChangeIn();
    if (wait !== null) chromeTimer = later(applyChrome, wait + 10);
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
    stage?.fullscreenEl.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
  }
}

function loadImage(imageEl, src) {
  imageEl.src = src;
  if (typeof imageEl.decode === "function") {
    return imageEl.decode().then(() => true, () => false);
  }
  return new Promise((resolve) => {
    if (imageEl.complete && imageEl.naturalWidth > 0) {
      resolve(true);
      return;
    }
    imageEl.onload = () => resolve(true);
    imageEl.onerror = () => resolve(false);
  });
}

function readSlideshowSettings() {
  try {
    return normalizeSlideshowSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY)));
  } catch {
    return normalizeSlideshowSettings(null);
  }
}

function writeSlideshowSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings just won't be remembered.
  }
}

function formatSpanText(span) {
  if (!span) return "";
  const start = formatDisplayDate(span.startDate);
  const end = formatDisplayDate(span.endDate);
  return start === end ? start : `${start} – ${end}`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// The timeline's title isn't repeated here: both hosts already show it in their header.
function renderSetupMarkup(summary, hasSlides) {
  const counts = [
    plural(summary.photoCount, "photo"),
    plural(summary.eventCount, "event"),
    summary.collectionCount > 0 ? plural(summary.collectionCount, "collection") : ""
  ].filter(Boolean).join(" · ");

  return `
    <section class="ss-setup" aria-label="Slideshow setup">
      ${hasSlides ? `
        ${summary.span ? `<p class="ss-setup-span">${escapeHtml(formatSpanText(summary.span))}</p>` : ""}
        <p class="ss-setup-counts">${escapeHtml(counts)}</p>
      ` : `<p class="ss-setup-counts">This timeline has no photos to show.</p>`}
      <div class="ss-settings">${renderSettingsMarkup(true)}</div>
      <button class="ss-play" type="button" data-action="play"${hasSlides ? "" : " disabled"}>
        ${renderIcon("play")} Play
      </button>
      <p class="ss-hint">Space play/pause · ← → step · F full screen · H details · Esc exit</p>
    </section>
  `;
}

function renderSettingsMarkup(includeFullscreen) {
  return `
    <label class="ss-check"><input type="checkbox" data-setting="details"> Show details</label>
    <label class="ss-check"><input type="checkbox" data-setting="autoAdvance"> Auto-advance</label>
    <label class="ss-check">Delay
      <input class="ss-delay" type="number" min="${MIN_DELAY_SECONDS}" max="${MAX_DELAY_SECONDS}" step="1" inputmode="numeric" data-setting="delay" aria-label="Delay in seconds"> s
    </label>
    <label class="ss-check"><input type="checkbox" data-setting="loop"> Loop</label>
    ${includeFullscreen ? `<label class="ss-check"><input type="checkbox" data-setting="fullscreen"> Start in full screen</label>` : ""}
  `;
}

function renderStageMarkup() {
  return `
    <div class="ss-slide is-hidden">
      <img class="ss-backdrop" alt="">
      <img class="ss-image" alt="">
      <div class="ss-collection"></div>
      <div class="ss-details">
        <div class="ss-details-title"></div>
        <div class="ss-details-meta"></div>
      </div>
      <div class="ss-caption"></div>
    </div>
    <div class="ss-announce" aria-live="polite"></div>
    <div class="ss-flash" aria-hidden="true"></div>
    <button class="ss-reveal" type="button" tabindex="-1" aria-label="Show controls" title="Show controls">${renderIcon("menu")}</button>
    <div class="ss-bar" role="toolbar" aria-label="Slideshow controls">
      <div class="ss-transport">
        <button class="ss-btn" type="button" tabindex="-1" data-action="start" aria-label="Back to start" title="Back to start">${renderIcon("start")}</button>
        <button class="ss-btn" type="button" tabindex="-1" data-action="back" aria-label="Back one" title="Back one">${renderIcon("back")}</button>
        <button class="ss-btn ss-btn-main" type="button" tabindex="-1" data-action="playpause" aria-label="Pause" title="Pause">${renderIcon("pause")}</button>
        <button class="ss-btn" type="button" tabindex="-1" data-action="forward" aria-label="Forward one" title="Forward one">${renderIcon("forward")}</button>
        <button class="ss-btn" type="button" tabindex="-1" data-action="end" aria-label="Forward to end" title="Forward to end">${renderIcon("end")}</button>
      </div>
      <span class="ss-count" aria-hidden="true"></span>
      <div class="ss-settings">${renderSettingsMarkup(false)}</div>
      <div class="ss-bar-end">
        <button class="ss-btn" type="button" tabindex="-1" data-action="fullscreen" aria-pressed="false" aria-label="Full screen (F)" title="Full screen (F)">${renderIcon("fullscreen")}</button>
        <button class="ss-btn" type="button" tabindex="-1" data-action="exit" aria-label="Exit slideshow (Esc)" title="Exit slideshow (Esc)">${renderIcon("exit")}</button>
      </div>
    </div>
  `;
}

const SLIDESHOW_ICONS = {
  start: { path: '<rect x="5" y="5" width="2.5" height="14"></rect><path d="M19 5v14L9 12z"></path>' },
  back: { path: '<path d="M17 5v14L7 12z"></path>' },
  play: { path: '<path d="M8 5v14l11-7z"></path>' },
  pause: { path: '<rect x="6" y="5" width="4" height="14"></rect><rect x="14" y="5" width="4" height="14"></rect>' },
  forward: { path: '<path d="M7 5v14l10-7z"></path>' },
  end: { path: '<path d="M5 5v14l10-7z"></path><rect x="16.5" y="5" width="2.5" height="14"></rect>' },
  menu: { stroke: true, path: '<path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path>' },
  fullscreen: { stroke: true, path: '<path d="M4 9V4h5"></path><path d="M20 9V4h-5"></path><path d="M4 15v5h5"></path><path d="M20 15v5h-5"></path>' },
  exit: { stroke: true, path: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>' }
};

function renderIcon(name) {
  const icon = SLIDESHOW_ICONS[name];
  return `<svg class="ss-icon${icon.stroke ? " is-stroke" : ""}" viewBox="0 0 24 24" aria-hidden="true">${icon.path}</svg>`;
}
