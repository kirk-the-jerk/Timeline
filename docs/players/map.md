# Map player

**Status: draft, not implemented.** Nothing here is built. The `map` entry in
[../../src/players.js](../../src/players.js) is still `available: false`.
Rules shared by all players are in [../player-contract.md](../player-contract.md). Two of them change for this
player (section 10).

**Purpose:** show the timeline's events on a map, and let a viewer pick a collection, look at one event and its
photos, step from event to event, and (later) watch the map play through them on its own. It plays events that
have a location. Everything else is ignored.

Items marked **(default)** are my choices where the brief was silent. They are easy to change. Section 12 lists
the questions that were settled in review.

## 1. Prerequisite: events need coordinates

Today an event has only a free-text `location` ("Huntsville TX"). Turning that into a point needs a geocoding
service, which the player must not call. So the schema gains an optional field (schema v10):

```json
"geo": { "lat": 30.7235, "lng": -95.5508, "source": "search" }
```

- Both are finite numbers, `lat` in -90..90 and `lng` in -180..180, kept to 5 decimal places (about a metre).
  Anything else is dropped on load with a diagnostic, as other bad fields are, and the event is treated as
  having no location.
- `source` is optional: `"search"` (from a lookup), `"map"` (pinned by hand) or `"manual"` (typed). It says whether
  the editor may replace the coordinates when the location text changes (1.1). Missing or unknown counts as
  `"manual"`, the safe choice.
- `location` stays as the label. `geo` is where the dot goes. An event with `geo` and no `location` is fine.
- Migration v9 to v10 adds nothing to existing events.
- The README's JSON shape and `timeline.js` normalization, and a schema fixture, are updated with the field.

### 1.1 Assigning coordinates in the editor

Coordinates are set at authoring time and **stored in the file**. The online lookup is only a convenience
for filling them in, so a timeline keeps working when that service is gone, and the player never calls it.
The editor is the only place that uses the network for this. Three ways to set them, on one "Coordinates"
row under Location:

- **Lookup.** When the Location field is committed (blur or Enter) and has text, the editor looks it up online
  and fills the coordinates. It is never run per keystroke, because the service forbids search-as-you-type.
  A "Look up" button does the same on demand.
- **Typing.** One text field that accepts `30.7235, -95.5508` (comma, space or both) and tolerates a paste from a
  maps site. Invalid text is flagged and not saved. Clearing it removes `geo`.
- **Pin on a map.** A "Pick on map" button opens a dialog (1.3).

**When a change may overwrite coordinates:**

- No `geo` yet, or `source: "search"`: a changed location looks up again and replaces it.
- `source: "map"` or `"manual"`: the coordinates are never replaced by a lookup automatically. The editor shows
  "Location changed. Look up again?" and waits for the person to press the button. Work someone did by hand isn't
  thrown away by editing a label.

**Ambiguous places.** "Springfield" has many matches. The top match is used, and a status line under the field
names what was matched ("Huntsville, Walker County, Texas, United States") with "N other matches". Opening it
lists them, and choosing one replaces the coordinates. The label is a check for the person, not stored.

