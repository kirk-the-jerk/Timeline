# Timeline POC — Evaluation and TODO

Assessment date: 2026-08-05. Revised 2026-09-19 after a product/functionality pass
(see [CRITIQUE.md](CRITIQUE.md)). Baseline commit: `a068828`. Done since: P1 confirmations
(clear draft, delete event, import), the first two P4 bullets (placeholder players hidden), all of P8,
P3 (time ranges, schema v9, no-op migrations collapsed), and most of P9. Everything else is still open.
`python scripts/check_js.py` passes.

## Framing: objectives vs. outcomes

**Stated objective** (consistent across `README.md`, `AGENTS.md`, `index.html`): a local-first,
dependency-free, private scrapbook/timeline. Drafts in IndexedDB, exports as portable artifacts.
`index.html` sets the bar highest — *"Private timelines, portable forever."*

**What got built:**

| Concern | Lines | Share |
|---|---|---|
| Schema normalization/migration (`src/timeline.js`) | 1,126 | 34% |
| Editor UI (`src/editor.js`) | 1,398 | 42% |
| Export plumbing (`src/htmlExport.js`) | 579 | 17% |
| **The viewing experience** (`src/playerRenderers.js`) | **137** | **4%** |

8 schema versions, 7 migration functions, 64 diagnostic codes, unknown-field preservation, and a
fixture suite — against one working player (a vertical event list) and three that render the literal
string `"Timeline player placeholder"`.

**Core critique — effort is inverted relative to risk.** The data format was the least uncertain part
of this product and received a compatibility apparatus sized for a shipped product with an installed
base (single user, single local draft, 22 commits, zero files in the wild). Two of the eight versions
(`migrateV2ToV3`, `migrateV3ToV4`) change no data at all — they bump a number and log a warning. The
most uncertain part — *does looking at one of these timelines feel good enough that anyone would build
one?* — is 137 lines. "Portable forever" is currently underwritten by a format that migrates flawlessly
into a view that doesn't exist yet.

The engineering quality is high: consistent escaping, careful normalization, real diagnostics, no
dependencies, clean module boundaries. The problem isn't craft, it's where the craft was spent.

**The purpose is sound, and narrower than "a scrapbook app."** The defensible idea is the *artifact*:
one dependency-free HTML file, no account, no server, openable in any browser in fifteen years.
Competitors in this space are SaaS with a data-hostage problem. Everything below is ordered by how
directly it serves that artifact.

---

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

- [ ] Extract the runtime into a real `.js` file, inlined into the export at build/export time rather than maintained as a parallel copy.
- [ ] Add it to `JS_FILES` in [scripts/check_js.py](scripts/check_js.py) so syntax is actually checked.
- [ ] Add a round-trip test: export → import → assert the timeline survives. Nothing currently asserts the product's core promise.

## P3 — Add time ranges, then freeze the schema

**The largest functional gap, and it sits in the schema.** Events carry a single `timestamp`. There is
no end date, duration, or era anywhere in `src/timeline.js`. "Lived in Vancouver 2015–2020," "worked at
X for three years," and "the Japan trip as a spanning bar" are all unrepresentable. Eight schema
versions were spent without adding the one field the product's name implies — and the timeline player
worth building next (P4) is exactly the view that needs it.

Do this *before* freezing, or the freeze at 8 is immediately followed by a 9.

- [x] Add an optional end timestamp / range to the event shape. Migrate to v9. Done as `events[].endTimestamp` (same shape as `timestamp`, omitted for point events) with an End date / End time in the event form. The simple player, editor list and standalone export show ranges as "start – end". Range bars await the `timeline` player (P4).
- [x] Collapse the no-op migrations. `migrateV2ToV3` is gone and `migrateV3ToV4` is now `noteIgnoredLegacyEventImages`, which keeps only the "ignored legacy image fields" diagnostic. Files older than v4 no longer get "migrated-v2/v3-schema" warnings.
- [ ] Policy, not code: don't bump the schema version again until there's an external consumer. Additive optional fields can ship under v9.
- [ ] Keep the 64-code diagnostic system — it's genuinely good work. It's just insurance on the one thing that wasn't at risk.

## P4 — Build one real player, and make it navigable

The product page advertises four; three are stubs ([src/playerRenderers.js:10-14](src/playerRenderers.js#L10-L14)). They are offered
as real, selectable export options ([editor.html:301-304](editor.html#L301-L304)), so you can produce and share a
`.timeline.html` whose entire content is the word "placeholder." ZIP and HTML+images are correctly
`disabled` in the same dialog — the project knows how to gate unfinished work and didn't apply it here.

- [x] Disable or remove the placeholder players in the export dialog, matching how ZIP / HTML+images are handled. Done via an `available` flag in [src/players.js](src/players.js); unfinished players show as disabled "coming soon" options, and `normalizePlayerType` falls back to Simple for them. Flip the flag when a real player lands.
- [x] Remove the placeholder entries from the nav dropdowns in [index.html](index.html) and [editor.html](editor.html). (`player.html` never had a dropdown.) With one working player, the dropdowns became plain **Player** links. Restore a dropdown when a second player ships.
- [ ] Build the `timeline` player for real — range bars (needs P3) and a date scrubber. This is the hypothesis the whole project exists to test.
- [ ] **Add view-time search/filter.** Filtering exists only at *export* time. At 200 events both the editor list and the player are unbroken walls. A date-range scrubber plus type/collection toggles is cheap, and it is what makes the artifact feel like a product rather than a dump.

## P5 — "Portable forever" vs. lossy-on-ingest images

[encodeImageFile](src/editor.js#L1259-L1283) hard-caps every image at 960px and re-encodes at JPEG q0.72. The original
is never retained anywhere. The UI does disclose this ("resized... with metadata removed") and for a POC
the tradeoff is defensible — but a scrapbook built here is permanently lossy relative to the user's photo
library. That's a preview, not an archive. Either the archival claim or the encoding needs to move.

- [ ] Decide: soften the "portable forever" claim, or retain originals.
- [ ] Storage design: store media as `Blob`s rather than base64 data URLs, and downscale only on export. Base64 inflates bytes ~33%, every media row is re-written to IndexedDB in full on every save ([src/db.js:56-61](src/db.js#L56-L61) puts every media row per `persist()` call), and `downloadTimeline` pretty-prints them with `JSON.stringify(..., null, 2)` ([src/timeline.js:172](src/timeline.js#L172)). IndexedDB stores `Blob`s natively. A 100-photo scrapbook will hit a wall here.

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

- [ ] Either inline linked images on export, or warn visibly in the save dialog.

## P8 — README drift

In a repo where the schema is the main deliverable, the schema doc is three versions stale.

- [x] [README.md:52](README.md#L52) says *"Current exports use schema version 5."* Code is at 8 ([src/timeline.js:2](src/timeline.js#L2)); the JSON sample 18 lines below already says `"version": 8`.
- [x] Schema Compatibility section documents v1–v5 and stops. Undocumented: v6 (collections), v7 (`education`→`school`, `move`→`home`), v8 (`job`→`work`).
- [x] JSON Shape sample omits `collections[]` and `events[].collectionIds[]` — a top-level field since v6.

## P9 — Smaller items

- [ ] `normalizeEventTypes` always re-injects all 9 built-ins ([src/timeline.js:671-677](src/timeline.js#L671-L677)), so the event-type filtering in `getExportTimeline` ([src/editor.js:637](src/editor.js#L637)) is silently undone by the `normalizeTimeline` call inside `downloadTimeline`. The filter works for events, not the type list.
- [ ] Users can't hide a built-in event type they never use (same root cause).
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
