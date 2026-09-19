// The "Look up missing coordinates" dialog (docs/players/map.md, section 1.4):
// intro and consent, progress with Cancel, then a list of what matched so a
// wrong "Springfield" can be spotted. The lookup logic is in geocodeBatch.js.

import { showDialog } from "./fileLoad.js";
import { LOOKUP_CONSENT_TEXT, MIN_LOOKUP_INTERVAL_MS, NOMINATIM_ATTRIBUTION } from "./geocode.js";
import { eventsMissingCoordinates, lookUpMissingCoordinates } from "./geocodeBatch.js";

// `getEvents()` returns the timeline's current events. `applyMatches(matched)`
// stores the coordinates (`source: "search"`) and resolves when saved.
export function createLookupMissingDialog({ geocoder, permission, getEvents, applyMatches }) {
  let dialog = null;
  let els = null;
  let cancelled = false;
  let running = false;

  return { open };

  function open() {
    if (!dialog) build();
    const targets = eventsMissingCoordinates(getEvents());
    els.body.replaceChildren();
    els.consent.hidden = true;
    showDialog(dialog);

    // Closing the dialog cancels a run, but its last request may still be on its way.
    if (running) {
      showMessage("The previous lookup is still finishing. Try again in a moment.");
      setActions([["Close", closeDialog, "primary"]]);
      return;
    }
    cancelled = false;

    if (targets.length === 0) {
      showMessage("Every event that has a location already has coordinates.");
      setActions([["Close", closeDialog, "primary"]]);
      return;
    }
    const seconds = Math.ceil(targets.length * MIN_LOOKUP_INTERVAL_MS / 1000);
    showMessage(
      `${targets.length} event${targets.length === 1 ? " has" : "s have"} a location but no coordinates. `
      + `They are looked up one at a time, the top match for each (about ${formatDuration(seconds)}). `
      + "Events that already have coordinates are not touched."
    );
    setActions([["Start", start, "primary"], ["Cancel", closeDialog]]);
  }

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.setAttribute("aria-labelledby", "lookup-missing-title");
    dialog.innerHTML = `
      <div class="modal-panel">
        <header class="modal-header">
          <h2 id="lookup-missing-title">Look up missing coordinates</h2>
          <button class="icon-button" type="button" data-lm="close" aria-label="Close">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </header>
        <div class="lookup-consent" data-lm="consent" role="group" aria-label="Look up places online" hidden>
          <p data-lm="consent-text"></p>
          <div class="lookup-consent-actions">
            <button class="primary" type="button" data-lm="allow">Allow</button>
            <button type="button" data-lm="later">Not now</button>
          </div>
        </div>
        <div class="lookup-missing-body" data-lm="body" role="status" aria-live="polite"></div>
        <div class="save-actions" data-lm="actions"></div>
        <p class="lookup-attribution">${NOMINATIM_ATTRIBUTION}</p>
      </div>`;
    const pick = (name) => dialog.querySelector(`[data-lm="${name}"]`);
    els = { body: pick("body"), actions: pick("actions"), consent: pick("consent") };
    pick("consent-text").textContent = LOOKUP_CONSENT_TEXT;

    pick("close").addEventListener("click", closeDialog);
    pick("allow").addEventListener("click", () => {
      permission.allow();
      els.consent.hidden = true;
      run();
    });
    pick("later").addEventListener("click", () => {
      permission.defer();
      els.consent.hidden = true;
      showMessage("Lookup is off for now. Nothing was sent.");
      setActions([["Start", start, "primary"], ["Close", closeDialog]]);
    });
    // Esc and the close button while a run is going stop it and keep what it found.
    dialog.addEventListener("cancel", () => { cancelled = true; });
    dialog.addEventListener("close", () => { cancelled = true; });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && !running) closeDialog();
    });
    document.body.append(dialog);
  }

  function start() {
    if (!permission.isAllowed()) {
      els.consent.hidden = false;
      setActions([["Cancel", closeDialog]]);
      return;
    }
    run();
  }

  async function run() {
    if (running) return;
    running = true;
    cancelled = false;
    els.body.replaceChildren();
    const progress = document.createElement("progress");
    progress.max = 1;
    progress.value = 0;
    const line = document.createElement("p");
    els.body.append(line, progress);
    setActions([["Cancel", () => { cancelled = true; line.textContent = "Cancelling…"; }]]);

    let result;
    try {
      result = await lookUpMissingCoordinates({
        events: getEvents(),
        geocoder,
        isCancelled: () => cancelled,
        onProgress: ({ done, total, event }) => {
          progress.max = Math.max(total, 1);
          progress.value = done;
          line.textContent = event
            ? `Looking up ${done + 1} of ${total}: ${event.location}`
            : `Looked up ${done} of ${total}.`;
        }
      });
    } finally {
      running = false;
    }

    // Applied even when cancelled: what was found is kept.
    let saveError = null;
    if (result.matched.length > 0) {
      try {
        await applyMatches(result.matched);
      } catch (error) {
        saveError = error;
      }
    }
    showResult(result, saveError);
  }

  function showResult(result, saveError) {
    els.body.replaceChildren();
    const { matched, notFound, failed, notTried } = result;

    const summary = saveError
      ? `Could not save the coordinates: ${saveError.message}`
      : matched.length > 0
        ? `Set coordinates on ${matched.length} event${matched.length === 1 ? "" : "s"}. Check the matches below; edit an event to change one.`
        : "No coordinates were set.";
    const heading = document.createElement("p");
    heading.textContent = summary;
    if (saveError) heading.className = "geo-status error";
    els.body.append(heading);

    if (result.cancelled) addNote("Cancelled. The remaining events were not looked up.");
    if (result.gaveUp) addNote("Stopped after several failures in a row. The place lookup could not be reached; try again later.");

    addSection("Matched", matched, (item) => {
      const others = item.others > 0 ? ` (${item.others} other match${item.others === 1 ? "" : "es"})` : "";
      return `${item.title || "Untitled"}: “${item.location}” → ${item.label}${others}`;
    });
    addSection("No result", notFound, (item) => `${item.title || "Untitled"}: “${item.location}”`);
    addSection("Could not reach the lookup", failed, (item) => `${item.title || "Untitled"}: “${item.location}”`);
    addSection("Not looked up", notTried, (item) => `${item.title || "Untitled"}: “${item.location}”`);

    setActions([["Close", closeDialog, "primary"]]);
  }

  function addNote(text) {
    const note = document.createElement("p");
    note.className = "small";
    note.textContent = text;
    els.body.append(note);
  }

  function addSection(title, items, describe) {
    if (items.length === 0) return;
    const section = document.createElement("section");
    section.className = "lookup-missing-section";
    const heading = document.createElement("h3");
    heading.textContent = `${title} (${items.length})`;
    const list = document.createElement("ul");
    for (const item of items) {
      const entry = document.createElement("li");
      entry.textContent = describe(item);
      list.append(entry);
    }
    section.append(heading, list);
    els.body.append(section);
  }

  function showMessage(text) {
    els.body.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    els.body.append(paragraph);
  }

  function setActions(actions) {
    els.actions.replaceChildren();
    for (const [label, handler, kind] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (kind) button.className = kind;
      button.addEventListener("click", handler);
      els.actions.append(button);
    }
  }

  function closeDialog() {
    cancelled = true;
    if (dialog.open) dialog.close();
  }
}

function formatDuration(seconds) {
  if (seconds < 90) return `${seconds} seconds`;
  return `${Math.round(seconds / 60)} minutes`;
}