**Failure.** Offline, blocked, rate-limited or no match: a short status ("Couldn't find that place. Enter
coordinates or pick on the map."). It never blocks saving or editing, and it never clears existing coordinates.

### 1.2 The lookup service

The editor calls one geocoder through a small interface, `geocode(query) -> [{ label, lat, lng }]`, so the
service can be swapped.

| Service | Role | Notes |
|---|---|---|
| **Nominatim** (nominatim.openstreetmap.org) | **Default** | Free, no key, handles addresses and places. Same OSM Foundation service as the tiles, with the same "best-effort, no SLA" caveat. |
| **Photon** (photon.komoot.io) | Fallback when Nominatim fails | Free, no key, OSM data, fair use. |
| Open-Meteo geocoding | Not used | Place names only, no addresses. |

I called all three from a page-shaped request (a Referer and `Origin: http://127.0.0.1:8000`). Each answered 200 with
`access-control-allow-origin: *`, so a browser can call them directly. The editor runs from a local server (IndexedDB
needs one), so it sends a Referer.

**Nominatim's rules, which the code has to keep:**

- At most 1 request per second. All lookups go through one queue with at least 1.1 seconds between them.
- No search-as-you-type (above).
- Identify the app with a Referer or User-Agent. A browser can't set a User-Agent, so the Referer does it.
- Cache results and don't repeat a query. Results are cached per viewer by normalized query text, in
  `localStorage`, capped at a few hundred entries, in try/catch. **(default)**
- Show attribution near the field: "Location search © OpenStreetMap contributors".
- Ignore a response that arrives after the location has changed again (a request token per event).

**Privacy.** This is the one place the app sends what someone wrote to a third party. The location text, the
viewer's IP address and the page address go to the geocoder. So no lookup runs until the person has allowed it.
**Decided:** the editor asks once.

- **When.** The first time a lookup would run (a committed Location, "Look up", a search in the pin dialog, or the
  batch action in 1.4), and again whenever permission isn't remembered.
- **Where.** An inline notice under the Location field, not a modal, so it doesn't interrupt editing. In the pin
  dialog it sits above the search box. Nothing is sent while it is showing.
- **Text.** "Look up places online? The location text you enter, and your IP address, are sent to
  nominatim.openstreetmap.org (OpenStreetMap) to find coordinates. Coordinates are saved in your timeline; nothing
  else leaves this browser." Buttons: **Allow** and **Not now**.
- **Allow** is remembered per browser in `localStorage`, in try/catch. If storage isn't available it asks each
  session. It covers the fallback service too, and the notice names both if the fallback is ever used.
- **Not now** skips lookups for the rest of this editor session and is not remembered. The next lookup asks again.
  Typing coordinates and pinning on the map work either way.
- **Changing it.** An "Online location lookup" toggle in the editor's settings (or menu) shows the current state and
  the host. Turning it off forgets the permission.
- **Tiles in the pin dialog.** Opening the dialog is an explicit action, so its tile requests need no separate
  prompt. Like any map, the tile host learns roughly which area is being viewed.

### 1.3 Pick on map

A modal dialog in the editor.

- A Leaflet map (the same vendored copy and tile list as the player, section 3 and 4), a pin, a search box
  (search on Enter or a button, never per keystroke) and **Use this location** and **Cancel**.
- Click the map to place the pin, drag it to move it. Coordinates are shown live.
- **Start view:** the event's coordinates at zoom 12; otherwise a lookup of its location text; otherwise the
  last view used; otherwise the whole world.
- **Use this location** sets `geo` with `source: "map"`. The dialog also offers **Clear coordinates**.
- Tiles are fetched from the network, so offline the dialog still works but shows a plain background. The
  coordinates field remains the fallback.
- Filling the Location text from the pin (reverse lookup) is a possible follow-up.

### 1.4 Existing timelines

A timeline made before this has locations and no coordinates. A **Look up missing coordinates** action in the
editor goes through the events that have a location and no `geo`, one at a time under the rate limit, with progress
and a Cancel button. It uses the top match and sets `source: "search"`. Afterwards it lists each event with the
place it matched, so mistakes ("Springfield") can be spotted, and it lists events with no result. It never
touches events that already have `geo`. It needs the same permission as 1.2. This is a follow-up, not the first
version.

### 1.5 Where the code goes

- `src/coords.js`: parse and format coordinates, validation and rounding. No DOM, with a Node test.
- `src/geocode.js`: the service interface, request queue with the rate limit, cache, and the stale-response
  check, with the fetch and the clock injected so a Node test can run it. Nominatim and Photon response parsing.
- `src/mapPicker.js`: the dialog. It shares the Leaflet setup and tile list with the player.
- The editor markup and `editor.js` for the row and status. `timeline.js` for `geo`.

## 2. Shape

Same two-part pattern as the [slideshow](slideshow.md) **(default)**:

- **Launcher panel** in the normal page: "12 of 15 events have a location" (the other 3 won't appear), the
  collection count, the date span of the located events, and an **Open map** button. With no located events it
  says so ("No events have a location") and the button is disabled.
- **Stage.** A full-viewport overlay (`position: fixed; inset: 0`) appended to `<body>`, so it doesn't depend on
  the export's 960px column and the map gets the whole screen. It has no header. Exit (Esc or the button) removes
  it and returns to the launcher, which is also how `player.html` users get back to the nav.

The stage owns everything it puts outside `container`, and `destroy()` removes it, its listeners, the
`mp-lock` class on `<html>`, the Leaflet map and any full-screen state (contract 3.2).

## 3. Map control

**Leaflet 1.9.4**, vendored in the repo and pinned. Not the 2.0 alpha.

- Vendored under `vendor/leaflet/`: `leaflet.js`, `leaflet.css` and its licence (BSD-2). Nothing is loaded from a
  CDN.
- `player.html` loads it with a classic `<script>` tag. The export inlines it as its own `<script>` block ahead
  of the runtime, and its CSS in the `<style>`, **only when the player is Map**, so other exports don't grow by
  about 160 KB. The export bundler doesn't touch it, because it is a plain script and not an ES module.
- The exporter has to make sure the vendored text can't close its `<script>` tag (the same escaping as the data
  block), and `check_export.mjs` asserts that.
- The player reaches it as the global `L`. If it's missing, the stage says "The map library didn't load" and
  nothing else breaks.
- **No images from Leaflet's CSS.** Dots are `divIcon`s and CSS, so the marker and layer-control images aren't
  needed. Leave them out of what's inlined, and check the inlined CSS has no `url(` left over.
- Leaflet's keyboard handler is turned off. It would compete with the stepping keys.
- Popups are not used. A click selects the event and the details go to the right panel (section 6).

## 4. Tiles

The tile source is a small list of `{ id, label, url, attribution, maxZoom, kind }` in code, where `kind` is
`street`, `aerial` or `styled`. **Every source in the list must cover the whole world.** A regional source
(USGS, for one) doesn't belong here, because a timeline can have events anywhere:

| Source | Kind | Notes |
|---|---|---|
| OpenStreetMap | street | **The default.** Best-effort, no SLA, may be blocked without notice. |
| Esri World Imagery | aerial | Free. Needs attribution. |
| Carto Voyager | street | Free for non-commercial use. |
| Stamen Watercolor (Stadia) | styled | Needs an account or domain auth for non-local use. Left out until tested from a real export. |

- A small switcher on the map lists them. The choice is remembered per viewer (section 9). **(default)**
- **Attribution is always visible**, bottom right, and never behind a toggle. The list carries each source's
  own text.
- **Requirements from the OSM tile policy:** no pre-fetching, so there is no offline-cache feature; the page must
  send a Referer. `file://` pages send none. A probe with no Referer got a 200 from OSM, Esri and Carto, but
  that was curl and not a browser, so a real exported file opened from disk has to be tried before this is trusted.
- **Tiles are a network dependency**, so the file is no longer fully offline (section 10). With no tiles the map
  still works: dots, dashed lines and the panels on a plain background, with "Map tiles unavailable" under the
  attribution. A failed tile is never an error dialog.
- Custom tile URLs typed by the viewer are a later idea.

## 5. Dots, lines and direction

### 5.1 What is shown

Only located events **in the current scope** (section 7) are drawn. Everything else is absent from the map, not
greyed out.

- One dot per location. Events at the same coordinates (equal to 5 decimal places, about a metre) share one dot,
  which shows a count badge and lists all of them in the details panel. Without this a trip that revisits a place
  would stack dots that can't be told apart. **(default)**
- The selected event's dot is larger, with a ring. Hovering a dot shows a small tooltip with the event title.
- Dot colour is the accent colour. Per-type colours are a later idea.

### 5.2 Lines and numbers

- **Dashed lines** join the events of a scope in chronological order. Consecutive events at the same place make
  no line.
- **Direction.** Each segment has an arrowhead at its midpoint, pointing from the earlier event to the later one. It
  is a `divIcon` rotated to the segment's bearing in screen space and redrawn on zoom, so no plugin is needed.
  Very short segments (under about 24px on screen) get no arrow.
- **Numbers.** Each dot can be labelled with its position in the sequence (1, 2, 3...). A shared dot shows its
  lowest number with a "+" ("3+"). Numbers and arrows are independent settings, so a viewer can have either.
- **Lines setting.** Applies to **All events** only, with three values:
  - **Off** (the default). One dashed path through an entire timeline is usually noise.
  - **Per collection.** Each collection is drawn as its own path, in date order. An event in two collections is
    on both paths. Events in no collection aren't connected. Not offered when the timeline has no collections.
  - **All in date order.** One path through every located event. This is for a file whose events aren't in
    collections, and it is offered whether or not collections exist.
- **A single collection** always connects its events in date order, with lines, arrows and numbers on by
  default. The Lines setting doesn't apply there. Arrows and numbers can still be switched off, and a viewer's
  choice for each applies to every scope.
- **Numbers in All events** are off by default. With "All in date order" they run over the whole timeline. With
  "Per collection" each path restarts at 1, and a dot in two collections shows the number from the collection
  that was drawn first (the first in `timeline.collections` order).

## 6. Panels

Two flyouts over the map: **left** for choosing and settings, **right** for the selected event.

### 6.1 Behaviour

- Each flyout has an edge tab (a small always-visible button on the map's edge) and a **pin** button.
- **Unpinned:** it opens over the map and closes on its tab, Esc, or a click on empty map. It doesn't close on a
  timer, because a details panel someone is reading mustn't vanish.
- **Pinned:** it docks beside the map and the map narrows to fit. The map keeps its centre and zoom
  (`invalidateSize` with the centre pinned), and every fit accounts for the docked panels (`fitBounds` padding).
- Selecting an event opens the right panel if it's closed. That is a setting, **Open details on select**, on by
  default.
- With both pinned and a details panel open, that is the **split view**: map in the middle, list on the left,
  details on the right.
- **Narrow screens (under 760px):** no pinning. One flyout at a time, drawn as a full-width sheet.

### 6.2 Left panel

- **Scope list.** "All events" (with its count), then each collection that has at least one located event
  (with its count of located events), in `timeline.collections` order. Collections with none are left out.
- **Event list** for the current scope: chronological, date and title, with a marker for the selected one.
  Clicking one selects it and flies to it. An event in several collections appears in each.
- **Settings:** tile source, lines (off, per collection, all in date order), arrows, numbers, open details on select.
- Search and type filtering are not included (the timeline player has them). **(default)**

### 6.3 Right panel

For the selected event: title, date or date range, location text and coordinates, type, collections, fields,
and notes if the timeline has them. All strings are escaped.

- **Photos** are a thumbnail grid of every renderable image (`resolveEventImages`, and `canRenderImageMedia` for
  embedded ones), not just the first four. Clicking one opens a **lightbox** inside the stage: the image shown
  whole, its caption, previous/next through that event's images, close on Esc, click outside, or the close
  button. Esc closes the lightbox first, then flyouts, then the stage.
- Events that share the dot are listed at the top of the panel, and clicking one switches to it.
- Nothing selected: the panel says "Select an event".

## 7. Scope

`scope` is either **All events** or one collection. The events in scope are the located events (either all of
them, or those with that collection's id). Choosing a scope:

1. clears the selection unless the selected event is still in scope;
2. redraws only that scope's dots, lines and numbers;
3. fits the map to those events, animated, with padding for pinned panels. A scope with a single point goes to
   zoom 12. **(default)**

Opening the stage starts in All events, fitted to all located events.

## 8. Stepping

- **Previous / Next** buttons at the bottom of the map, and the ← and → keys. They walk the scope's events in
  order, one event at a time, including several at a shared dot.
- Stepping selects the event and **flies** the map to it. It keeps the current zoom; Leaflet's `flyTo` zooms out and
  back in on its own when the target is far away. With `prefers-reduced-motion` the map jumps.
- At the ends, Next on the last event does nothing, or wraps to the first when Loop is on (section 11).
- Clicking a dot or a list row selects and flies too, so the transport and the list stay in step.

## 9. Keyboard and settings memory

| Key | Action |
|---|---|
| ← / → | Previous / next event |
| L | Toggle the left panel |
| D | Toggle the details panel |
| F | Toggle full screen |
| Esc | Close lightbox, then unpinned flyouts, then leave full screen, then exit the stage |

Keys are ignored while a text field has focus. The handler is removed when the stage closes.

Settings (tile source, lines, arrows, numbers, open details on select, pin state of each panel) are remembered
in `localStorage`, per viewer, in try/catch, and the player works without it. **(default)**

## 10. Changes this needs elsewhere

Once built, the [player contract](../player-contract.md) changes:

1. **Section 1 and 2.1** say the file "needs no network to render, apart from images". Map tiles are a second
   network dependency, chosen by the author by choosing this player. Say so, and add the rule that a player that
   needs the network must degrade to something usable without it.
2. **Section 2.6** (the save-dialog warning about linked images) also names the tile hosts when Map is chosen.
3. **Section 3.2 "Not touch the network"** gets an exception: only tiles, only via the vendored map library, only
   from the source list.
4. **A vendored-library rule.** What is allowed to be inlined and where it lives.
5. The usual [section 4 checklist](../player-contract.md): register, flip `available`, CSS in `player.html` and
   `PLAYER_CSS_URLS`, modules in `check_js.py` (vendor files excluded from the syntax check), a Node test and an
   export check.
6. The schema, README JSON shape and fixtures for `geo`, plus the editor field (section 1).

## 11. Auto-play tour (second phase)

The same stepper with a timer, like auto-advance in the slideshow. It is **not** in the first version.

- Controls beside Previous and Next: **Play / pause**, **Delay** (seconds to dwell at each event, default 6),
  **Loop**. Space toggles play, as in the slideshow.
- Each step has two parts. **Travel:** a distinct marker moves from the current dot to the next along the segment
  while the camera follows. The travel time depends on the distance on screen, clamped to about 1.2 to 3.5
  seconds. **Dwell:** the marker rests on the new dot, the details open, and the delay runs. The delay counts from
  the arrival.
- The travelling marker follows the dashed line where there is one, and a straight line where there isn't.
- **Split view is the pinned right panel** from section 6, not a separate mode. Playing with both panels pinned
  is the split view.
- While playing, the panels unpin and hide themselves and the controls auto-hide, in the same way as the slideshow's
  playback bar. It may reuse the slideshow's visibility state machine if it fits.
- With `prefers-reduced-motion` there is no travel animation: the marker jumps and the camera jumps.
- **Risk:** Leaflet's `flyTo` runs its own animation, so a marker moved separately can drift from the camera.
  The likely answer is to drive both from one animation-frame loop, with the camera set directly. Try it in a
  prototype before promising a smooth result.

## 12. Open questions

None outstanding. Decided in review:

1. **Shared dots.** Events at equal coordinates merge into one dot (5.1).
2. **Lines in All events.** Off by default, with "per collection" and "all in date order" options. The second is
   for files whose events aren't in collections (5.2).
3. **Where the tile source lives.** The viewer's choice, remembered locally (section 4). Letting the author bake a
   default source and a custom URL into the export is a later idea, like the slideshow's baked-in defaults.
4. **Launcher and stage.** The slideshow's split: a launcher panel in the page and a full-viewport stage (section 2).
5. **Consent for lookups.** The editor asks once before any online lookup (1.2).

## 13. Not in scope

Geocoding in the player or in an export (the editor does it, section 1), offline tile caching or bulk fetching, routing along roads, custom tile URLs, clustering,
per-type dot colours, a timeline strip on the map, crossing the antimeridian, printing, video and audio, and editing
from the map.

## 14. Tests

- A DOM-free `src/mapModel.js` with a Node test (`scripts/check_map.mjs`): located events, scopes and their counts,
  ordering, shared-dot grouping, numbering, segments (skipping zero length), bearing and the minimum arrow
  length, bounds and the single-point case, stepping with and without Loop, settings normalization, and the tour
  timings with a fake clock.
- Schema: `geo` parsing, dropping bad values, and a fixture.
- `check_coords.mjs` and `check_geocode.mjs`: coordinate parsing and formatting; the geocoder with a fake fetch and
  clock (the queue spacing, cache hits, a stale response being ignored, Nominatim and Photon parsing, the
  fallback on failure, and the overwrite rules for `source`).
- `check_export.mjs`: the export with Map includes Leaflet and its CSS, has no leftover `url(`, can't close its
  script tag early, and stays unchanged for other players.
- **By hand:** everything with a real map: the panels, pinning, resize, lightbox, stepping and flying, tiles from a
  real `.timeline.html` opened from disk (the Referer question in section 4), tiles offline, and small screens.
