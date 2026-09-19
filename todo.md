# Timeline — TODO

Backlog and history of the work so far. Checked items are done; unchecked items are open or
deliberately deferred. `python scripts/check_js.py` passes.

## P1 — Data safety

Three one-click destruction paths, none confirmed, no undo, no auto-backup. This is the sharpest
contradiction with the "your memories, kept safely on your machine" pitch. The editor currently tells
users their work is temporary ([editor.html:85](editor.html#L85)) — that's a caveat where a safeguard belongs.
**Verified:** there is no `confirm()` anywhere in `src/`.

- [x] Confirm before **Clear draft** ([src/editor.js:467-474](src/editor.js#L467-L474)) — wipes the entire IndexedDB draft, document and all media, from a toolbar icon sitting next to Save and Load.
- [x] Confirm before **Delete event** ([src/editor.js:739-757](src/editor.js#L739-L757)) — also purges associated media.
- [x] Stop **import** from clobbering the active draft ([src/editor.js:134-141](src/editor.js#L134-L141)). There is exactly one slot (`ACTIVE_ID = "active"`, [src/db.js:7](src/db.js#L7)), so opening a file to look at it destroys current work. Needs either a confirm, or multi-draft storage (see P6).
- [ ] Consider an auto-backup slot (last-known-good draft) as a cheap safety net under all three. Deferred: needs a restore UI as well as the storage change, and matters less now that the confirmations exist.

## P2 — The standalone export runtime is unverified and duplicated

[src/htmlExport.js:266-570](src/htmlExport.js#L266-L570) is a 305-line JavaScript program living inside a template literal.

**Verified:** `node --check` does not parse template-string contents. A file with deliberately broken JS
inside a backtick string exits 0. So `scripts/check_js.py` — the one gate `AGENTS.md` requires before
finishing JS changes — reports OK on a build that emits syntactically invalid HTML exports. The exported
file is the product's whole shareability story and it's the only code path with no verification at all.

**Verified duplication:** twelve functions plus the full `EVENT_TYPES` table exist in two copies —
`sortEvents`, `normalizeEventTypes`, `getEventTypeDisplay`, `normalizeCollections`, `getEventCollections`,
`formatEventMeta`, `titleFromSlug`, `timestampSortValue`, `formatDisplayTimestamp`, `canRenderImageMedia`,
`resolveEventImages`, `isSafeHttpUrl`. Two dialects, too: `src/` is modern ESM, the runtime string is
hand-degraded. Every future player must be written twice — a tax landing directly on the work that
matters most next (P4).

- [x] Extract the runtime into a real `.js` file, inlined into the export at export time rather than maintained as a parallel copy. [src/exportRuntime.js](src/exportRuntime.js) is the entry point; [src/exportBundle.js](src/exportBundle.js) inlines it and its imports (`playerRenderers.js`, `players.js`, `timeline.js`) into the page, so the export runs the same code as `player.html`. The 305-line string and its twelve duplicate functions are gone. Cost: every export now carries all of `timeline.js` (about 48 KB of script) since there is no tree-shaking.
- [x] Add it to `JS_FILES` in [scripts/check_js.py](scripts/check_js.py) so syntax is actually checked.
- [x] Add a round-trip test: export → import → assert the timeline survives. [scripts/check_export.mjs](scripts/check_export.mjs) runs from `check_js.py`: it builds an export, parses the inlined script, runs it against a stub DOM, and asserts the embedded JSON normalizes back to the original timeline.

## P3 — Add time ranges, then freeze the schema

**The largest functional gap, and it sits in the schema.** Events carry a single `timestamp`. There is
no end date, duration, or era anywhere in `src/timeline.js`. "Lived in Vancouver 2015–2020," "worked at
X for three years," and "the Japan trip as a spanning bar" are all unrepresentable. Eight schema
versions were spent without adding the one field the product's name implies — and the timeline player
worth building next (P4) is exactly the view that needs it.

Do this *before* freezing, or the freeze at 8 is immediately followed by a 9.

- [x] Add an optional end timestamp / range to the event shape. Migrate to v9. Done as `events[].endTimestamp` (same shape as `timestamp`, omitted for point events) with an End date / End time in the event form. The simple player, editor list and standalone export show ranges as "start – end". Range bars await the `timeline` player (P4).
- [x] Collapse the no-op migrations. `migrateV2ToV3` is gone and `migrateV3ToV4` is now `noteIgnoredLegacyEventImages`, which keeps only the "ignored legacy image fields" diagnostic. Files older than v4 no longer get "migrated-v2/v3-schema" warnings.
- [ ] Policy, not code: don't bump the schema version again until there's an external consumer. Additive optional fields can ship under v9. (Broken on purpose once: v10 adds `events[].geo` for the map player, see P4a. It was agreed in the map spec, and v9 files load with no migration warning.)
- [ ] Keep the 64-code diagnostic system — it's genuinely good work. It's just insurance on the one thing that wasn't at risk.

## P4 — Build one real player, and make it navigable

The product page advertises four; three are stubs ([src/playerRenderers.js:10-14](src/playerRenderers.js#L10-L14)). They are offered
as real, selectable export options ([editor.html:301-304](editor.html#L301-L304)), so you can produce and share a
`.timeline.html` whose entire content is the word "placeholder." ZIP and HTML+images are correctly
`disabled` in the same dialog — the project knows how to gate unfinished work and didn't apply it here.

- [x] Disable or remove the placeholder players in the export dialog, matching how ZIP / HTML+images are handled. Done via an `available` flag in [src/players.js](src/players.js); unfinished players show as disabled "coming soon" options, and `normalizePlayerType` falls back to Simple for them. Flip the flag when a real player lands.
- [x] Remove the placeholder entries from the nav dropdowns in [index.html](index.html) and [editor.html](editor.html). (`player.html` never had a dropdown.) With one working player, the dropdowns became plain **Player** links. Restore a dropdown when a second player ships.
- [x] Build the `timeline` player for real — range bars (needs P3) and a date scrubber. This is the hypothesis the whole project exists to test. [src/timelinePlayer.js](src/timelinePlayer.js) draws events in the chosen date window (ranges as bars, single moments as dots, packed into lanes) over a two-handle scrubber for the whole span; clicking a mark scrolls to its card. Layout maths (scale, ticks, lanes) is DOM-free in [src/timelineLayout.js](src/timelineLayout.js) and unit-tested by `scripts/check_timeline_layout.mjs`; styles live in [src/timelinePlayer.css](src/timelinePlayer.css), shared by `player.html` and the export. Still unproven: whether it *feels* good with real data — try it on a real timeline before building more. Not covered by automated tests: the DOM behaviour (checked by hand in Edge).
- [x] **Add view-time search/filter.** Text search plus type and collection toggles and the date window, all in the `timeline` player. The Simple player still has none.
- [x] Restore the nav dropdown now that a second player ships (see the second P4 bullet). Done as a split button on all three pages: the main part opens the Simple player, the caret lists the available players ([src/nav.js](src/nav.js)). On `player.html` it switches in place, so a loaded timeline isn't lost.
- [x] The `timeline` player scrolled you away from the chart on every click. The chart, scrubber and status line are now pinned (`position: sticky`) while the cards scroll beneath, and clicked cards stop below the pinned block. Controls (search, chips) are not pinned.
- [ ] Future consideration: **detail panel instead of a card list.** Feedback was that the `timeline` player is just the Simple player with a chart on top. Clicking a mark would select it and show only that event's card in a detail panel beside or below the chart, so nothing scrolls; the full list could collapse into an "all events" section or go. This is what would make it a distinct way of viewing a timeline, not a chart bolted onto the list. Do it if the pinned chart still feels like the Simple player.
- [ ] Future consideration: **link the chart and the list both ways.** Highlight the chart marks for the cards currently in view (an `IntersectionObserver`), so scrolling the list shows where you are in time, and add previous/next arrows for stepping through events. Builds on the pinned chart.
- [x] Build the **slideshow** player from [docs/players/slideshow.md](docs/players/slideshow.md). One event's photos play in date order over a blurred backdrop, with collection title cards, details and captions, fades, auto-advance, loop, full screen and a hover/tap playback bar. Pure logic is in `src/slideshowModel.js` and `src/slideshowChrome.js` and is unit-tested by `scripts/check_slideshow.mjs`. The renderer teardown hook it needed (`destroy()`, called by `player.js`) also fixed the `timeline-chart-mode` class the timeline player left behind after a player switch. Checked by hand in headless Edge, including a real 5-photo export; not checked: broken linked images, Loop, manual mode and small phones.
- [x] The vertical line and dots ran through the date text in both players. They now sit in a gutter between the right-aligned date and the card ([styles.css](styles.css), and `standaloneCss()` in [src/htmlExport.js](src/htmlExport.js)). Displayed dates also drop the time zone, and drop the time when it is 00:00.

## P4a — Map player, built in chunks

Spec: [docs/players/map.md](docs/players/map.md). Read it and [docs/player-contract.md](docs/player-contract.md) first. The spec is the source of truth for behaviour; this section says what is done and what to do next. The work is split into three chunks (plus the tour) so each one ends at something that can be tried. Update the checkboxes here and the **Status** line at the top of the spec as chunks land.

- [x] **Chunk 1 — data and editor (spec section 1). Done, commit `2fc5ec6`.**
  - Schema v10: optional `events[].geo` = `{ lat, lng, source }` (`source` is `search`, `map` or `manual`; missing or unknown counts as `manual`). Bad values are dropped with an `invalid-geo-dropped` warning. v9 to v10 has no migration function and no diagnostic. Code in [src/coords.js](src/coords.js) and [src/timeline.js](src/timeline.js); fixture [v10-geo.timeline.json](tests/fixtures/schema/v10-geo.timeline.json).
  - [src/geocode.js](src/geocode.js): `createGeocoder` (one queue, 1.1 s spacing, cache in `localStorage`, Nominatim then Photon on failure, 10 s timeout), `createLookupGuard` (stale answers), `createLookupPermission` (consent). Everything with a side effect is injected, so it is unit-tested.
  - [src/coordinatesField.js](src/coordinatesField.js): the Coordinates row in the editor's Location section (Look up, typed coordinates, consent notice, "N other matches", on/off toggle). Its `setGeo(geo)` is the hook the pin dialog should use. `editor.js` calls `commit()` before saving and `settled()` to wait for a lookup in flight.
  - Tests: `scripts/check_coords.mjs`, `scripts/check_geocode.mjs`, and the geo cases in `scripts/check_schema.mjs`, all run by `python scripts/check_js.py`.
  - Checked by hand in headless Edge with a **stubbed fetch** (consent, lookup, other matches, manual coordinates protected, failure, no match, save waiting for a lookup, clearing). **Not checked:** a real request to Nominatim or Photon from the editor; the "Not now" path; phone widths. There is no automated DOM test for the row.
  - Nothing reads `geo` yet. The `map` player is still `available: false`.
- [x] **Chunk 2 — the map player without the tour (spec sections 2 to 9, 10, 14). Built; still needs a hand check on a real device.**
  - Code: DOM-free [src/mapModel.js](src/mapModel.js) (tested by `scripts/check_map.mjs`), [src/mapTiles.js](src/mapTiles.js), [src/mapPlayer.js](src/mapPlayer.js) and [src/mapPlayer.css](src/mapPlayer.css). Leaflet 1.9.4 is vendored, unmodified, in `vendor/leaflet/` and loaded by a `<script>` tag in `player.html`. `htmlExport.js` inlines it (and its CSS with every `url()` dropped) only when the player is Map; `check_export.mjs` asserts that, the `</script` escaping, and that other players' exports are unchanged. `map` is `available: true`; the contract, README and spec status are updated.
  - Checked in headless Edge from an exported file: launcher, stage, tiles, stepping, scopes, lines, numbers, arrows, shared dot with badge, pinned split view, lightbox opening, no console errors. The lightbox image in that run was a broken fixture image, so a real photo has not been seen.
  - **Not checked:** a real `.timeline.html` opened from disk (the Referer question, spec section 4); tiles offline (the "Map tiles unavailable" note); resizing with panels pinned; a real phone (only a narrow window); Esc order with a real lightbox and full screen; the Esri, VersaTiles, NASA Blue Marble and OpenTopoMap sources. Carto Voyager was removed: it now needs an API key and served "API key required" tiles.
  - **Left out:** `renderPlaceholderPlayer` in `playerRenderers.js` is now unused. (The save dialog now names the tile hosts when Map is chosen; spec section 10, item 2.)
- [x] **Chunk 3 — pin on map and "Look up missing coordinates" (spec 1.3 and 1.4).** Reuses chunk 2's Leaflet setup and tile list, so it comes after. The pin dialog sets coordinates through `coordinatesField.setGeo({ ..., source: "map" })`. Restore the "or pick on the map" wording in the "couldn't find" message in `coordinatesField.js` when the button exists. The batch action needs the same consent as the editor lookup and goes through the same geocoder queue.
  - Built: `mapPicker.js`, `lookupMissingDialog.js`, `geocodeBatch.js` (Node test in `check_geocode.mjs`). Checked in headless Edge with a stubbed geocoder: consent before any request, batch run and result list, pin by click, search result to pin, Esc closing only the dialog, Use, Clear, and a label edit not replacing a pinned point.
  - **Not checked:** dragging the pin; a real phone; the pin dialog with tiles offline; the real Nominatim and Photon answers through the batch (only stubs); a batch over many events (the 1.1 s spacing was only tested with a fake clock).
- [ ] **Future consideration — auto-play tour (spec section 11).** Deferred (decided 2026-09-19): the map player is complete without it, and nothing here is planned. Revisit only if there is demand. The spec flags a risk: Leaflet's `flyTo` can drift from a separately moved marker. Prototype driving both from one animation-frame loop before promising a smooth result.

## P5 — "Portable forever" vs. lossy-on-ingest images

[encodeImageFile](src/editor.js#L1259-L1283) hard-caps every image at 960px and re-encodes at JPEG q0.72. The original
is never retained anywhere. The UI does disclose this ("resized... with metadata removed") and for now
the tradeoff is defensible — but a scrapbook built here is permanently lossy relative to the user's photo
library. That's a preview, not an archive. Either the archival claim or the encoding needs to move.

- [x] Decided: keep the 960px / JPEG q0.72 cap. Uploads are previews; users who want full quality should link the image, not embed it. The editor hint and README now say so, and the save dialog already warns about linked images (P7). The "portable forever" claim is about the file, not the photo originals.
- [ ] Optional: revisit the cap for the slideshow. 960px is a 2× upscale on a 1080p screen, which was accepted for now. If it looks too soft: 1600px long edge at q0.8, roughly 250–350 KB per photo (unmeasured), so about 35–45 MB for 100 photos. Measure with real photos before changing it. See section 8 of [docs/players/slideshow.md](docs/players/slideshow.md).
- [x] IndexedDB now stores media as `Blob`s ([src/mediaBlob.js](src/mediaBlob.js), [src/db.js](src/db.js)), and `saveActiveTimeline` only writes rows that are new or changed instead of every row per save. DB version 3 converts old rows in place on upgrade. The timeline JSON, players and export still use `dataUrl`, so no schema change. Round-trip covered by `scripts/check_media_blob.mjs`; the IndexedDB code itself has no automated test and is unchecked in a browser.
- [ ] Not done: the in-memory model still holds base64 strings, so a 100-photo draft costs memory on load (Blob to data URL for every image), and `downloadTimeline` still pretty-prints them with `JSON.stringify(..., null, 2)` ([src/timeline.js:172](src/timeline.js#L172)). Moving players to object URLs would fix the first but touches every player and the export. Do it only if a big draft actually feels slow.

## P6 — Product-shape decisions

Not bugs — unmade decisions that constrain what the app can become. Worth settling before more code
lands on top of the current assumptions.

- [ ] **One draft, globally.** `ACTIVE_ID = "active"` ([src/db.js:7](src/db.js#L7)) means "Japan 2026" and "Career" cannot coexist. Collections partially paper over this, but they are tags inside a single document, not separate documents. Multi-draft storage also resolves the import-clobber path in P1.
- [ ] **No print path.** No `@media print` rules anywhere in `styles.css` or the export runtime. For a scrapbook, "print it / save as PDF" is a natural second output and CSS gets most of the way there.
- [ ] **Capture is desktop-shaped.** The event form is a long desktop dialog, but the raw material for a scrapbook lives on a phone. Decide now whether that flow matters — it affects the editor's shape.

## P7 — Exports can leak to third parties

Linked images (`kind: "link"`) are preserved verbatim into the exported HTML. Opening that file fetches
from the remote host, carrying a request the recipient didn't ask for. A "local-first, no cloud" artifact
that phones out on open deserves a deliberate decision.

- [x] Warn visibly in the save dialog. For HTML exports, a note under the options counts the linked images the chosen scope would include and names their hosts. Not done: inlining them at export. That would mean fetching cross-origin images in the browser, which most hosts block without CORS, so it needs a proxy-free plan first.

## P8 — README drift

In a repo where the schema is the main deliverable, the schema doc is three versions stale.

- [x] [README.md:52](README.md#L52) says *"Current exports use schema version 5."* Code is at 8 ([src/timeline.js:2](src/timeline.js#L2)); the JSON sample 18 lines below already says `"version": 8`.
- [x] Schema Compatibility section documents v1–v5 and stops. Undocumented: v6 (collections), v7 (`education`→`school`, `move`→`home`), v8 (`job`→`work`).
- [x] JSON Shape sample omits `collections[]` and `events[].collectionIds[]` — a top-level field since v6.

## P9 — Smaller items

- [x] `normalizeEventTypes` always re-injected all 9 built-ins, so the event-type filtering in `getExportTimeline` was silently undone by `normalizeTimeline`. Fixed with an optional top-level `hiddenEventTypes[]` (built-in slugs left out of the list; additive under v9). The export filters set it, and files without it behave as before. A type events still use is never hidden.
- [x] Users can't hide a built-in event type they never use. The event editor's "Custom event type" section now has **Hide selected type** (unused built-ins other than Misc) and **Show hidden types**.
- [x] Remove the `zip` and `html-images` radio options ([editor.html:274](editor.html#L274), [editor.html:290](editor.html#L290)) rather than showing disabled scope that doesn't exist.
- [x] Event editor isn't a real dialog — a `div` with `role="dialog" aria-modal="true"` ([editor.html:95](editor.html#L95)). Escape and backdrop-click are handled, but no focus trap, so Tab walks into the page behind. `<dialog>` is used correctly for save/load; this one is the outlier. Fixed by making the page behind it `inert` while it's open ([src/editor.js](src/editor.js) `setPageBehindEditorInert`) rather than converting it to `<dialog>`, which would mean re-doing the slide-in panel styling.
- [x] ~~`getExportTimelineTitleValue` dead fallback~~ — **not dead, left as is.** `required` only rejects an empty value; a whitespace-only name passes it, and `.trim()` then yields `""`, so the fallback is what stops a blank title in the saved file.

## P10 — Later: are ZIP and HTML + images worth building?

The ZIP and HTML + images save options were removed in P9 because they weren't implemented. They may
still be worth building, but that's a question to answer late, after P2–P5, not a commitment. Nothing
here should start before the artifact and player questions above are settled.

- [ ] Decide whether either format earns its place. The single-file HTML artifact is the product's core promise ("one file, openable in any browser in fifteen years"). Formats with separate image files trade that away: a ZIP or a sidecar folder can be split, lost or renamed, which is exactly what the single file avoids. The case for them is size — a 100-photo scrapbook as base64 in one file gets large (see P5).
- [ ] If yes, do P5's `Blob` storage first, since both formats need originals or downscaled images kept as separate binary data rather than base64 in the JSON.
- [ ] If ZIP export ships, add **ZIP import** too: [src/fileLoad.js:61](src/fileLoad.js#L61) still throws "ZIP loading is not implemented yet" for `.zip` files. Export without import would break the round trip.
- [ ] If neither ships, delete the `zip` handling in `fileLoad.js` so the code doesn't imply a plan that doesn't exist.
