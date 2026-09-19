# Timeline POC — Product & Functionality Critique

Assessment date: 2026-09-19. Baseline commit: `a068828` (still HEAD).

Scope: features, functionality, and product direction — *does this serve a useful purpose, and what
should be added, removed, or changed?*

Relationship to [todo.md](todo.md): that document is a code-and-risk evaluation dated 2026-08-05
against the same commit, and it remains unactioned. Its claims were spot-checked against the current
source during this pass and all of the ones verified here hold. This document is the product-level
view and adds several gaps `todo.md` did not cover — most importantly, the absence of time ranges.

---

## What actually exists

**Editor** ([src/editor.js](src/editor.js), 1,398 lines) is the real product, and it is genuinely
featureful: event CRUD, custom event types with emoji, collections as tags, date/time/timezone,
location, image galleries (embedded + linked), preset and custom fields, IndexedDB autosave, export
scoped by all / type / collection, and import with a diagnostics log.

**Schema** ([src/timeline.js](src/timeline.js), 1,126 lines) is 8 versions with 7 migrations,
unknown-field preservation, and detailed diagnostics.

**Viewer** ([src/playerRenderers.js](src/playerRenderers.js), 137 lines) is one vertical list. The
`timeline`, `slideshow`, and `map` entries all point at `renderPlaceholderPlayer`
([playerRenderers.js:10-14](src/playerRenderers.js#L10-L14)) and are offered as selectable export
options ([editor.html:301-304](editor.html#L301-L304)) and as nav links on all three pages. You can
export and share a `.timeline.html` whose entire content is the word "placeholder."

---

## Does it serve a useful purpose?

Yes — one, specifically. Not "a scrapbook app"; that category is crowded. The defensible idea is
**the artifact**: a single HTML file with no dependencies, no account, and no server, that opens in
any browser and still will in fifteen years. Every competitor in this space is SaaS with a
data-hostage problem. "Here's a file, it's yours" is a real position, and this codebase is unusually
well suited to it — zero dependencies, careful escaping, clean module boundaries.

Two things currently undercut it:

1. **The artifact isn't worth sharing yet.** 4% of the code is the thing a recipient actually sees.
2. **It's lossy.** [encodeImageFile](src/editor.js#L1259-L1283) hard-caps images at 960px / JPEG
   q0.72 and never retains the original. A scrapbook built here is permanently worse than the user's
   photo library. That is a preview format, not an archive — which contradicts "portable forever"
   ([index.html:32](index.html#L32)).

---

## Gaps beyond what todo.md found

### No time ranges — the largest gap

Events carry a single `timestamp`. There is no end date, duration, or era anywhere in the schema.
"Lived in Vancouver 2015–2020," "worked at X for three years," or "the Japan trip" as a spanning bar
are all unrepresentable. Eight schema versions were spent without adding the one field the product's
name implies, and the timeline player worth building next is exactly the view that needs it.

**Add this before freezing the schema** — otherwise the freeze at 8 is immediately followed by a 9.

### No search or filter at view time

Filtering exists only at *export* time. At 200 events, both the editor list and the player are
unbroken walls. A date-range scrubber plus type/collection toggles in the player is cheap and makes
the artifact feel like a product rather than a dump.

### One draft, globally

`ACTIVE_ID = "active"` ([db.js:7](src/db.js#L7)) means "Japan 2026" and "Career" cannot coexist, and
opening a file to look at it destroys current work. Collections partially paper over this, but they
are tags inside a single document, not separate documents.

### No print path

No `@media print` rules anywhere. For a scrapbook, "print it / save as PDF" is a natural second
output, and CSS gets most of the way there.

### Capture is desktop-shaped

The event form is a long desktop dialog, but the raw material for a scrapbook lives on a phone. Worth
deciding now whether that flow matters, because it affects the editor's shape.

---

## What to remove

- The three placeholder players from the UI — the export dialog and the nav dropdowns in
  [index.html](index.html), [editor.html](editor.html), and [player.html](player.html). ZIP and
  HTML+images are correctly `disabled` in the same dialog; apply the same standard.
- The ZIP / HTML+images radio options entirely, rather than showing disabled scope that doesn't exist.
- `migrateV2ToV3` and `migrateV3ToV4` — verified: they bump a number and log, changing no data.
- The 305-line duplicate runtime inside a template literal
  ([htmlExport.js:266-570](src/htmlExport.js#L266-L570)). Twelve functions plus the full
  `EVENT_TYPES` table exist in two dialects. Every new player would have to be written twice — a tax
  landing squarely on the work that matters most next. Worse, `node --check` does not parse
  template-string contents, so [scripts/check_js.py](scripts/check_js.py) — the one gate
  `AGENTS.md` requires — passes on a build that emits syntactically broken exports.

---

## What to change, in order

1. **Confirmations on the three unconfirmed destruction paths** (clear draft, delete event,
   import-clobbers-draft). There is no `confirm()` anywhere in `src/`.
   [editor.html:85](editor.html#L85) tells users their work is temporary — a caveat sitting where a
   safeguard belongs.
2. **Extract the export runtime to a real `.js` file**, inline it at export time, add it to
   `JS_FILES`, and add one round-trip test (export → import → assert the timeline survives). Nothing
   currently asserts the product's core promise.
3. **Add time ranges to the schema**, then freeze at 9.
4. **Build the timeline player for real**, with range bars and a date scrubber. This is the
   hypothesis the project exists to test, and the cheapest remaining way to learn whether anyone
   would build one of these.
5. **Store media as Blobs, retain originals, downscale only on export.** Base64 inflates bytes ~33%,
   every media row is rewritten on every `persist()` ([db.js:56-61](src/db.js#L56-L61)), and JSON
   export pretty-prints the data URLs ([timeline.js:172](src/timeline.js#L172)). A 100-photo
   scrapbook hits a wall.

### Bug worth noting

`normalizeEventTypes` unconditionally re-injects all nine built-ins
([timeline.js:671-677](src/timeline.js#L671-L677)), and `downloadTimeline` calls `normalizeTimeline` —
so the `eventTypes` filtering in `getExportTimeline` ([editor.js:637](src/editor.js#L637)) is undone
on the way out. The event filter works; the type-list filter does not. The same root cause prevents
users from hiding a built-in event type they never use.

---

## Net assessment

The craft here is high and the premise is sound. The problem is allocation: a compatibility apparatus
sized for a shipped product with an installed base (single user, one local draft, 22 commits, zero
files in the wild) was built against the least uncertain part of the product, while the most
uncertain part — *does looking at one of these timelines feel good enough that anyone would build
one?* — received 137 lines.

Shift the next stretch of work entirely to the viewing experience and to the safety of the data
already sitting in the browser.
